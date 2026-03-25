import { registerHandler } from "../handler.js";
import * as settingQueries from "../../db/queries/settings.js";
import type { SettingKey, SetSettingParams } from "@openhelm/shared";
import { subscribeToNewsletter } from "../../newsletter/resend.js";
import {
  syncWakeEvents,
  cancelAllWakes,
  invalidatePowerCache,
} from "../../power/index.js";
import { removeSudoersEntry } from "../../power/wake-scheduler.js";
import { emit } from "../emitter.js";

export function registerSettingHandlers() {
  registerHandler("settings.get", (params) => {
    const { key } = params as { key: SettingKey };
    if (!key) throw new Error("key is required");
    return settingQueries.getSetting(key);
  });

  registerHandler("settings.list", () => {
    return settingQueries.getAllSettings();
  });

  registerHandler("settings.set", async (params) => {
    const p = params as SetSettingParams;
    if (!p?.key) throw new Error("key is required");
    if (p?.value === undefined) throw new Error("value is required");
    const result = settingQueries.setSetting(p.key, p.value);

    // Sync newsletter signup to Resend
    if (p.key === "newsletter_email") {
      subscribeToNewsletter(p.value).catch((err) =>
        console.error("[settings] newsletter subscribe failed:", err),
      );
    }

    // Propagate focus guard toggle to the Tauri Rust layer immediately
    if (p.key === "focus_guard_enabled") {
      emit("focus_guard.setEnabled", { enabled: p.value !== "false" });
    }

    // React to wake scheduling toggle
    if (p.key === "wake_schedule_enabled") {
      invalidatePowerCache();
      if (p.value === "true") {
        syncWakeEvents().catch((err) =>
          console.error("[settings] wake sync on enable failed:", err),
        );
      } else {
        cancelAllWakes().catch((err) =>
          console.error("[settings] cancel wakes on disable failed:", err),
        );
        removeSudoersEntry().catch((err) =>
          console.error("[settings] remove sudoers entry on disable failed:", err),
        );
      }
    }

    return result;
  });

  registerHandler("settings.delete", (params) => {
    const { key } = params as { key: SettingKey };
    if (!key) throw new Error("key is required");
    return { deleted: settingQueries.deleteSetting(key) };
  });
}
