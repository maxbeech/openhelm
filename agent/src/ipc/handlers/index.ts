import { registerProjectHandlers } from "./projects.js";
import { registerGoalHandlers } from "./goals.js";
import { registerJobHandlers } from "./jobs.js";
import { registerRunHandlers } from "./runs.js";
import { registerSettingHandlers } from "./settings.js";
import { registerClaudeCodeHandlers } from "./claude-code.js";
import { registerSchedulerHandlers } from "./scheduler.js";

/** Register all domain IPC handlers */
export function registerAllHandlers() {
  registerProjectHandlers();
  registerGoalHandlers();
  registerJobHandlers();
  registerRunHandlers();
  registerSettingHandlers();
  registerClaudeCodeHandlers();
  registerSchedulerHandlers();
}
