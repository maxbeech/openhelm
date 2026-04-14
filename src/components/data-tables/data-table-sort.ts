import type { DataTableColumn, DataTableRow, SelectOption } from "@openhelm/shared";

export type SortDirection = "asc" | "desc";

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

// ─── Persistence ────────────────────────────────────────────────────────────
// Sort preference is per-table and survives navigation + app restart.
// Stored as JSON under `dataTable.sort.<tableId>` in localStorage.

function sortStorageKey(tableId: string): string {
  return `dataTable.sort.${tableId}`;
}

export function loadSortState(tableId: string): SortState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(sortStorageKey(tableId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "columnId" in parsed &&
      "direction" in parsed &&
      typeof (parsed as SortState).columnId === "string" &&
      ((parsed as SortState).direction === "asc" || (parsed as SortState).direction === "desc")
    ) {
      return parsed as SortState;
    }
  } catch {
    // Corrupt JSON — fall through to no sort.
  }
  return null;
}

export function saveSortState(tableId: string, state: SortState | null): void {
  if (typeof window === "undefined") return;
  const key = sortStorageKey(tableId);
  if (state === null) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, JSON.stringify(state));
  }
}

/**
 * Toggle cycle for clicking a header: none → asc → desc → none.
 * Clicking a different column resets to asc on that column.
 */
export function cycleSort(current: SortState | null, columnId: string): SortState | null {
  if (!current || current.columnId !== columnId) {
    return { columnId, direction: "asc" };
  }
  if (current.direction === "asc") return { columnId, direction: "desc" };
  return null;
}

/**
 * Return a comparator for two cell values using the column type.
 * Empty values always sort to the end regardless of direction.
 */
export function compareCells(
  a: unknown,
  b: unknown,
  column: DataTableColumn,
  direction: SortDirection,
): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const sign = direction === "asc" ? 1 : -1;

  switch (column.type) {
    case "number": {
      const na = Number(a);
      const nb = Number(b);
      return (na - nb) * sign;
    }
    case "date":
    case "created_time":
    case "updated_time": {
      const da = Date.parse(String(a));
      const db = Date.parse(String(b));
      return (da - db) * sign;
    }
    case "checkbox": {
      return ((a ? 1 : 0) - (b ? 1 : 0)) * sign;
    }
    case "select": {
      // Row value is the option id — look up the label for comparison so
      // sort matches the rendered order.
      const opts = (column.config?.options ?? []) as SelectOption[];
      const la = optionLabel(opts, a) ?? "";
      const lb = optionLabel(opts, b) ?? "";
      return la.localeCompare(lb) * sign;
    }
    case "multi_select": {
      const opts = (column.config?.options ?? []) as SelectOption[];
      const la = Array.isArray(a) ? a.map((id) => optionLabel(opts, id) ?? "").join(",") : "";
      const lb = Array.isArray(b) ? b.map((id) => optionLabel(opts, id) ?? "").join(",") : "";
      return la.localeCompare(lb) * sign;
    }
    case "files": {
      const na = Array.isArray(a) ? a.length : 0;
      const nb = Array.isArray(b) ? b.length : 0;
      return (na - nb) * sign;
    }
    default: {
      // text, url, email, phone, relation (by stringified value), formula, rollup
      return String(a).localeCompare(String(b), undefined, { numeric: true }) * sign;
    }
  }
}

function optionLabel(options: SelectOption[], id: unknown): string | null {
  if (typeof id !== "string") return null;
  const opt = options.find((o) => o.id === id);
  return opt ? opt.label : null;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Returns a new array sorted according to sortState, or the original if no sort. */
export function sortRows(
  rows: DataTableRow[],
  columns: DataTableColumn[],
  sortState: SortState | null,
): DataTableRow[] {
  if (!sortState) return rows;
  const column = columns.find((c) => c.id === sortState.columnId);
  if (!column) return rows;

  // Stable sort: decorate with original index, then compare.
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const cmp = compareCells(
        a.row.data[column.id],
        b.row.data[column.id],
        column,
        sortState.direction,
      );
      return cmp !== 0 ? cmp : a.idx - b.idx;
    })
    .map((e) => e.row);
}
