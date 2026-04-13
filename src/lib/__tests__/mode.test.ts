/**
 * Tests for mode.ts — runtime mode detection.
 * In jsdom (used by Vitest), window.__TAURI_INTERNALS__ is undefined so isCloudMode = true.
 */

import { describe, it, expect } from "vitest";

describe("mode detection", () => {
  it("exports boolean values", async () => {
    // Dynamic import to avoid module caching issues
    const { isLocalMode, isCloudMode } = await import("../mode");
    expect(typeof isLocalMode).toBe("boolean");
    expect(typeof isCloudMode).toBe("boolean");
  });

  it("isLocalMode and isCloudMode are mutually exclusive", async () => {
    const { isLocalMode, isCloudMode } = await import("../mode");
    expect(isLocalMode).toBe(!isCloudMode);
  });

  it("is cloud mode in jsdom test environment (no __TAURI_INTERNALS__)", async () => {
    const { isLocalMode, isCloudMode } = await import("../mode");
    // Test environment is jsdom, which never has window.__TAURI_INTERNALS__
    expect(isLocalMode).toBe(false);
    expect(isCloudMode).toBe(true);
  });
});
