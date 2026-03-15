import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock llm-via-cli before importing icon-picker
vi.mock("../src/planner/llm-via-cli.js", () => ({
  callLlmViaCli: vi.fn(),
}));

import { pickIcon } from "../src/planner/icon-picker.js";
import { callLlmViaCli } from "../src/planner/llm-via-cli.js";

const mockCallLlm = vi.mocked(callLlmViaCli);

describe("pickIcon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns valid icon name from LLM response", async () => {
    mockCallLlm.mockResolvedValue("target");
    const result = await pickIcon("Improve test coverage");
    expect(result).toBe("target");
  });

  it("passes name and description to LLM", async () => {
    mockCallLlm.mockResolvedValue("chart");
    await pickIcon("Dashboard metrics", "Track key performance indicators");
    expect(mockCallLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "classification",
        userMessage: "Name: Dashboard metrics\nDescription: Track key performance indicators",
      }),
    );
  });

  it("passes only name when no description", async () => {
    mockCallLlm.mockResolvedValue("wrench");
    await pickIcon("Fix bugs");
    expect(mockCallLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: "Name: Fix bugs",
      }),
    );
  });

  it("trims whitespace from response", async () => {
    mockCallLlm.mockResolvedValue("  rocket  \n");
    const result = await pickIcon("Deploy");
    expect(result).toBe("rocket");
  });

  it("returns null on empty response", async () => {
    mockCallLlm.mockResolvedValue("");
    const result = await pickIcon("Empty");
    expect(result).toBeNull();
  });

  it("returns null on invalid icon name", async () => {
    mockCallLlm.mockResolvedValue("This is not an icon name");
    const result = await pickIcon("Bad response");
    expect(result).toBeNull();
  });

  it("returns null on unknown icon name", async () => {
    mockCallLlm.mockResolvedValue("🚀");
    const result = await pickIcon("Emoji not allowed");
    expect(result).toBeNull();
  });

  it("returns null on LLM error", async () => {
    mockCallLlm.mockRejectedValue(new Error("CLI not configured"));
    const result = await pickIcon("Error case");
    expect(result).toBeNull();
  });

  it("uses classification tier with 30s timeout", async () => {
    mockCallLlm.mockResolvedValue("file");
    await pickIcon("Notes");
    expect(mockCallLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "classification",
        timeoutMs: 30_000,
      }),
    );
  });
});
