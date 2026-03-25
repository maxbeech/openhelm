import { spawnSync } from "child_process";
import { registerHandler } from "../handler.js";

export function registerPermissionHandlers() {
  /**
   * Trigger Terminal automation TCC prompt via a benign osascript call.
   * macOS shows "OpenHelm wants to control Terminal" exactly once; with
   * proper entitlements the user's choice persists across launches.
   */
  registerHandler("permissions.requestTerminalAccess", () => {
    const result = spawnSync("osascript", [
      "-e",
      'tell application "Terminal" to get name',
    ], { timeout: 30_000 });
    return {
      granted: result.status === 0,
      error: result.status !== 0 ? result.stderr?.toString() : undefined,
    };
  });

  /**
   * Check whether Terminal automation permission is currently granted.
   * Runs the same benign osascript and checks the exit code.
   */
  registerHandler("permissions.checkTerminalAccess", () => {
    const result = spawnSync("osascript", [
      "-e",
      'tell application "Terminal" to get name',
    ], { timeout: 5_000 });
    return { granted: result.status === 0 };
  });
}
