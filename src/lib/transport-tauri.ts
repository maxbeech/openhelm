/**
 * TauriTransport — local mode transport backed by the Node.js agent sidecar.
 *
 * Delegates all requests to the existing `agentClient` (JSON-RPC over
 * stdin/stdout in Tauri mode, HTTP+SSE in browser-dev mode).
 * Receives events from `window` CustomEvents dispatched by agentClient.
 */

import { agentClient } from "./agent-client.js";
import type { Transport } from "./transport.js";

export class TauriTransport implements Transport {
  get connected(): boolean {
    return agentClient.isConnected();
  }

  get ready(): boolean {
    return agentClient.isReady();
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return agentClient.request<T>(method, params);
  }

  onEvent(eventName: string, handler: (data: unknown) => void): () => void {
    const listener = (e: Event) => {
      handler((e as CustomEvent).detail);
    };
    window.addEventListener(`agent:${eventName}`, listener);
    return () => window.removeEventListener(`agent:${eventName}`, listener);
  }

  onReady(fn: () => void): void {
    if (this.ready) { fn(); return; }
    window.addEventListener("agent:agent.ready", fn, { once: true });
  }
}
