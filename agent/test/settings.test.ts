import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./helpers.js";
import {
  getSetting,
  getAllSettings,
  setSetting,
  deleteSetting,
} from "../src/db/queries/settings.js";
import type { SettingKey } from "@openorchestra/shared";

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();
});

afterAll(() => {
  cleanup();
});

describe("settings queries", () => {
  it("should return null for a non-existent setting", () => {
    const result = getSetting("anthropic_api_key" as SettingKey);
    expect(result).toBeNull();
  });

  it("should set and get a setting", () => {
    const key: SettingKey = "anthropic_api_key";
    const result = setSetting(key, "sk-test-123");
    expect(result.key).toBe(key);
    expect(result.value).toBe("sk-test-123");
    expect(result.updatedAt).toBeDefined();

    const fetched = getSetting(key);
    expect(fetched).not.toBeNull();
    expect(fetched!.value).toBe("sk-test-123");
  });

  it("should update an existing setting (upsert)", () => {
    const key: SettingKey = "anthropic_api_key";
    setSetting(key, "sk-old");
    const updated = setSetting(key, "sk-new");
    expect(updated.value).toBe("sk-new");

    const fetched = getSetting(key);
    expect(fetched!.value).toBe("sk-new");
  });

  it("should list all settings", () => {
    setSetting("theme" as SettingKey, "dark");
    const all = getAllSettings();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const keys = all.map((s) => s.key);
    expect(keys).toContain("anthropic_api_key");
    expect(keys).toContain("theme");
  });

  it("should delete a setting", () => {
    setSetting("max_concurrent_runs" as SettingKey, "3");
    expect(deleteSetting("max_concurrent_runs" as SettingKey)).toBe(true);
    expect(getSetting("max_concurrent_runs" as SettingKey)).toBeNull();
  });

  it("should return false when deleting non-existent setting", () => {
    expect(deleteSetting("default_timeout_minutes" as SettingKey)).toBe(false);
  });
});
