import { registerHandler } from "../handler.js";
import {
  detectClaudeCode,
  checkClaudeCodeHealth,
} from "../../claude-code/detector.js";
import { getSetting } from "../../db/queries/settings.js";
import { captureAgentError } from "../../sentry.js";
import type {
  DetectClaudeCodeParams,
  VerifyClaudeCodeParams,
  ClaudeCodeDetectionResult,
} from "@openhelm/shared";

export function registerClaudeCodeHandlers() {
  /**
   * Auto-detect the Claude Code CLI.
   * Optionally accepts a manual path to verify instead.
   */
  registerHandler("claudeCode.detect", async (params) => {
    const p = params as DetectClaudeCodeParams | undefined;
    const result = await detectClaudeCode(p?.manualPath);
    if (!result.found) {
      captureAgentError(
        new Error(`Claude Code detection failed: ${result.error}`),
        { errorCode: "cliDetectionFailed" },
      );
    }
    return result;
  });

  /**
   * Verify a specific Claude Code binary path.
   * Routes through detectClaudeCode to validate AND persist on success.
   */
  registerHandler("claudeCode.verify", async (params) => {
    const p = params as VerifyClaudeCodeParams;
    if (!p?.path) throw new Error("path is required");
    const result = await detectClaudeCode(p.path);
    if (!result.found) {
      captureAgentError(
        new Error(`Manual CLI path verification failed: ${result.error}`),
        { errorCode: "cliVerifyFailed" },
      );
    }
    return result;
  });

  /**
   * Get the current Claude Code detection status from settings.
   * Does not re-run detection — just reads stored values.
   */
  registerHandler("claudeCode.getStatus", () => {
    const pathSetting = getSetting("claude_code_path");
    const versionSetting = getSetting("claude_code_version");

    const result: ClaudeCodeDetectionResult = {
      found: pathSetting !== null,
      path: pathSetting?.value ?? null,
      version: versionSetting?.value ?? null,
      meetsMinVersion: pathSetting !== null,
    };

    return result;
  });

  /**
   * Run a health check to verify Claude Code is authenticated and functional.
   * Spawns a minimal --print call to confirm the session is active.
   */
  registerHandler("claudeCode.checkHealth", async () => {
    const result = await checkClaudeCodeHealth();
    if (!result.healthy) {
      captureAgentError(
        new Error(`Claude Code health check failed: ${result.error}`),
        { errorCode: "cliHealthCheckFailed" },
      );
    }
    return result;
  });
}
