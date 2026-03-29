import { registerHandler } from "../handler.js";
import { usageService } from "../../usage/service.js";
import { getSetting, setSetting } from "../../db/queries/settings.js";
import type { SettingKey } from "@openhelm/shared";

export function registerUsageHandlers() {
  registerHandler("usage.getSummary", () => {
    return usageService.getUsageSummary();
  });

  registerHandler("usage.getSettings", () => {
    const daily = getSetting("claude_daily_budget" as SettingKey);
    const weekly = getSetting("claude_weekly_budget" as SettingKey);
    return {
      dailyBudget: daily ? parseInt(daily.value, 10) : null,
      weeklyBudget: weekly ? parseInt(weekly.value, 10) : null,
    };
  });

  registerHandler("usage.setSettings", (params) => {
    const p = params as { dailyBudget?: number | null; weeklyBudget?: number | null };
    if (p.dailyBudget !== undefined) {
      if (p.dailyBudget === null) {
        // Clear by setting to empty; frontend treats "0" or missing as unset
        setSetting("claude_daily_budget" as SettingKey, "");
      } else {
        setSetting("claude_daily_budget" as SettingKey, String(p.dailyBudget));
      }
    }
    if (p.weeklyBudget !== undefined) {
      if (p.weeklyBudget === null) {
        setSetting("claude_weekly_budget" as SettingKey, "");
      } else {
        setSetting("claude_weekly_budget" as SettingKey, String(p.weeklyBudget));
      }
    }
    return { ok: true };
  });

  /** Manually trigger a usage refresh (useful for testing) */
  registerHandler("usage.refresh", async () => {
    await usageService.refresh();
    return { ok: true };
  });
}
