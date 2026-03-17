import type {
  IpcRequest,
  IpcResponse,
  IpcEvent,
} from "@openorchestra/shared";
import { isIpcResponse, isIpcEvent } from "@openorchestra/shared";
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

class AgentClient {
  private pending = new Map<string, PendingRequest>();
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;
  private connected = false;
  private unlisten: (() => void) | null = null;

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
      captureFrontendError(err, { ipcMethod: method }); // no params (could contain user data)
      throw err;
    }
  }

  isReady() { return this.ready; }
  isConnected() { return this.connected; }

  // ── Tauri transport ──────────────────────────────────────────────────────

  private async startTauri() {
    const { listen } = await import("@tauri-apps/api/event");
    this.unlisten = await listen<string>("sidecar-stdout", (event) => {
      this.handleLine(event.payload);
    });
    this.connected = true;
    this.probeReadiness();
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

  private sendRaw<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    const req: IpcRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

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
      await this.sendRaw("ping");
      this.markReady();
    } catch {
      // Will be marked ready via agent.ready event
    }
  }

  private markReady() {
    if (this.ready) return;
    this.ready = true;
    if (this.readyResolve) {
      this.readyResolve();
      this.readyResolve = null;
    }
    window.dispatchEvent(new CustomEvent("agent:agent.ready"));
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
