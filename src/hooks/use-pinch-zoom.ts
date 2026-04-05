import { useEffect, type RefObject } from "react";

/**
 * Hook to handle pinch-to-zoom gestures (ctrl+wheel on macOS trackpad).
 * `onZoom(delta)`: called on every wheel tick with the raw deltaY value.
 * Updates continuously during the gesture for smooth zoom.
 */
export function usePinchZoom(
  containerRef: RefObject<HTMLElement | null>,
  onZoom: (delta: number) => void,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // Only pinch gestures (ctrl+wheel on macOS)
      e.preventDefault();
      // Pass raw deltaY directly — no debounce so zoom feels continuous
      onZoom(e.deltaY);
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [containerRef, onZoom]);
}
