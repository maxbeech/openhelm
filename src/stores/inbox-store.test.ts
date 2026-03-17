import { describe, it, expect, beforeEach, vi } from "vitest";
import { useInboxStore } from "./inbox-store";
import * as api from "@/lib/api";
import type { InboxItem } from "@openorchestra/shared";

vi.mock("@/lib/api");

const mockItem: InboxItem = {
  id: "inbox-1",
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

describe("InboxStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInboxStore.setState({
      items: [],
      openCount: 0,
      loading: false,
      error: null,
    });
  });

  it("addItemToStore adds item and increments count", () => {
    useInboxStore.getState().addItemToStore(mockItem);
    expect(useInboxStore.getState().items).toHaveLength(1);
    expect(useInboxStore.getState().items[0].id).toBe("inbox-1");
    expect(useInboxStore.getState().openCount).toBe(1);
  });

  it("addItemToStore prepends new items", () => {
    const older: InboxItem = { ...mockItem, id: "inbox-0" };
    useInboxStore.setState({ items: [older], openCount: 1 });
    useInboxStore.getState().addItemToStore(mockItem);
    expect(useInboxStore.getState().items[0].id).toBe("inbox-1");
    expect(useInboxStore.getState().items[1].id).toBe("inbox-0");
  });

  it("updateItemInStore replaces matching item", () => {
    useInboxStore.setState({ items: [mockItem], openCount: 1 });
    const resolved: InboxItem = {
      ...mockItem,
      status: "dismissed",
      resolvedAt: "2026-01-01T01:00:00Z",
    };
    useInboxStore.getState().updateItemInStore(resolved);
    expect(useInboxStore.getState().items[0].status).toBe("dismissed");
    expect(useInboxStore.getState().openCount).toBe(0);
  });

  it("resolveItem calls API and removes from store", async () => {
    useInboxStore.setState({ items: [mockItem], openCount: 1 });
    const resolved: InboxItem = { ...mockItem, status: "dismissed" };
    vi.mocked(api.resolveInboxItem).mockResolvedValueOnce(resolved);

    await useInboxStore.getState().resolveItem("inbox-1", "dismiss");

    expect(api.resolveInboxItem).toHaveBeenCalledWith({
      id: "inbox-1",
      action: "dismiss",
      guidance: undefined,
    });
    expect(useInboxStore.getState().items).toHaveLength(0);
    expect(useInboxStore.getState().openCount).toBe(0);
  });

  it("resolveItem passes guidance for do_something_different", async () => {
    useInboxStore.setState({ items: [mockItem], openCount: 1 });
    const resolved: InboxItem = { ...mockItem, status: "resolved" };
    vi.mocked(api.resolveInboxItem).mockResolvedValueOnce(resolved);

    await useInboxStore.getState().resolveItem("inbox-1", "do_something_different", "Try a different approach");

    expect(api.resolveInboxItem).toHaveBeenCalledWith({
      id: "inbox-1",
      action: "do_something_different",
      guidance: "Try a different approach",
    });
  });

  it("fetchItems loads open items", async () => {
    vi.mocked(api.listInboxItems).mockResolvedValueOnce([mockItem]);

    await useInboxStore.getState().fetchItems();

    expect(api.listInboxItems).toHaveBeenCalledWith({ status: "open" });
    expect(useInboxStore.getState().items).toHaveLength(1);
    expect(useInboxStore.getState().loading).toBe(false);
  });

  it("fetchItems filters by projectId when provided", async () => {
    vi.mocked(api.listInboxItems).mockResolvedValueOnce([mockItem]);

    await useInboxStore.getState().fetchItems("p1");

    expect(api.listInboxItems).toHaveBeenCalledWith({ status: "open", projectId: "p1" });
    expect(useInboxStore.getState().items).toHaveLength(1);
  });

  it("fetchOpenCount updates count", async () => {
    vi.mocked(api.countInboxItems).mockResolvedValueOnce({ count: 5 });

    await useInboxStore.getState().fetchOpenCount();

    expect(useInboxStore.getState().openCount).toBe(5);
  });

  it("dismissAll calls resolveInboxItem for each item and clears store", async () => {
    const item2: InboxItem = { ...mockItem, id: "inbox-2" };
    useInboxStore.setState({ items: [mockItem, item2], openCount: 2 });
    vi.mocked(api.resolveInboxItem).mockResolvedValue({ ...mockItem, status: "dismissed" });

    await useInboxStore.getState().dismissAll();

    expect(api.resolveInboxItem).toHaveBeenCalledTimes(2);
    expect(api.resolveInboxItem).toHaveBeenCalledWith({ id: "inbox-1", action: "dismiss" });
    expect(api.resolveInboxItem).toHaveBeenCalledWith({ id: "inbox-2", action: "dismiss" });
    expect(useInboxStore.getState().items).toHaveLength(0);
    expect(useInboxStore.getState().openCount).toBe(0);
  });
});
