/**
 * SupabaseTransport — cloud mode transport.
 *
 * Request routing:
 *  - CRUD methods → Supabase PostgREST (direct DB access, subject to RLS)
 *  - Action methods (runs.trigger, runs.cancel) → Worker HTTP /rpc endpoint
 *  - LLM methods (chat.send) → Worker HTTP /rpc endpoint
 *
 * Event routing:
 *  - run.* events → Supabase Realtime channel `run:{runId}`
 *  - user events  → Supabase Realtime channel `user:{userId}:events`
 *
 * All requests require an active Supabase auth session (JWT attached as Bearer).
 */

import type { Transport } from "./transport.js";
import { getSupabaseClient, getSession, getWorkerUrl } from "./supabase-client.js";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ─── Worker RPC ───────────────────────────────────────────────────────────────

/** Methods that must be routed to the Worker Service (not directly to Supabase). */
const WORKER_METHODS = new Set([
  "runs.trigger",
  "runs.cancel",
  "chat.send",
  "chat.cancel",
  "health",
  "ping",
  "scheduler.status",
  "claudeCode.detect",
  "claudeCode.verify",
  // Interactive browser-profile setup for credentials (cloud mode only).
  // The Worker spawns an E2B Desktop sandbox, streams the noVNC URL back,
  // and persists the profile tarball to Supabase Storage on finalize.
  "credential.setupBrowserProfile",
  "credential.finalizeBrowserProfile",
  "credential.cancelBrowserSetup",
]);

async function workerRpc<T>(
  method: string,
  params: unknown,
  accessToken: string,
): Promise<T> {
  const workerUrl = getWorkerUrl();
  const id = crypto.randomUUID();

  const res = await fetch(`${workerUrl}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ id, method, params }),
  });

  if (!res.ok) {
    throw new Error(`Worker RPC ${method} failed: HTTP ${res.status}`);
  }

  const { result, error } = (await res.json()) as {
    id: string;
    result?: T;
    error?: { code: number; message: string };
  };

  if (error) throw new Error(`[${error.code}] ${error.message}`);
  return result as T;
}

// ─── Supabase PostgREST CRUD ──────────────────────────────────────────────────

import { handleCrudRequest } from "./transport-supabase-crud.js";

// ─── Main transport class ─────────────────────────────────────────────────────

export class SupabaseTransport implements Transport {
  private _channels: Map<string, RealtimeChannel> = new Map();
  private _readyCallbacks: Array<() => void> = [];
  private _ready = false;
  private _connected = false;
  private _userId: string | null = null;

  constructor() {
    // Initialize async — catch errors to prevent unhandled rejections in
    // test environments that lack Supabase configuration.
    Promise.resolve()
      .then(async () => {
        const session = await getSession();
        this._connected = true;
        this._ready = !!session;
        this._userId = session?.user?.id ?? null;
        if (this._ready) {
          this._readyCallbacks.forEach((fn) => fn());
          this._readyCallbacks = [];
        }

        // Listen for auth state changes
        getSupabaseClient().auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_IN") {
            this._ready = true;
            this._connected = true;
            this._userId = session?.user?.id ?? null;
            this._readyCallbacks.forEach((fn) => fn());
            this._readyCallbacks = [];
          } else if (event === "SIGNED_OUT") {
            this._ready = false;
            this._userId = null;
          }
        });
      })
      .catch((err: Error) => {
        // Non-fatal — Supabase not configured (e.g. test environment)
        console.error("[supabase-transport] init error:", err.message);
      });
  }

  get connected(): boolean { return this._connected; }
  get ready(): boolean { return this._ready; }

  onReady(fn: () => void): void {
    if (this._ready) { fn(); return; }
    this._readyCallbacks.push(fn);
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const session = await getSession();
    if (!session) throw new Error("Not authenticated");

    // Action methods → Worker
    if (WORKER_METHODS.has(method)) {
      return workerRpc<T>(method, params, session.access_token);
    }

    // CRUD methods → PostgREST
    return handleCrudRequest<T>(method, params, session.user.id);
  }

  onEvent(eventName: string, handler: (data: unknown) => void): () => void {
    // User-scoped events require _userId to construct the channel name.
    // If the session hasn't resolved yet, defer the subscription until it does.
    // This avoids the race condition where onEvent() is called (via useEffect
    // on mount) before the async getSession() completes in the constructor.
    if (this._needsUserId(eventName) && !this._userId) {
      let innerUnsub: (() => void) | null = null;
      let cancelled = false;

      const readyHandler = () => {
        if (!cancelled) {
          innerUnsub = this.onEvent(eventName, handler);
        }
      };
      this._readyCallbacks.push(readyHandler);

      return () => {
        cancelled = true;
        // Remove the pending callback if it hasn't fired yet.
        const idx = this._readyCallbacks.indexOf(readyHandler);
        if (idx !== -1) this._readyCallbacks.splice(idx, 1);
        innerUnsub?.();
      };
    }

    const supabase = getSupabaseClient();

    // Determine channel from event name pattern
    const channelName = this._resolveChannelName(eventName);
    if (!channelName) {
      // Unsupported event in cloud mode — return no-op
      return () => {};
    }

    // Reuse or create channel. Listeners must be registered before subscribe().
    let channel = this._channels.get(channelName);
    if (!channel) {
      channel = supabase.channel(channelName);
      this._channels.set(channelName, channel);
    }

    const resolvedChannel = channel;

    // Register listener first, then subscribe if not already subscribed.
    resolvedChannel.on("broadcast", { event: eventName }, (payload) => {
      handler(payload.payload);
    });

    // subscribe() is idempotent — safe to call on an already-subscribed channel.
    resolvedChannel.subscribe();

    return () => {
      resolvedChannel.unsubscribe();
      this._channels.delete(channelName);
    };
  }

  /** Events that require _userId to construct a user-scoped channel name. */
  private _needsUserId(eventName: string): boolean {
    // run.* events use a run-scoped channel (no userId needed in channel name)
    return !eventName.startsWith("run.");
  }

  /** Map event names to Supabase Realtime channel names. */
  private _resolveChannelName(eventName: string): string | null {
    const userId = this._userId;
    const userChannel = userId ? `user:${userId}:events` : null;
    if (eventName.startsWith("run.")) return `run:${eventName.split(".")[1] ?? "*"}`;
    if (eventName.startsWith("inbox")) return userChannel;
    if (eventName.startsWith("chat.")) return userChannel;
    if (eventName === "job.updated") return userChannel;
    if (eventName === "scheduler.tick") return userChannel;
    return null;
  }
}
