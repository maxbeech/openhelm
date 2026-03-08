import { registerHandler } from "../handler.js";
import * as settingQueries from "../../db/queries/settings.js";
import type { SettingKey, SetSettingParams } from "@openorchestra/shared";

export function registerSettingHandlers() {
  registerHandler("settings.get", (params) => {
    const { key } = params as { key: SettingKey };
    if (!key) throw new Error("key is required");
    return settingQueries.getSetting(key);
  });

  registerHandler("settings.list", () => {
    return settingQueries.getAllSettings();
  });

  registerHandler("settings.set", (params) => {
    const p = params as SetSettingParams;
    if (!p?.key) throw new Error("key is required");
    if (p?.value === undefined) throw new Error("value is required");
    return settingQueries.setSetting(p.key, p.value);
  });

  registerHandler("settings.delete", (params) => {
    const { key } = params as { key: SettingKey };
    if (!key) throw new Error("key is required");
    return { deleted: settingQueries.deleteSetting(key) };
  });
}
