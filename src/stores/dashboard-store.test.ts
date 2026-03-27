import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDashboardStore } from "./dashboard-store";
import * as api from "@/lib/api";
import type { DashboardItem } from "@openhelm/shared";

vi.mock("@/lib/api");

const mockItem: DashboardItem = {
  id: "dash-1",
  runId: "r1",
  jobId: "j1",
  projectId: "p1",
  type: "permanent_failure",
  status: "open",
  title: "Job failed permanently",
  message: "Infrastructure issue",
  createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: null,
};

describe("DashboardStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDashboardStore.setState({
      items: [],
      openCount: 0,
      loading: false,
      error: null,
    });
  });

  it("addItemToStore adds item and increments count", () => {
    useDashboardStore.getState().addItemToStore(mockItem);
    expect(useDashboardStore.getState().items).toHaveLength(1);
    expect(useDashboardStore.getState().items[0].id).toBe("dash-1");
    expect(useDashboardStore.getState().openCount).toBe(1);
  });

  it("addItemToStore prepends new items", () => {
    const older: DashboardItem = { ...mockItem, id: "dash-0" };
    useDashboardStore.setState({ items: [older], openCount: 1 });
    useDashboardStore.getState().addItemToStore(mockItem);
    expect(useDashboardStore.getState().items[0].id).toBe("dash-1");
    expect(useDashboardStore.getState().items[1].id).toBe("dash-0");
  });

  it("updateItemInStore replaces matching item", () => {
    useDashboardStore.setState({ items: [mockItem], openCount: 1 });
    const resolved: DashboardItem = {
      ...mockItem,
      status: "dismissed",
      resolvedAt: "2026-01-01T01:00:00Z",
    };
    useDashboardStore.getState().updateItemInStore(resolved);
    expect(useDashboardStore.getState().items[0].status).toBe("dismissed");
    expect(useDashboardStore.getState().openCount).toBe(0);
  });

  it("resolveItem calls API and removes from store", async () => {
    useDashboardStore.setState({ items: [mockItem], openCount: 1 });
    const resolved: DashboardItem = { ...mockItem, status: "dismissed" };
    vi.mocked(api.resolveDashboardItem).mockResolvedValueOnce(resolved);

    await useDashboardStore.getState().resolveItem("dash-1", "dismiss");

    expect(api.resolveDashboardItem).toHaveBeenCalledWith({
      id: "dash-1",
      action: "dismiss",
      guidance: undefined,
    });
    expect(useDashboardStore.getState().items).toHaveLength(0);
    expect(useDashboardStore.getState().openCount).toBe(0);
  });

  it("resolveItem passes guidance for do_something_different", async () => {
    useDashboardStore.setState({ items: [mockItem], openCount: 1 });
    const resolved: DashboardItem = { ...mockItem, status: "resolved" };
    vi.mocked(api.resolveDashboardItem).mockResolvedValueOnce(resolved);

    await useDashboardStore.getState().resolveItem("dash-1", "do_something_different", "Try a different approach");

    expect(api.resolveDashboardItem).toHaveBeenCalledWith({
      id: "dash-1",
      action: "do_something_different",
      guidance: "Try a different approach",
    });
  });

  it("fetchItems loads open items", async () => {
    vi.mocked(api.listDashboardItems).mockResolvedValueOnce([mockItem]);

    await useDashboardStore.getState().fetchItems();

    expect(api.listDashboardItems).toHaveBeenCalledWith({ status: "open" });
    expect(useDashboardStore.getState().items).toHaveLength(1);
    expect(useDashboardStore.getState().loading).toBe(false);
  });

  it("fetchItems filters by projectId when provided", async () => {
    vi.mocked(api.listDashboardItems).mockResolvedValueOnce([mockItem]);

    await useDashboardStore.getState().fetchItems("p1");

    expect(api.listDashboardItems).toHaveBeenCalledWith({ status: "open", projectId: "p1" });
    expect(useDashboardStore.getState().items).toHaveLength(1);
  });

  it("fetchOpenCount updates count", async () => {
    vi.mocked(api.countDashboardItems).mockResolvedValueOnce({ count: 5 });

    await useDashboardStore.getState().fetchOpenCount();

    expect(useDashboardStore.getState().openCount).toBe(5);
  });

  it("dismissAll calls resolveDashboardItem for each item and clears store", async () => {
    const item2: DashboardItem = { ...mockItem, id: "dash-2" };
    useDashboardStore.setState({ items: [mockItem, item2], openCount: 2 });
    vi.mocked(api.resolveDashboardItem).mockResolvedValue({ ...mockItem, status: "dismissed" });

    await useDashboardStore.getState().dismissAll();

    expect(api.resolveDashboardItem).toHaveBeenCalledTimes(2);
    expect(api.resolveDashboardItem).toHaveBeenCalledWith({ id: "dash-1", action: "dismiss" });
    expect(api.resolveDashboardItem).toHaveBeenCalledWith({ id: "dash-2", action: "dismiss" });
    expect(useDashboardStore.getState().items).toHaveLength(0);
    expect(useDashboardStore.getState().openCount).toBe(0);
  });
});
