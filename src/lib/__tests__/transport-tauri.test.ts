/**
 * Tests for TauriTransport — verifies delegation to agentClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock agentClient before importing TauriTransport
vi.mock("../agent-client", () => ({
  agentClient: {
    isReady: vi.fn().mockReturnValue(true),
    isConnected: vi.fn().mockReturnValue(true),
    request: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

describe("TauriTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates request() to agentClient.request()", async () => {
    const { TauriTransport } = await import("../transport-tauri");
    const { agentClient } = await import("../agent-client");
    const t = new TauriTransport();

    const result = await t.request("projects.list");
    expect(agentClient.request).toHaveBeenCalledWith("projects.list", undefined);
    expect(result).toEqual({ ok: true });
  });

  it("delegates request() with params", async () => {
    const { TauriTransport } = await import("../transport-tauri");
    const { agentClient } = await import("../agent-client");
    const t = new TauriTransport();

    await t.request("projects.get", { id: "abc" });
    expect(agentClient.request).toHaveBeenCalledWith("projects.get", { id: "abc" });
  });

  it("reflects isReady() from agentClient", async () => {
    const { TauriTransport } = await import("../transport-tauri");
    const { agentClient } = await import("../agent-client");
    vi.mocked(agentClient.isReady).mockReturnValue(false);

    const t = new TauriTransport();
    expect(t.ready).toBe(false);
  });

  it("reflects isConnected() from agentClient", async () => {
    const { TauriTransport } = await import("../transport-tauri");
    const { agentClient } = await import("../agent-client");
    vi.mocked(agentClient.isConnected).mockReturnValue(true);

    const t = new TauriTransport();
    expect(t.connected).toBe(true);
  });

  it("onEvent() registers and returns unsubscribe function", async () => {
    const { TauriTransport } = await import("../transport-tauri");
    const t = new TauriTransport();

    const handler = vi.fn();
    const unsub = t.onEvent("run.statusChanged", handler);
    expect(typeof unsub).toBe("function");

    // Dispatch a window event
    window.dispatchEvent(new CustomEvent("agent:run.statusChanged", { detail: { status: "running" } }));
    expect(handler).toHaveBeenCalledWith({ status: "running" });

    // Unsubscribe
    unsub();
    window.dispatchEvent(new CustomEvent("agent:run.statusChanged", { detail: { status: "succeeded" } }));
    expect(handler).toHaveBeenCalledTimes(1); // Not called again
  });

  it("onReady() fires immediately if already ready", async () => {
    const { TauriTransport } = await import("../transport-tauri");
    const { agentClient } = await import("../agent-client");
    vi.mocked(agentClient.isReady).mockReturnValue(true);

    const t = new TauriTransport();
    const fn = vi.fn();
    t.onReady(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
