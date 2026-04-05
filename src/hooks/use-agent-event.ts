import { useEffect, useRef } from "react";

/**
 * Subscribe to an agent event dispatched on window.
 * Events follow the pattern `agent:<event>` with data in `event.detail`.
 *
 * Uses a ref for the handler to avoid re-registering the event listener
 * when the handler function reference changes (common with inline callbacks
 * and useCallback). This also prevents React StrictMode's double-mount
 * cycle from creating duplicate listeners.
 */
export function useAgentEvent<T = unknown>(
  eventName: string,
  handler: (data: T) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (e: Event) => {
      const custom = e as CustomEvent<T>;
      handlerRef.current(custom.detail);
    };
    window.addEventListener(`agent:${eventName}`, listener);
    return () => window.removeEventListener(`agent:${eventName}`, listener);
  }, [eventName]);
}
