/**
 * Re-exports PrintError as the canonical LLM-call error type for code outside
 * the agent-backend/claude-code/ directory. This ensures no file outside the
 * backend layer needs to import directly from claude-code/print.ts.
 */
export { PrintError } from "../claude-code/print.js";
