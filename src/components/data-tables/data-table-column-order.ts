import type { DataTableColumn } from "@openhelm/shared";

/**
 * Move a column from index `from` to index `to` and return a new array.
 * Out-of-range indices return the array unchanged.
 */
export function reorderColumns(
  columns: DataTableColumn[],
  from: number,
  to: number,
): DataTableColumn[] {
  if (from === to) return columns;
  if (from < 0 || from >= columns.length) return columns;
  if (to < 0 || to >= columns.length) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Convenience: move by column id instead of index. */
export function reorderColumnsById(
  columns: DataTableColumn[],
  fromId: string,
  toId: string,
): DataTableColumn[] {
  const from = columns.findIndex((c) => c.id === fromId);
  const to = columns.findIndex((c) => c.id === toId);
  if (from === -1 || to === -1) return columns;
  return reorderColumns(columns, from, to);
}
