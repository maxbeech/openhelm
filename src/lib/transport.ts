/**
 * Transport abstraction layer.
 *
 * Decouples the React frontend from the underlying communication mechanism:
 *  - Local (Tauri) mode: JSON-RPC via stdin/stdout sidecar
 *  - Cloud mode: Supabase PostgREST + Worker HTTP API + Realtime
 *
 * All components use `transport.request()` instead of calling `agentClient`
 * directly, enabling the same React codebase to run in both modes.
 */

import { isLocalMode } from "./mode.js";

/** Unified transport interface */
export interface Transport {
  /** Send a request and await the response. */
  request<T = unknown>(method: string, params?: unknown): Promise<T>;

  /**
   * Subscribe to server-sent events.
   * Returns an unsubscribe function.
   */
  onEvent(eventName: string, handler: (data: unknown) => void): () => void;

  /** True when the transport has an active connection. */
  readonly connected: boolean;

  /** True when the transport is fully initialised and ready for requests. */
  readonly ready: boolean;

  /** Register a callback to be invoked once the transport is ready. */
  onReady(fn: () => void): void;
}

// ─── Lazy singleton ───────────────────────────────────────────────────────────

let _instance: Transport | null = null;

export async function createTransport(): Promise<Transport> {
  if (isLocalMode) {
    const { TauriTransport } = await import("./transport-tauri.js");
    return new TauriTransport();
  }
  const { SupabaseTransport } = await import("./transport-supabase.js");
  return new SupabaseTransport();
}

/** Get or create the singleton transport. */
export async function getTransport(): Promise<Transport> {
  if (!_instance) {
    _instance = await createTransport();
  }
  return _instance;
}

/**
 * Synchronous transport proxy — wraps the async singleton so callers don't
 * need to await the module. Requests are queued until the transport is ready.
 */
class TransportProxy implements Transport {
  private _transport: Transport | null = null;
  private _queue: Array<() => void> = [];
  private _readyCallbacks: Array<() => void> = [];

  connected = false;
  ready = false;

  constructor() {
    getTransport()
      .then((t) => {
        this._transport = t;
        this.connected = t.connected;
        this.ready = t.ready;
        // Flush queued calls
        this._queue.forEach((fn) => fn());
        this._queue = [];
        this._readyCallbacks.forEach((fn) => fn());
        this._readyCallbacks = [];
      })
      .catch((err: Error) => {
        // Non-fatal in test environments without Supabase config
        console.error("[transport] Failed to initialize transport:", err.message);
      });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this._transport) return this._transport.request<T>(method, params);
    return new Promise<T>((resolve, reject) => {
      this._queue.push(() => {
        this._transport!.request<T>(method, params).then(resolve).catch(reject);
      });
    });
  }

  onEvent(eventName: string, handler: (data: unknown) => void): () => void {
    if (this._transport) return this._transport.onEvent(eventName, handler);
    // Subscribe once ready
    let unsub: (() => void) | null = null;
    this._queue.push(() => {
      unsub = this._transport!.onEvent(eventName, handler);
    });
    return () => unsub?.();
  }

  onReady(fn: () => void): void {
    if (this.ready) { fn(); return; }
    this._readyCallbacks.push(fn);
  }
}

/** The singleton transport proxy — use this in components and api.ts. */
export const transport: Transport = new TransportProxy();
