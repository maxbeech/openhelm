import { useState, useCallback, useEffect, useRef } from "react";

interface ResizePanelConfig {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  storageKey: string;
}

interface ResizePanelResult {
  width: number;
  dragHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Hook for a right-edge resizable panel.
 * Drag the left border to resize. Width persists in localStorage.
 */
export function useResizePanel(config: ResizePanelConfig): ResizePanelResult {
  const { minWidth, maxWidth, defaultWidth, storageKey } = config;

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
      const newWidth = Math.min(maxWidth, Math.max(minWidth, window.innerWidth - e.clientX));
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
  }, [minWidth, maxWidth, storageKey]);

  return { width, dragHandleProps: { onMouseDown } };
}
