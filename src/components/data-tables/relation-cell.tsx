import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Check } from "lucide-react";
import type { DataTableColumn, DataTable, DataTableRow } from "@openhelm/shared";

// ─── Types ───

export interface RelatedTableData {
  table: DataTable;
  rows: DataTableRow[];
}

interface RelationCellProps {
  column: DataTableColumn;
  value: unknown;
  onChange: (v: unknown) => void;
  relatedData: Map<string, RelatedTableData>;
}

// ─── Helpers ───

function getRowTitle(table: DataTable, row: DataTableRow): string {
  const textCol = table.columns.find((c) => c.type === "text");
  if (textCol && row.data[textCol.id]) return String(row.data[textCol.id]);
  return row.id.slice(0, 8);
}

// ─── Relation pill ───

function RelationPill({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium max-w-[150px] truncate bg-muted text-muted-foreground">
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}

// ─── Relation dropdown ───

interface RelationDropdownProps {
  anchorRect: DOMRect;
  targetTable: DataTable;
  targetRows: DataTableRow[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onDeselect: (id: string) => void;
  onClose: () => void;
}

function RelationDropdown({
  anchorRect,
  targetTable,
  targetRows,
  selectedIds,
  onSelect,
  onDeselect,
  onClose,
}: RelationDropdownProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = targetRows.filter((row) => {
    const title = getRowTitle(targetTable, row);
    return title.toLowerCase().includes(search.toLowerCase());
  });

  const handleToggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onDeselect(id);
    } else {
      onSelect(id);
    }
  };

  const PANEL_WIDTH = 240;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow > 220 ? anchorRect.bottom + 2 : anchorRect.top - 220 - 2;
  const left = Math.min(anchorRect.left, Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN));

  const panel = (
    <div
      ref={panelRef}
      style={{ position: "fixed", top, left, width: PANEL_WIDTH, zIndex: 9999 }}
      className="rounded-md border border-border bg-popover shadow-lg"
    >
      <div className="border-b border-border px-2 py-1.5">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          placeholder={`Search ${targetTable.name}...`}
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <div className="max-h-52 overflow-y-auto p-1">
        {filtered.length === 0 && (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">No rows found</p>
        )}
        {filtered.map((row) => {
          const title = getRowTitle(targetTable, row);
          const selected = selectedIds.includes(row.id);
          return (
            <button
              key={row.id}
              onMouseDown={(e) => { e.preventDefault(); handleToggle(row.id); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
            >
              <span className="flex-1 text-left truncate">{title}</span>
              {selected && <Check className="size-3 shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

// ─── Relation cell ───

export function RelationCell({ column, value, onChange, relatedData }: RelationCellProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const config = column.config as { targetTableId?: string };
  const targetTableId = config.targetTableId ?? "";
  const related = relatedData.get(targetTableId);
  const selectedIds = (Array.isArray(value) ? value : []) as string[];

  const handleOpen = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  };

  // Build pill labels from related data
  const pills = selectedIds.map((rowId) => {
    if (!related) return { id: rowId, label: rowId.slice(0, 8) };
    const row = related.rows.find((r) => r.id === rowId);
    if (!row) return { id: rowId, label: "Deleted" };
    return { id: rowId, label: getRowTitle(related.table, row) };
  });

  return (
    <div className="relative w-full min-h-[30px]">
      <div
        ref={triggerRef}
        onClick={handleOpen}
        className="flex min-h-[30px] cursor-pointer flex-wrap items-center gap-1 px-2 py-1 hover:bg-accent/30 transition-colors"
      >
        {pills.length > 0 ? (
          pills.map((p) => (
            <RelationPill
              key={p.id}
              label={p.label}
              onRemove={() => onChange(selectedIds.filter((id) => id !== p.id))}
            />
          ))
        ) : (
          <span className="text-muted-foreground/30 text-sm">-</span>
        )}
      </div>
      {open && anchorRect && related && (
        <RelationDropdown
          anchorRect={anchorRect}
          targetTable={related.table}
          targetRows={related.rows}
          selectedIds={selectedIds}
          onSelect={(id) => onChange([...selectedIds, id])}
          onDeselect={(id) => onChange(selectedIds.filter((s) => s !== id))}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
