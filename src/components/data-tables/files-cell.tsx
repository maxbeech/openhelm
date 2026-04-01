import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Paperclip, X, Plus, ExternalLink, Upload, Loader2 } from "lucide-react";
import type { FileReference } from "@openhelm/shared";
import { pickAndCopyFile, openFileExternally, isLocalFile } from "@/lib/tauri-file";

interface Props {
  value: unknown;
  onChange: (v: unknown) => void;
}

function parseFiles(value: unknown): FileReference[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f) => f && typeof f === "object" && f.name) as FileReference[];
}

export function FilesCell({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const files = parseFiles(value);

  const handleOpen = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  };

  const handleRemove = (id: string) => {
    onChange(files.filter((f) => f.id !== id));
  };

  const handleAdd = (file: FileReference) => {
    onChange([...files, file]);
  };

  return (
    <div className="relative w-full min-h-[30px]">
      <div
        ref={triggerRef}
        onClick={handleOpen}
        className="flex min-h-[30px] cursor-pointer flex-wrap items-center gap-1 px-2 py-1 hover:bg-accent/30 transition-colors"
      >
        {files.length > 0 ? (
          files.map((f) => (
            <FilePill key={f.id} file={f} onRemove={() => handleRemove(f.id)} />
          ))
        ) : (
          <span className="text-muted-foreground/30 text-sm">-</span>
        )}
      </div>
      {open && anchorRect && (
        <FilesDropdown
          anchorRect={anchorRect}
          files={files}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function FilePill({ file, onRemove }: { file: FileReference; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium max-w-[150px] truncate bg-muted text-muted-foreground">
      <Paperclip className="size-2.5 shrink-0" />
      <span className="truncate">{file.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="shrink-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

function FilesDropdown({ anchorRect, files, onAdd, onRemove, onClose }: {
  anchorRect: DOMRect;
  files: FileReference[];
  onAdd: (file: FileReference) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleUpload = async () => {
    setUploading(true);
    try {
      const ref = await pickAndCopyFile();
      if (ref) onAdd(ref);
    } catch (err) {
      console.error("[FilesCell] upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleAddUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    // Only allow safe URL schemes to prevent javascript:/data: injection via href.
    if (!/^https?:\/\//i.test(url)) {
      setUrlInput("");
      return;
    }
    const name = url.split("/").pop() || url;
    onAdd({ id: `f_${crypto.randomUUID().slice(0, 8)}`, name, url });
    setUrlInput("");
  };

  const PANEL_WIDTH = 260;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow > 240 ? anchorRect.bottom + 2 : anchorRect.top - 240 - 2;
  const left = Math.min(anchorRect.left, Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN));

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top, left, width: PANEL_WIDTH, zIndex: 9999 }}
      className="rounded-md border border-border bg-popover shadow-lg"
    >
      {/* Existing files */}
      <div className="max-h-40 overflow-y-auto p-1.5">
        {files.length === 0 && (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">No files attached</p>
        )}
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent">
            <Paperclip className="size-3 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{f.name}</span>
            <button
              onClick={() => void openFileExternally(f.url)}
              title={isLocalFile(f.url) ? "Open in default app" : "Open link"}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3" />
            </button>
            <button onClick={() => onRemove(f.id)}
              className="shrink-0 text-muted-foreground hover:text-destructive">
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Upload from disk */}
      <div className="border-t border-border px-2 py-1.5">
        <button
          onClick={() => void handleUpload()}
          disabled={uploading}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {uploading
            ? <Loader2 className="size-3 animate-spin" />
            : <Upload className="size-3" />}
          {uploading ? "Copying…" : "Upload file…"}
        </button>
      </div>

      {/* Add by URL (secondary) */}
      <div className="border-t border-border px-2 py-1.5 flex gap-1">
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddUrl();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Or paste URL…"
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        />
        <button
          onMouseDown={(e) => { e.preventDefault(); handleAddUrl(); }}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
