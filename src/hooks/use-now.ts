import { useSyncExternalStore } from "react";

/**
 * Shared singleton timer: one setInterval serves all mounted useNow consumers.
 * Listeners are notified every 60 s; the first subscriber starts the timer,
 * the last unsubscriber stops it.
 */
let listeners = new Set<() => void>();
let current = new Date();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    timer = setInterval(() => {
      current = new Date();
      for (const fn of listeners) fn();
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): Date {
  return current;
}

/**
 * Returns the current Date, updating every 60 s via a shared timer.
 * Multiple components calling useNow() share a single setInterval.
 */
export function useNow(): Date {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
