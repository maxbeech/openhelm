import { useState } from "react";
import { Pencil, Trash2, Archive } from "lucide-react";
import { MemoryTypeBadge } from "./memory-type-badge";
import { Badge } from "@/components/ui/badge";
import type { Memory } from "@openhelm/shared";
import { cn } from "@/lib/utils";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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
        <div className="flex items-start pt-0.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect?.(memory.id)}
            onClick={(e) => e.stopPropagation()}
            className="size-3.5 cursor-pointer accent-primary"
          />
        </div>

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
