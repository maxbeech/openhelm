import { useState, useCallback, useEffect, useRef } from "react";

interface ResizePanelConfig {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  storageKey: string;
  /** "right" (default): panel is anchored to the right edge (drag left border to resize).
   *  "left": panel is anchored to the left edge (drag right border to resize). */
  direction?: "left" | "right";
}

interface ResizePanelResult {
  width: number;
  dragHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Hook for a resizable panel.
 * For "right" direction (default): drag the left border to resize (right-anchored panels).
 * For "left" direction: drag the right border to resize (left-anchored panels like the sidebar).
 * Width persists in localStorage.
 */
export function useResizePanel(config: ResizePanelConfig): ResizePanelResult {
  const { minWidth, maxWidth, defaultWidth, storageKey, direction = "right" } = config;

  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) return parsed;
      }
    } catch { /* ignore */ }
    return defaultWidth;
  });

  const dragging = useRef(false);
  const widthRef = useRef(width);

  // Keep ref in sync with state
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(
        maxWidth,
        Math.max(minWidth, direction === "left" ? e.clientX : window.innerWidth - e.clientX),
      );
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // Persist on release — read from ref to avoid stale closure
      try { localStorage.setItem(storageKey, String(widthRef.current)); } catch { /* ignore */ }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [minWidth, maxWidth, storageKey, direction]);

  return { width, dragHandleProps: { onMouseDown } };
}
