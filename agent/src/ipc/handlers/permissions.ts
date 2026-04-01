import { spawnSync } from "child_process";
import { registerHandler } from "../handler.js";
import { getSetting, setSetting } from "../../db/queries/settings.js";

export function registerPermissionHandlers() {
  /**
   * Trigger Terminal automation TCC prompt via a benign osascript call.
   * macOS shows the TCC dialog on first use; once granted we cache the
   * result in settings so subsequent page loads don't re-trigger osascript.
   */
  registerHandler("permissions.requestTerminalAccess", () => {
    const result = spawnSync("osascript", [
      "-e",
      'tell application "Terminal" to get name',
    ], { timeout: 30_000 });
    const granted = result.status === 0;
    if (granted) {
      setSetting("terminal_access_granted", "true");
    }
    return {
      granted,
      error: !granted ? result.stderr?.toString() : undefined,
    };
  });

  /**
   * Check whether Terminal automation permission is currently granted.
   * Returns the cached result from settings to avoid re-triggering the
   * TCC prompt on every settings page load. The cache is set when the
   * user explicitly grants access via requestTerminalAccess.
   */
  registerHandler("permissions.checkTerminalAccess", () => {
    const cached = getSetting("terminal_access_granted");
    if (cached?.value === "true") {
      return { granted: true };
    }
    // No cached grant — report denied without running osascript.
    return { granted: false };
  });
}
