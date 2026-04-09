-- Per-tool invocation stats captured from each run's stream-json output.
-- Tracks how many times each tool was called and approximate output tokens
-- attributed to turns involving that tool.

CREATE TABLE IF NOT EXISTS run_tool_stats (
  run_id              TEXT    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tool_name           TEXT    NOT NULL,
  invocations         INTEGER NOT NULL DEFAULT 0,
  approx_output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, tool_name)
);
