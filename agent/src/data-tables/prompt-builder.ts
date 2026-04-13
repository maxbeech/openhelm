/**
 * Formats relevant data table schemas into a prompt section.
 * Injected into job prompts alongside the memory section.
 *
 * Only includes schema summaries (name, description, columns, row count)
 * — never dumps actual row data into the prompt. The AI uses MCP tools
 * to query specific data when needed.
 */

import type { ScoredDataTable } from "./retriever.js";
import type { DataTableColumn } from "@openhelm/shared";

/**
 * Build a formatted data table section to append to a prompt.
 * Returns empty string if no tables provided.
 */
export function buildDataTableSection(scored: ScoredDataTable[]): string {
  if (scored.length === 0) return "";

  const sections: string[] = [
    "## Available Data Tables",
    "",
    "The following data tables are available in this project. " +
      "**Use the openhelm_data MCP tools** (`mcp__openhelm_data__*`) to " +
      "query or modify them — they handle id generation, timestamps, " +
      "and the data_table_changes audit log for you. Do NOT use the " +
      "Bash tool with `sqlite3` to read or write these tables unless " +
      "the MCP tools cannot express what you need.",
    "",
    "If you must fall back to raw `sqlite3` via Bash, INSERT into the " +
      "`data_table_rows_autofill` view — not `data_table_rows` directly. " +
      "The view auto-fills `id` (pseudo-UUID), `created_at`, and " +
      "`updated_at`, so `INSERT INTO data_table_rows_autofill " +
      "(table_id, data) VALUES ('tbl_xxx', '{\"col_abc\":\"hello\"}')` " +
      "works. Inserting into `data_table_rows` directly without supplying " +
      "`id` and `updated_at` will fail with a NOT NULL constraint error.",
    "",
  ];

  for (const { table } of scored) {
    sections.push(`### ${table.name} (${table.rowCount} rows)`);
    if (table.description) {
      sections.push(table.description);
    }

    if (table.columns.length > 0) {
      sections.push("| Column | Type |");
      sections.push("|--------|------|");
      for (const col of table.columns) {
        sections.push(`| ${col.name} | ${formatColumnType(col, scored)} |`);
      }
    }

    sections.push("");
  }

  return `\n---\n\n${sections.join("\n")}`;
}

function formatColumnType(col: DataTableColumn, scoredTables?: ScoredDataTable[]): string {
  let desc = col.type as string;
  const config = col.config;

  if (col.type === "select" || col.type === "multi_select") {
    const options = config?.options as Array<{ label: string }> | undefined;
    if (options && options.length > 0) {
      const labels = options.map((o) => o.label).join(", ");
      desc += ` (${labels})`;
    }
  }

  if (col.type === "number" && config?.format) {
    desc += ` (${config.format})`;
  }

  if (col.type === "relation") {
    const targetId = config?.targetTableId as string | undefined;
    if (targetId && scoredTables) {
      const target = scoredTables.find((s) => s.table.id === targetId);
      if (target) desc += ` (→ ${target.table.name})`;
    }
  }

  if (col.type === "rollup") {
    const agg = config?.aggregation as string | undefined;
    desc += agg ? ` (${agg}, computed)` : " (computed)";
  }

  if (col.type === "formula") {
    const expr = config?.expression as string | undefined;
    desc += expr ? ` (${expr})` : " (computed)";
  }

  if (col.type === "phone") desc += " (phone number)";
  if (col.type === "files") desc += " (attachments)";
  if (col.type === "created_time") desc += " (auto, read-only)";
  if (col.type === "updated_time") desc += " (auto, read-only)";

  return desc;
}
