// Auto-imported SQL migrations — esbuild bundles these as inline strings.
// When adding a new migration, import it here and append to the array below.

import sql0000 from "./migrations/0000_dazzling_smiling_tiger.sql";
import sql0001 from "./migrations/0001_classy_skrulls.sql";
import sql0002 from "./migrations/0002_icy_phil_sheldon.sql";
import sql0003 from "./migrations/0003_add_job_is_archived.sql";
import sql0004 from "./migrations/0004_add_goal_name_and_chat.sql";
import sql0005 from "./migrations/0005_add_model_and_calendar.sql";
import sql0006 from "./migrations/0006_add_permission_mode.sql";
import sql0007 from "./migrations/0007_add_icon.sql";
import sql0008 from "./migrations/0008_add_deferred_runs.sql";
import sql0009 from "./migrations/0009_add_self_correction.sql";
import sql0010 from "./migrations/0010_add_inbox_items.sql";
import sql0011 from "./migrations/0011_add_session_id.sql";
import sql0012 from "./migrations/0012_rename_correction_to_post_prompt.sql";
import sql0013 from "./migrations/0013_add_performance_indexes.sql";
import sql0014 from "./migrations/0014_rename_to_correction_note.sql";
import sql0015 from "./migrations/0015_add_memories.sql";
import sql0016 from "./migrations/0016_add_token_usage.sql";
import sql0017 from "./migrations/0017_add_silence_timeout.sql";
import sql0018 from "./migrations/0018_add_credentials.sql";
import sql0019 from "./migrations/0019_add_autopilot.sql";
import sql0020 from "./migrations/0020_add_credential_scope_bindings.sql";
import sql0021 from "./migrations/0021_add_run_credentials_pk.sql";
import sql0022 from "./migrations/0022_chat_nullable_project.sql";
import sql0023 from "./migrations/0023_add_sort_order.sql";
import sql0024 from "./migrations/0024_nullable_inbox_run_id.sql";
import sql0025 from "./migrations/0025_add_browser_injection.sql";
import sql0026 from "./migrations/0026_add_data_tables.sql";
import sql0027 from "./migrations/0027_add_claude_usage_snapshots.sql";
import sql0028 from "./migrations/0028_add_targets.sql";
import sql0029 from "./migrations/0029_add_visualizations.sql";
import sql0030 from "./migrations/0030_add_conversation_sort_order.sql";

export interface MigrationEntry {
  idx: number;
  tag: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  { idx: 0, tag: "0000_dazzling_smiling_tiger", sql: sql0000 },
  { idx: 1, tag: "0001_classy_skrulls", sql: sql0001 },
  { idx: 2, tag: "0002_icy_phil_sheldon", sql: sql0002 },
  { idx: 3, tag: "0003_add_job_is_archived", sql: sql0003 },
  { idx: 4, tag: "0004_add_goal_name_and_chat", sql: sql0004 },
  { idx: 5, tag: "0005_add_model_and_calendar", sql: sql0005 },
  { idx: 6, tag: "0006_add_permission_mode", sql: sql0006 },
  { idx: 7, tag: "0007_add_icon", sql: sql0007 },
  { idx: 8, tag: "0008_add_deferred_runs", sql: sql0008 },
  { idx: 9, tag: "0009_add_self_correction", sql: sql0009 },
  { idx: 10, tag: "0010_add_inbox_items", sql: sql0010 },
  { idx: 11, tag: "0011_add_session_id", sql: sql0011 },
  { idx: 12, tag: "0012_rename_correction_to_post_prompt", sql: sql0012 },
  { idx: 13, tag: "0013_add_performance_indexes", sql: sql0013 },
  { idx: 14, tag: "0014_rename_to_correction_note", sql: sql0014 },
  { idx: 15, tag: "0015_add_memories", sql: sql0015 },
  { idx: 16, tag: "0016_add_token_usage", sql: sql0016 },
  { idx: 17, tag: "0017_add_silence_timeout", sql: sql0017 },
  { idx: 18, tag: "0018_add_credentials", sql: sql0018 },
  { idx: 19, tag: "0019_add_autopilot", sql: sql0019 },
  { idx: 20, tag: "0020_add_credential_scope_bindings", sql: sql0020 },
  { idx: 21, tag: "0021_add_run_credentials_pk", sql: sql0021 },
  { idx: 22, tag: "0022_chat_nullable_project", sql: sql0022 },
  { idx: 23, tag: "0023_add_sort_order", sql: sql0023 },
  { idx: 24, tag: "0024_nullable_inbox_run_id", sql: sql0024 },
  { idx: 25, tag: "0025_add_browser_injection", sql: sql0025 },
  { idx: 26, tag: "0026_add_data_tables", sql: sql0026 },
  { idx: 27, tag: "0027_add_claude_usage_snapshots", sql: sql0027 },
  { idx: 28, tag: "0028_add_targets", sql: sql0028 },
  { idx: 29, tag: "0029_add_visualizations", sql: sql0029 },
  { idx: 30, tag: "0030_add_conversation_sort_order", sql: sql0030 },
];
