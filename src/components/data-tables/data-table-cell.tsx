import { useState, useRef } from "react";
import type { DataTableColumn, DataTableRow } from "@openhelm/shared";
import { SelectCell, MultiSelectCell } from "./select-cell";
import { RelationCell, type RelatedTableData } from "./relation-cell";
import { PhoneCell } from "./phone-cell";
import { FilesCell } from "./files-cell";
import { RollupCell } from "./rollup-cell";
import { FormulaCell } from "./formula-cell";
import { TimestampCell } from "./timestamp-cell";
import { CellPopout, type PopoutInputType } from "./data-table-cell-popout";

interface Props {
  column: DataTableColumn;
  value: unknown;
  onChange: (value: unknown) => void;
  onColumnConfigUpdate?: (config: Record<string, unknown>) => void;
  relatedData?: Map<string, RelatedTableData>;
  row?: DataTableRow;
  allColumns?: DataTableColumn[];
}

export function DataTableCell({ column, value, onChange, onColumnConfigUpdate, relatedData, row, allColumns }: Props) {
  const noop = () => {};
  switch (column.type) {
    case "checkbox":
      return <CheckboxCell value={value} onChange={onChange} />;
    case "select":
      return (
        <SelectCell
          column={column}
          value={value}
          onChange={onChange}
          onColumnConfigUpdate={onColumnConfigUpdate ?? noop}
        />
      );
    case "multi_select":
      return (
        <MultiSelectCell
          column={column}
          value={value}
          onChange={onChange}
          onColumnConfigUpdate={onColumnConfigUpdate ?? noop}
        />
      );
    case "relation":
      return (
        <RelationCell
          column={column}
          value={value}
          onChange={onChange}
          relatedData={relatedData ?? new Map()}
        />
      );
    case "phone":
      return <PhoneCell value={value} onChange={onChange} />;
    case "files":
      return <FilesCell value={value} onChange={onChange} />;
    case "rollup": {
      // Get the relation column value from the same row for rollup computation
      const config = column.config as { relationColumnId?: string };
      const relationValue = config.relationColumnId && row ? row.data[config.relationColumnId] : [];
      return (
        <RollupCell
          column={column}
          relationValue={relationValue}
          relatedData={relatedData ?? new Map()}
          allColumns={allColumns ?? []}
        />
      );
    }
    case "formula":
      return (
        <FormulaCell
          column={column}
          rowData={row?.data ?? {}}
          allColumns={allColumns ?? []}
        />
      );
    case "created_time":
      return <TimestampCell value={row?.createdAt ?? null} />;
    case "updated_time":
      return <TimestampCell value={row?.updatedAt ?? null} />;
    default:
      return <TextCell value={value} onChange={onChange} type={column.type} />;
  }
}

// ─── Text-based cell (text, number, date, url, email) ───
//
// Click opens a Notion-style floating popout editor via createPortal. This
// lets long values be viewed and edited comfortably without stretching the
// cell or clipping the text. Multiline text cells use a textarea; others use
// a single-line input with a type-appropriate keyboard.

function TextCell({ value, onChange, type }: { value: unknown; onChange: (v: unknown) => void; type: string }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const displayValue = value !== null && value !== undefined ? String(value) : "";

  const handleOpen = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  };

  const handleCommit = (next: string) => {
    let parsed: unknown = next || null;
    if (type === "number" && next) {
      const n = Number(next);
      parsed = isNaN(n) ? null : n;
    }
    if (parsed !== value) onChange(parsed);
  };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleOpen}
        className="min-h-[30px] cursor-text px-3 py-1.5 text-sm truncate"
        title={displayValue}
      >
        {displayValue || <span className="text-muted-foreground/30">-</span>}
      </div>
      {open && anchorRect && (
        <CellPopout
          anchorRect={anchorRect}
          initialValue={displayValue}
          type={popoutTypeForColumn(type)}
          onCommit={handleCommit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function popoutTypeForColumn(type: string): PopoutInputType {
  // `text` columns get a multiline textarea; everything else gets a
  // single-line input with the right keyboard type.
  if (type === "text") return "textarea";
  if (type === "number") return "number";
  if (type === "url") return "url";
  if (type === "email") return "email";
  if (type === "date") return "date";
  return "text";
}

// ─── Checkbox cell ───

function CheckboxCell({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div className="flex items-center justify-center min-h-[30px]">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 rounded border-input"
      />
    </div>
  );
}
