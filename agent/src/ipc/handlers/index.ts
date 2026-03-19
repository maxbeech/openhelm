import { registerProjectHandlers } from "./projects.js";
import { registerGoalHandlers } from "./goals.js";
import { registerJobHandlers } from "./jobs.js";
import { registerRunHandlers } from "./runs.js";
import { registerSettingHandlers } from "./settings.js";
import { registerClaudeCodeHandlers } from "./claude-code.js";
import { registerSchedulerHandlers } from "./scheduler.js";
import { registerChatHandlers } from "./chat.js";
import { registerInboxHandlers } from "./inbox.js";
import { registerMemoryHandlers } from "./memories.js";
import { registerDataHandlers } from "./data.js";
import { registerPowerHandlers } from "./power.js";
import { registerLicenseHandlers } from "./license.js";

/** Register all domain IPC handlers */
export function registerAllHandlers() {
  registerProjectHandlers();
  registerGoalHandlers();
  registerJobHandlers();
  registerRunHandlers();
  registerSettingHandlers();
  registerClaudeCodeHandlers();
  registerSchedulerHandlers();
  registerChatHandlers();
  registerInboxHandlers();
  registerMemoryHandlers();
  registerDataHandlers();
  registerPowerHandlers();
  registerLicenseHandlers();
}
