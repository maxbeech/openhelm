import type {
  IpcRequest,
  IpcResponse,
  IpcEvent,
} from "@openhelm/shared";
import { isIpcResponse, isIpcEvent } from "@openhelm/shared";
import { captureFrontendError } from "./sentry";

/**
 * Detect whether we are running inside the Tauri WebView.
 * When accessed from a plain browser (e.g. browser MCP at localhost:1420)
 * the Tauri internals are not injected, so we fall back to the HTTP+SSE dev bridge.
 */
function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const DEV_BRIDGE_URL = "http://localhost:1421";
const REQUEST_TIMEOUT_MS = 240_000; // 4 minutes

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Returns true for errors that are expected / benign and should not be
 * reported to Sentry:
 * - JSON-RPC -32601 (Method Not Found): the running agent binary predates a
 *   method added in a newer frontend build. Callers handle these silently.
 * - Dev-bridge send failures: the HTTP bridge at localhost:1421 is not running.
 * - Agent termination / stop: process died or client was torn down; callers
 *   handle reconnection themselves.
 */
function isExpectedIpcError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.startsWith("[-32601]") ||
    // -32603 "message already being processed": user sent a second request while one is in flight;
    // the UI's chatSending guard normally prevents this, but can race during reconnection.
    err.message.startsWith("[-32603] A message is already being processed") ||
    err.message === "Agent process terminated unexpectedly" ||
    err.message === "Agent client stopped" ||
    // OS-level pipe error when the sidecar exits mid-request (Tauri / macOS)
    err.message.includes("Broken pipe") ||
    (!isTauriContext() && err.message.startsWith("Failed to send request:"))
  );
}

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds between pings
const HEARTBEAT_TIMEOUT_MS = 10_000; // 10 seconds to respond before declaring agent hung

class AgentClient {
  private pending = new Map<string, PendingRequest>();
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;
  private connected = false;
  private unlisten: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /** Start listening for sidecar / SSE events */
  async start() {
    if (this.unlisten) return;

    if (isTauriContext()) {
      await this.startTauri();
    } else {
      this.startSse();
    }
  }

  /** Stop listening */
  stop() {
    this.stopHeartbeat();
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
    this.connected = false;
    this.ready = false;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Agent client stopped"));
      this.pending.delete(id);
    }
  }

  /** Send an IPC request and wait for the response */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.readyPromise;
    try {
      return await this.sendRaw<T>(method, params);
    } catch (err) {
      // Don't report expected/benign errors to Sentry:
      // - [-32601] Method Not Found: agent binary predates this method (version mismatch);
      //   callers already handle these gracefully.
      // - Failed to send request (dev bridge): SSE bridge not running in dev mode.
      if (!isExpectedIpcError(err)) {
        captureFrontendError(err, { ipcMethod: method }); // no params (could contain user data)
      }
      throw err;
    }
  }

  isReady() { return this.ready; }
  isConnected() { return this.connected; }

  // ── Tauri transport ──────────────────────────────────────────────────────

  private async startTauri() {
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenStdout = await listen<string>("sidecar-stdout", (event) => {
      this.handleLine(event.payload);
    });
    const unlistenTerminated = await listen<string>("sidecar-terminated", () => {
      this.handleSidecarDeath();
    });
    this.unlisten = () => { unlistenStdout(); unlistenTerminated(); };
    this.connected = true;
    this.probeReadiness();
  }

  /** Called when the sidecar process terminates unexpectedly, or heartbeat fails. */
  private handleSidecarDeath() {
    console.error("[agent-client] sidecar process terminated");
    this.stopHeartbeat();
    this.connected = false;
    this.ready = false;

    // Create a new ready promise so requests block until the sidecar restarts.
    // The Rust auto-restart mechanism will re-spawn the agent and the new
    // agent.ready event will resolve this promise via markReady().
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // Reject all pending requests immediately instead of waiting for timeout
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Agent process terminated unexpectedly"));
      this.pending.delete(id);
    }
    // Notify the UI so it can show an error / restart prompt
    window.dispatchEvent(new CustomEvent("agent:agent.terminated"));
  }

  private async sendViaTauri(req: IpcRequest): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_to_sidecar", { message: JSON.stringify(req) });
  }

  // ── SSE + HTTP transport (browser / dev mode) ────────────────────────────

  private startSse() {
    const es = new EventSource(`${DEV_BRIDGE_URL}/events`);

    es.onopen = () => {
      this.connected = true;
      this.probeReadiness();
    };

    es.onmessage = (evt) => {
      this.handleLine(evt.data);
    };

    es.onerror = () => {
      console.warn("[agent-client] SSE connection error");
    };

    this.unlisten = () => es.close();
    // Mark connected immediately (SSE may not fire onopen until data arrives)
    this.connected = true;
    // Probe after a short delay to let the SSE connection establish
    setTimeout(() => this.probeReadiness(), 200);
  }

  private async sendViaSse(req: IpcRequest): Promise<void> {
    const res = await fetch(`${DEV_BRIDGE_URL}/ipc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Dev bridge /ipc returned ${res.status}`);
    const response: IpcResponse = await res.json();
    // The HTTP response IS the IPC response — handle directly
    this.handleLine(JSON.stringify(response));
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (!this.ready) return;
      try {
        await this.sendRaw("ping", undefined, HEARTBEAT_TIMEOUT_MS);
      } catch {
        // Agent is hung (alive but not responding) — treat as if it terminated.
        // handleSidecarDeath rejects all pending requests immediately so callers
        // don't have to wait for the full 240 s REQUEST_TIMEOUT_MS.
        if (this.ready) {
          console.error("[agent-client] heartbeat timed out — agent appears hung");
          this.handleSidecarDeath();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendRaw<T = unknown>(method: string, params?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const id = crypto.randomUUID();
    const req: IpcRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      const send = isTauriContext()
        ? this.sendViaTauri(req)
        : this.sendViaSse(req);

      send.catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Failed to send request: ${err}`));
      });
    });
  }

  private async probeReadiness() {
    try {
      await this.sendRaw("ping", undefined, HEARTBEAT_TIMEOUT_MS);
      this.markReady();
    } catch {
      // Will be marked ready via agent.ready event
    }
  }

  private markReady() {
    if (this.ready) return;
    this.ready = true;
    this.connected = true; // Restore connected state (handles auto-restart reconnection)
    if (this.readyResolve) {
      this.readyResolve();
      this.readyResolve = null;
    }
    window.dispatchEvent(new CustomEvent("agent:agent.ready"));
    this.startHeartbeat();
  }

  private handleLine(line: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn("[agent-client] non-JSON line from agent:", line);
      return;
    }

    if (isIpcResponse(parsed)) {
      const pending = this.pending.get(parsed.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(parsed.id);
        if (parsed.error) {
          pending.reject(new Error(`[${parsed.error.code}] ${parsed.error.message}`));
        } else {
          pending.resolve(parsed.result);
        }
      }
      return;
    }

    if (isIpcEvent(parsed)) {
      if (parsed.event === "agent.ready") this.markReady();
      window.dispatchEvent(new CustomEvent(`agent:${parsed.event}`, { detail: parsed.data }));
      return;
    }

    console.warn("[agent-client] unknown message from agent:", parsed);
  }
}

export const agentClient = new AgentClient();
