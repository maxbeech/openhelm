/**
 * Validates and coerces row data against column schema.
 * Ensures type safety on AI writes without being overly strict.
 *
 * Coercion rules:
 * - Numbers: accept string-encoded numbers ("5000" → 5000)
 * - Dates: accept common formats, normalize to ISO 8601
 * - Selects: accept option labels (fuzzy-match), not just IDs
 * - Booleans: accept "true"/"false"/"yes"/"no" strings
 */

import type { DataTableColumn, FileReference } from "@openhelm/shared";

/**
 * Validate and coerce row data in-place.
 * Mutates the data object to normalize values.
 * Throws on values that can't be coerced.
 */
export function validateRowData(
  columns: DataTableColumn[],
  data: Record<string, unknown>,
): void {
  for (const [colId, value] of Object.entries(data)) {
    // Remove null/undefined from writes — let the DB use its default
    if (value === null || value === undefined) {
      delete data[colId];
      continue;
    }

    const col = columns.find((c) => c.id === colId);
    if (!col) continue; // Extra keys are ignored (not an error)

    const coerced = coerceValue(col, value);
    if (coerced === undefined) {
      delete data[colId]; // Strip computed/system columns from writes
    } else {
      data[colId] = coerced;
    }
  }
}

function coerceValue(col: DataTableColumn, value: unknown): unknown {
  switch (col.type) {
    case "text":
    case "url":
    case "email":
      return String(value);

    case "number": {
      if (typeof value === "number") return value;
      // Treat empty string as "not set" — remove from writes rather than throwing
      if (value === "") return undefined;
      const n = Number(value);
      if (isNaN(n)) throw new Error(`Column "${col.name}": "${value}" is not a valid number`);
      return n;
    }

    case "checkbox": {
      if (typeof value === "boolean") return value;
      const s = String(value).toLowerCase();
      if (s === "true" || s === "yes" || s === "1") return true;
      if (s === "false" || s === "no" || s === "0") return false;
      throw new Error(`Column "${col.name}": "${value}" is not a valid boolean`);
    }

    case "date": {
      const str = String(value);
      const d = new Date(str);
      if (isNaN(d.getTime())) throw new Error(`Column "${col.name}": "${value}" is not a valid date`);
      return d.toISOString();
    }

    case "select": {
      const raw = (col.config?.options ?? []) as Array<string | { id?: string; label: string }>;
      const options = normaliseOptions(raw);
      return resolveSelectOption(col.name, options, value);
    }

    case "multi_select": {
      const raw = (col.config?.options ?? []) as Array<string | { id?: string; label: string }>;
      const options = normaliseOptions(raw);
      const values = Array.isArray(value) ? value : [value];
      return values.map((v) => resolveSelectOption(col.name, options, v));
    }

    case "relation": {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v) => String(v));
    }

    case "phone":
      return String(value);

    case "files": {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v) => {
        if (typeof v === "string") {
          return { id: crypto.randomUUID().slice(0, 8), name: v, url: v } as FileReference;
        }
        const obj = v as Record<string, unknown>;
        return {
          id: obj.id ?? crypto.randomUUID().slice(0, 8),
          name: obj.name ?? obj.url ?? "file",
          url: obj.url ?? obj.path ?? "",
          size: obj.size,
          mimeType: obj.mimeType ?? obj.type,
        } as FileReference;
      });
    }

    // Computed/system columns — AI should not write to these
    case "rollup":
    case "formula":
    case "created_time":
    case "updated_time":
      return undefined; // strip from writes

    default:
      return value;
  }
}

/**
 * Normalise select options to a consistent { id, label } shape.
 * Options may be stored as plain strings ("low") or objects ({ label: "low" }).
 */
function normaliseOptions(raw: Array<string | { id?: string; label: string }>): Array<{ id: string; label: string }> {
  return raw.map((o) => {
    if (typeof o === "string") return { id: o, label: o };
    return { id: o.id ?? o.label, label: o.label };
  });
}

/**
 * Resolve a select value to a valid option ID.
 * Accepts: exact ID, exact label, or case-insensitive label match.
 */
function resolveSelectOption(
  colName: string,
  options: Array<{ id: string; label: string }>,
  value: unknown,
): string {
  const str = String(value);

  // Exact ID match
  const byId = options.find((o) => o.id === str);
  if (byId) return byId.id;

  // Exact label match
  const byLabel = options.find((o) => o.label === str);
  if (byLabel) return byLabel.id;

  // Case-insensitive label match
  const lower = str.toLowerCase();
  const byLabelCI = options.find((o) => o.label.toLowerCase() === lower);
  if (byLabelCI) return byLabelCI.id;

  // No match — but if there are no options defined, allow raw value
  if (options.length === 0) return str;

  const validLabels = options.map((o) => o.label).join(", ");
  throw new Error(`Column "${colName}": "${str}" is not a valid option. Valid: ${validLabels}`);
}
