import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Notion-style floating popout editor for text-like cells.
 *
 * Behaviour:
 *  - `anchorRect` pins the panel to the original cell's screen position.
 *  - The panel's width matches the anchor; height grows up to a cap.
 *  - Pressing Enter (text inputs) or Escape, or clicking outside, commits and
 *    closes. In multiline mode Shift+Enter inserts a newline.
 */

export type PopoutInputType = "text" | "textarea" | "number" | "url" | "email" | "date";

interface Props {
  anchorRect: DOMRect;
  initialValue: string;
  type: PopoutInputType;
  onCommit: (next: string) => void;
  onClose: () => void;
}

const MIN_WIDTH = 240;
const MAX_HEIGHT = 320;
const MARGIN = 8;

export function CellPopout({ anchorRect, initialValue, type, onCommit, onClose }: Props) {
  const [draft, setDraft] = useState(initialValue);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Focus the input on mount without scrolling the page.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    if (inputRef.current && "select" in inputRef.current) {
      (inputRef.current as HTMLInputElement).select?.();
    }
  }, []);

  // Commit + close on outside click.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCommit(draft);
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [draft, onCommit, onClose]);

  // Position: open over the original cell, flip up if there's no room below.
  const width = Math.max(anchorRect.width, MIN_WIDTH);
  const spaceBelow = window.innerHeight - anchorRect.top;
  const openUp = spaceBelow < 180 && anchorRect.top > 180;
  const top = openUp ? anchorRect.bottom - MAX_HEIGHT - 2 : anchorRect.top - 2;
  const left = Math.min(
    anchorRect.left,
    Math.max(MARGIN, window.innerWidth - width - MARGIN),
  );

  const multiline = type === "textarea";

  const commit = () => {
    onCommit(draft);
    onClose();
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement> = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      if (multiline && !e.shiftKey) {
        // In multiline mode, Enter commits; Shift+Enter inserts a newline.
        e.preventDefault();
        commit();
      } else if (!multiline) {
        e.preventDefault();
        commit();
      }
    }
  };

  // Allow layout to settle before measuring (prevents flash on first render).
  useLayoutEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.opacity = "1";
    }
  }, []);

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top,
        left,
        width,
        maxHeight: MAX_HEIGHT,
        zIndex: 9999,
        opacity: 0,
      }}
      className="rounded-md border border-border bg-popover shadow-xl"
    >
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type to edit. Enter to save · Shift+Enter for newline · Esc to cancel."
          className="h-full min-h-[120px] w-full resize-none bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground/40"
          style={{ maxHeight: MAX_HEIGHT - 8 }}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={inputType(type)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type to edit. Enter to save · Esc to cancel."
          className="w-full bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground/40"
        />
      )}
    </div>
  );

  return createPortal(panel, document.body);
}

function inputType(t: PopoutInputType): string {
  switch (t) {
    case "number":
      return "number";
    case "url":
      return "url";
    case "email":
      return "email";
    case "date":
      return "date";
    default:
      return "text";
  }
}
