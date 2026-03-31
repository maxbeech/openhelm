import { useState, useEffect } from "react";
import { Pencil, Trash2, Archive } from "lucide-react";
import { MemoryTypeBadge } from "./memory-type-badge";
import { Badge } from "@/components/ui/badge";
import type { Memory } from "@openhelm/shared";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";

interface MemoryCardProps {
  memory: Memory;
  projectName?: string;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onEdit: (memory: Memory) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
}

export function MemoryCard({
  memory,
  projectName,
  isSelected = false,
  onToggleSelect,
  onEdit,
  onDelete,
  onArchive,
}: MemoryCardProps) {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  // Auto-reset confirm-delete after 3 s so a stray first-click can't silently
  // trigger deletion on the next interaction with this card.
  useEffect(() => {
    if (!showConfirmDelete) return;
    const t = setTimeout(() => setShowConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [showConfirmDelete]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors hover:bg-accent/30",
        isSelected ? "border-primary/50 bg-primary/5" : "border-border",
        memory.isArchived && "opacity-60",
      )}
    >
      <div className="flex gap-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(memory.id); }}
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-transparent hover:border-primary/60",
          )}
          aria-label={isSelected ? "Deselect" : "Select"}
        >
          {isSelected && (
            <svg viewBox="0 0 10 8" className="size-2.5 fill-none stroke-current stroke-[1.8]">
              <polyline points="1,4 3.5,6.5 9,1" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          {/* Header: type badge + tags + project */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <MemoryTypeBadge type={memory.type} />
            {memory.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {projectName && (
              <Badge variant="outline" className="ml-auto text-[10px]">
                {projectName}
              </Badge>
            )}
          </div>

          {/* Content */}
          <p className="text-sm leading-relaxed">{memory.content}</p>

          {/* Footer: meta + actions */}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>Importance: {(memory.importance / 10).toFixed(1)}</span>
            <span>Used: {memory.accessCount}x</span>
            <span>{formatRelativeTime(memory.updatedAt)}</span>
            {memory.sourceType !== "user" && (
              <span className="capitalize">via {memory.sourceType}</span>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => onEdit(memory)}
                className="rounded p-1 hover:bg-accent"
                title="Edit"
              >
                <Pencil className="size-3" />
              </button>
              {!memory.isArchived && (
                <button
                  onClick={() => onArchive(memory.id)}
                  className="rounded p-1 hover:bg-accent"
                  title="Archive"
                >
                  <Archive className="size-3" />
                </button>
              )}
              {showConfirmDelete ? (
                <button
                  onClick={() => onDelete(memory.id)}
                  className="rounded p-1 text-destructive hover:bg-destructive/10"
                  title="Confirm delete"
                >
                  <Trash2 className="size-3" />
                </button>
              ) : (
                <button
                  onClick={() => setShowConfirmDelete(true)}
                  className="rounded p-1 hover:bg-accent"
                  title="Delete"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
