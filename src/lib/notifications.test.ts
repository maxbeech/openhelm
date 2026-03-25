import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InboxItem } from "@openhelm/shared";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("./api", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { notifyInboxItem, notifyRunCompleted, ensureNotificationPermission } from "./notifications";
import * as api from "./api";

const baseItem: InboxItem = {
  id: "item-1",
  runId: "run-1",
  jobId: "job-1",
  projectId: "proj-1",
  type: "permanent_failure",
  title: "Something broke",
  message: "Details here",
  status: "open",
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  resolution: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
  vi.mocked(api.setSetting).mockResolvedValue({} as never);
  // Simulate Tauri WebView environment so sendNativeNotification proceeds past its guard
  (window as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

describe("notifyInboxItem", () => {
  it("sends notification when level is 'alerts_only'", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "alerts_only" } as never);
    await notifyInboxItem(baseItem);
    expect(mockInvoke).toHaveBeenCalledWith(
      "send_notification",
      expect.objectContaining({ title: "Run Failed Permanently" }),
    );
  });

  it("sends notification when level is 'on_finish'", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "on_finish" } as never);
    await notifyInboxItem(baseItem);
    expect(mockInvoke).toHaveBeenCalledWith("send_notification", expect.anything());
  });

  it("does not send notification when level is 'never'", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "never" } as never);
    await notifyInboxItem(baseItem);
    expect(mockInvoke).not.toHaveBeenCalledWith("send_notification", expect.anything());
  });

  it("defaults to 'alerts_only' when setting is not set", async () => {
    vi.mocked(api.getSetting).mockResolvedValue(null as never);
    await notifyInboxItem(baseItem);
    expect(mockInvoke).toHaveBeenCalledWith("send_notification", expect.anything());
  });

  it("uses 'Run Stalled' title for human_in_loop items", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "alerts_only" } as never);
    await notifyInboxItem({ ...baseItem, type: "human_in_loop" });
    expect(mockInvoke).toHaveBeenCalledWith(
      "send_notification",
      expect.objectContaining({ title: "Run Stalled" }),
    );
  });
});

describe("notifyRunCompleted", () => {
  it("sends notification when level is 'on_finish'", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "on_finish" } as never);
    await notifyRunCompleted("succeeded", "My Job");
    expect(mockInvoke).toHaveBeenCalledWith(
      "send_notification",
      expect.objectContaining({ title: '"My Job" succeeded' }),
    );
  });

  it("does not send notification when level is 'alerts_only'", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "alerts_only" } as never);
    await notifyRunCompleted("succeeded", "My Job");
    expect(mockInvoke).not.toHaveBeenCalledWith("send_notification", expect.anything());
  });

  it("does not send notification when level is 'never'", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "never" } as never);
    await notifyRunCompleted("failed", "My Job");
    expect(mockInvoke).not.toHaveBeenCalledWith("send_notification", expect.anything());
  });

  it("uses failed status in title when run did not succeed", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "on_finish" } as never);
    await notifyRunCompleted("failed", "Build Job");
    expect(mockInvoke).toHaveBeenCalledWith(
      "send_notification",
      expect.objectContaining({ title: '"Build Job" finished (failed)' }),
    );
  });

  it("includes summary in notification body when provided", async () => {
    vi.mocked(api.getSetting).mockResolvedValue({ value: "on_finish" } as never);
    await notifyRunCompleted("succeeded", "My Job", "All tests passed.");
    expect(mockInvoke).toHaveBeenCalledWith(
      "send_notification",
      expect.objectContaining({ body: "All tests passed." }),
    );
  });
});

describe("ensureNotificationPermission", () => {
  it("invokes request_notification_permission", async () => {
    await ensureNotificationPermission();
    expect(mockInvoke).toHaveBeenCalledWith("request_notification_permission");
  });

  it("does not throw when invoke fails (browser dev mode)", async () => {
    mockInvoke.mockRejectedValue(new Error("not in Tauri"));
    await expect(ensureNotificationPermission()).resolves.toBeUndefined();
  });
});
