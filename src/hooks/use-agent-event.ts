import { useEffect, useRef } from "react";
import { transport } from "../lib/transport";

/**
 * Subscribe to an agent event.
 *
 * - Local (Tauri) mode: TauriTransport dispatches events to `window` as
 *   `agent:<event>` CustomEvents, same as before.
 * - Cloud mode: SupabaseTransport receives events from Supabase Realtime and
 *   calls the handler directly.
 *
 * Uses a ref for the handler to avoid re-registering the listener when the
 * handler reference changes (common with inline callbacks and useCallback).
 * Also prevents React StrictMode's double-mount from creating duplicates.
 */
export function useAgentEvent<T = unknown>(
  eventName: string,
  handler: (data: T) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = transport.onEvent(eventName, (data) => {
      handlerRef.current(data as T);
    });
    return unsub;
  }, [eventName]);
}
