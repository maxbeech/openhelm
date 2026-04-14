import { describe, it, expect } from "vitest";
import type { ContentView } from "@/stores/app-store";
import {
  contentViewToPath,
  pathToState,
  isDemoPathname,
  type UrlState,
} from "./url-sync";

const base: UrlState = {
  contentView: "inbox",
  selectedGoalId: null,
  selectedJobId: null,
  selectedDataTableId: null,
};

describe("contentViewToPath", () => {
  const simple: Array<[ContentView, string]> = [
    ["inbox", "/inbox"],
    ["home", "/home"],
    ["dashboard", "/dashboard"],
    ["memory", "/memory"],
    ["credentials", "/credentials"],
    ["settings", "/settings"],
    ["data-tables", "/data"],
  ];
  it.each(simple)("maps %s to %s", (view, path) => {
    expect(contentViewToPath({ ...base, contentView: view })).toBe(path);
  });

  it("maps data-table-detail with id", () => {
    expect(
      contentViewToPath({
        ...base,
        contentView: "data-table-detail",
        selectedDataTableId: "tbl_1",
      }),
    ).toBe("/data/tbl_1");
  });

  it("falls back to /data when data-table-detail has no id", () => {
    expect(
      contentViewToPath({ ...base, contentView: "data-table-detail" }),
    ).toBe("/data");
  });

  it("maps goal-detail with id", () => {
    expect(
      contentViewToPath({
        ...base,
        contentView: "goal-detail",
        selectedGoalId: "g_abc",
      }),
    ).toBe("/goals/g_abc");
  });

  it("falls back to /inbox when goal-detail has no id", () => {
    expect(contentViewToPath({ ...base, contentView: "goal-detail" })).toBe(
      "/inbox",
    );
  });

  it("maps job-detail with id", () => {
    expect(
      contentViewToPath({
        ...base,
        contentView: "job-detail",
        selectedJobId: "j_xyz",
      }),
    ).toBe("/jobs/j_xyz");
  });

  it("encodes special characters in IDs", () => {
    expect(
      contentViewToPath({
        ...base,
        contentView: "goal-detail",
        selectedGoalId: "id with space",
      }),
    ).toBe("/goals/id%20with%20space");
  });
});

describe("pathToState", () => {
  it("treats / as inbox", () => {
    expect(pathToState("/")).toEqual(base);
  });

  it("treats empty string as inbox", () => {
    expect(pathToState("")).toEqual(base);
  });

  it("strips trailing slash", () => {
    expect(pathToState("/dashboard/")).toEqual({
      ...base,
      contentView: "dashboard",
    });
  });

  const simple: Array<[string, ContentView]> = [
    ["/inbox", "inbox"],
    ["/home", "home"],
    ["/dashboard", "dashboard"],
    ["/memory", "memory"],
    ["/credentials", "credentials"],
    ["/settings", "settings"],
    ["/data", "data-tables"],
  ];
  it.each(simple)("parses %s as %s", (path, view) => {
    expect(pathToState(path)).toEqual({ ...base, contentView: view });
  });

  it("parses /data/:tableId", () => {
    expect(pathToState("/data/tbl_1")).toEqual({
      ...base,
      contentView: "data-table-detail",
      selectedDataTableId: "tbl_1",
    });
  });

  it("parses /goals/:goalId", () => {
    expect(pathToState("/goals/g_abc")).toEqual({
      ...base,
      contentView: "goal-detail",
      selectedGoalId: "g_abc",
    });
  });

  it("parses /jobs/:jobId", () => {
    expect(pathToState("/jobs/j_xyz")).toEqual({
      ...base,
      contentView: "job-detail",
      selectedJobId: "j_xyz",
    });
  });

  it("decodes encoded IDs", () => {
    expect(pathToState("/goals/id%20with%20space")).toEqual({
      ...base,
      contentView: "goal-detail",
      selectedGoalId: "id with space",
    });
  });

  it("returns null for unknown top-level route", () => {
    expect(pathToState("/bogus")).toBeNull();
  });

  it("returns null for goals without id", () => {
    expect(pathToState("/goals")).toBeNull();
  });

  it("returns null for jobs without id", () => {
    expect(pathToState("/jobs")).toBeNull();
  });

  it("returns null for routes that don't accept an id", () => {
    expect(pathToState("/inbox/extra")).toBeNull();
    expect(pathToState("/settings/foo")).toBeNull();
  });

  it("returns null for deeper routes", () => {
    expect(pathToState("/goals/abc/runs/xyz")).toBeNull();
    expect(pathToState("/data/t/extra")).toBeNull();
  });
});

describe("round-trip", () => {
  const states: UrlState[] = [
    { ...base, contentView: "inbox" },
    { ...base, contentView: "home" },
    { ...base, contentView: "dashboard" },
    { ...base, contentView: "memory" },
    { ...base, contentView: "credentials" },
    { ...base, contentView: "settings" },
    { ...base, contentView: "data-tables" },
    {
      ...base,
      contentView: "data-table-detail",
      selectedDataTableId: "tbl_42",
    },
    { ...base, contentView: "goal-detail", selectedGoalId: "g_1" },
    { ...base, contentView: "job-detail", selectedJobId: "j_2" },
  ];
  it.each(states)("state → path → state for %o", (state) => {
    const path = contentViewToPath(state);
    const roundTripped = pathToState(path);
    expect(roundTripped).toEqual(state);
  });
});

describe("isDemoPathname", () => {
  it("recognises /demo/<slug>", () => {
    expect(isDemoPathname("/demo/foo")).toBe(true);
    expect(isDemoPathname("/demo/foo/bar")).toBe(true);
  });
  it("does not match non-demo paths", () => {
    expect(isDemoPathname("/inbox")).toBe(false);
    expect(isDemoPathname("/")).toBe(false);
  });
});
