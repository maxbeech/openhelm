import { useCallback, useState } from "react";
import { Trash2, ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import type { DataTableColumn } from "@openhelm/shared";
import { ColumnTypeIcon } from "./column-type-icon";
import type { SortState } from "./data-table-sort";
import { cycleSort } from "./data-table-sort";
import { cn } from "@/lib/utils";

/** Minimum and default widths for header cells. */
const DEFAULT_WIDTH = 180;
const MIN_WIDTH = 80;
const MAX_WIDTH = 600;

/** Custom DnD mime type — avoids colliding with text drops from the browser. */
const DND_MIME = "application/x-openhelm-column";

interface Props {
  columns: DataTableColumn[];
  sortState: SortState | null;
  onSortChange: (next: SortState | null) => void;
  onColumnRemove: (columnId: string) => void;
  onColumnResize: (columnId: string, width: number) => void;
  /** New order of column IDs after a drag-and-drop reorder. */
  onColumnsReorder: (nextColumnIds: string[]) => void;
}

export function DataTableGridHeader({
  columns,
  sortState,
  onSortChange,
  onColumnRemove,
  onColumnResize,
  onColumnsReorder,
}: Props) {
  // Which column is currently the drop target, and on which side ("before" or "after").
  const [dropTarget, setDropTarget] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleSortClick = useCallback(
    (columnId: string) => {
      onSortChange(cycleSort(sortState, columnId));
    },
    [onSortChange, sortState],
  );

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, columnId: string, currentWidth: number) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = currentWidth;

      const onMove = (ev: PointerEvent) => {
        const next = clamp(startWidth + (ev.clientX - startX), MIN_WIDTH, MAX_WIDTH);
        onColumnResize(columnId, next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onColumnResize],
  );

  return (
    <thead>
      <tr className="border-b border-border bg-muted/30">
        <th className="w-8 px-1 py-2 text-center text-3xs text-muted-foreground/50">#</th>
        {columns.map((col) => {
          const width = col.width ?? DEFAULT_WIDTH;
          const isSorted = sortState?.columnId === col.id;
          const isDragging = draggingId === col.id;
          const isDropBefore = dropTarget?.id === col.id && dropTarget.side === "before";
          const isDropAfter = dropTarget?.id === col.id && dropTarget.side === "after";

          return (
            <th
              key={col.id}
              style={{ width, minWidth: width, maxWidth: width }}
              className={cn(
                "group relative border-r border-border/50 px-0 py-0 text-left text-xs font-medium text-muted-foreground select-none",
                isDragging && "opacity-40",
              )}
              onDragOver={(e) => {
                // Accept the drop if we're the target of an openhelm column drag.
                const types = e.dataTransfer.types;
                const isColumnDrag =
                  (types && types.includes(DND_MIME)) ||
                  (draggingId !== null && draggingId !== col.id);
                if (!isColumnDrag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                // Decide which side of this column to drop on based on mouse X.
                const rect = e.currentTarget.getBoundingClientRect();
                const side: "before" | "after" =
                  e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                setDropTarget((prev) =>
                  prev?.id === col.id && prev.side === side ? prev : { id: col.id, side },
                );
              }}
              onDragLeave={(e) => {
                // Only clear if the pointer actually left the cell (not just moved into a child).
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setDropTarget((prev) => (prev?.id === col.id ? null : prev));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData(DND_MIME) || draggingId;
                const side = dropTarget?.id === col.id ? dropTarget.side : "after";
                setDropTarget(null);
                setDraggingId(null);
                if (!fromId || fromId === col.id) return;
                // Build the new column-id order: remove the source, then insert
                // it at the right position relative to the target.
                const sourceIdx = columns.findIndex((c) => c.id === fromId);
                const targetIdx = columns.findIndex((c) => c.id === col.id);
                if (sourceIdx === -1 || targetIdx === -1) return;
                const ids = columns.map((c) => c.id);
                ids.splice(sourceIdx, 1);
                // After removal, `targetIdx` shifts if source was before it.
                const adjustedTargetIdx = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx;
                const insertAt = side === "before" ? adjustedTargetIdx : adjustedTargetIdx + 1;
                ids.splice(insertAt, 0, fromId);
                onColumnsReorder(ids);
              }}
            >
              {/* Drop-target indicators */}
              {isDropBefore && (
                <div className="pointer-events-none absolute left-0 top-0 h-full w-0.5 bg-primary" />
              )}
              {isDropAfter && (
                <div className="pointer-events-none absolute right-0 top-0 h-full w-0.5 bg-primary" />
              )}

              {/* Draggable content row. Putting `draggable` on the inner div
                  avoids WKWebView's flaky drag support on <th> elements. */}
              <div
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDraggingId(col.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(DND_MIME, col.id);
                  // Fallback for browsers that don't expose custom mime types in dragover:
                  e.dataTransfer.setData("text/plain", col.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTarget(null);
                }}
                onClick={() => handleSortClick(col.id)}
                className="flex cursor-pointer items-center gap-1.5 px-3 py-2"
                title="Click to sort, drag to reorder"
              >
                <GripVertical className="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                <ColumnTypeIcon type={col.type} className="size-3 shrink-0" />
                <span className="truncate">{col.name}</span>
                {isSorted && sortState.direction === "asc" && (
                  <ArrowUp className="size-3 shrink-0 text-foreground/60" />
                )}
                {isSorted && sortState.direction === "desc" && (
                  <ArrowDown className="size-3 shrink-0 text-foreground/60" />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onColumnRemove(col.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="ml-auto flex size-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                  title="Remove column"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
              {/* Resize handle — drag the right edge. Sits above the <th> so
                  its pointer events don't reach the draggable content div. */}
              <div
                onPointerDown={(e) => handleResizeStart(e, col.id, width)}
                className={cn(
                  "absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize",
                  "hover:bg-primary/40 active:bg-primary/60 transition-colors",
                )}
                title="Drag to resize"
              />
            </th>
          );
        })}
        <th className="w-8" />
      </tr>
    </thead>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
