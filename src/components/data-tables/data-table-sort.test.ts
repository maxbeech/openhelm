import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import type { DataTableColumn, DataTableRow } from "@openhelm/shared";
import {
  cycleSort,
  compareCells,
  sortRows,
  loadSortState,
  saveSortState,
} from "./data-table-sort";

// jsdom + Node 22 ship a partial localStorage shim that's missing methods.
// Replace it with a simple in-memory Storage-compatible implementation so
// the persistence tests have a predictable surface.
beforeAll(() => {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true });
});

function col(id: string, type: DataTableColumn["type"], extra: Partial<DataTableColumn> = {}): DataTableColumn {
  return { id, name: id, type, config: {}, ...extra };
}

function row(id: string, data: Record<string, unknown>, createdAt = "2026-01-01T00:00:00Z"): DataTableRow {
  return { id, tableId: "t", data, sortOrder: 0, createdAt, updatedAt: createdAt };
}

describe("cycleSort", () => {
  it("goes none → asc → desc → none on repeated clicks of the same column", () => {
    let s = cycleSort(null, "c1");
    expect(s).toEqual({ columnId: "c1", direction: "asc" });
    s = cycleSort(s, "c1");
    expect(s).toEqual({ columnId: "c1", direction: "desc" });
    s = cycleSort(s, "c1");
    expect(s).toBeNull();
  });

  it("clicking a different column resets to asc on that column", () => {
    const s = cycleSort({ columnId: "c1", direction: "desc" }, "c2");
    expect(s).toEqual({ columnId: "c2", direction: "asc" });
  });
});

describe("compareCells", () => {
  it("sorts numbers numerically", () => {
    const c = col("n", "number");
    expect(compareCells(2, 10, c, "asc")).toBeLessThan(0);
    expect(compareCells(2, 10, c, "desc")).toBeGreaterThan(0);
  });

  it("sorts dates chronologically", () => {
    const c = col("d", "date");
    expect(compareCells("2026-01-01", "2026-02-01", c, "asc")).toBeLessThan(0);
  });

  it("sorts select by option label, not by id", () => {
    const c = col("s", "select", {
      config: { options: [
        { id: "opt_2", label: "Banana" },
        { id: "opt_1", label: "Apple" },
      ] },
    });
    // Apple before Banana even though opt_2 < opt_1 alphabetically.
    expect(compareCells("opt_2", "opt_1", c, "asc")).toBeGreaterThan(0);
  });

  it("sorts empty values to the end regardless of direction", () => {
    const c = col("t", "text");
    expect(compareCells(null, "a", c, "asc")).toBe(1);
    expect(compareCells(null, "a", c, "desc")).toBe(1);
    expect(compareCells("", "a", c, "asc")).toBe(1);
  });

  it("sorts text case-insensitively with numeric collation", () => {
    const c = col("t", "text");
    expect(compareCells("file10", "file2", c, "asc")).toBeGreaterThan(0);
  });
});

describe("sortRows", () => {
  const columns = [col("name", "text"), col("age", "number")];
  const rows = [
    row("a", { name: "Charlie", age: 30 }),
    row("b", { name: "Alice", age: 40 }),
    row("c", { name: "Bob", age: 20 }),
  ];

  it("returns the input unchanged when no sort", () => {
    expect(sortRows(rows, columns, null)).toBe(rows);
  });

  it("returns the input unchanged when column is missing", () => {
    expect(sortRows(rows, columns, { columnId: "missing", direction: "asc" })).toBe(rows);
  });

  it("sorts rows by text asc", () => {
    const sorted = sortRows(rows, columns, { columnId: "name", direction: "asc" });
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts rows by number desc", () => {
    const sorted = sortRows(rows, columns, { columnId: "age", direction: "desc" });
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("is stable — rows with equal keys keep their original order", () => {
    const rs = [
      row("a", { name: "X" }),
      row("b", { name: "X" }),
      row("c", { name: "X" }),
    ];
    const sorted = sortRows(rs, columns, { columnId: "name", direction: "asc" });
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("sort state persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when no state is stored", () => {
    expect(loadSortState("t1")).toBeNull();
  });

  it("round-trips an asc state", () => {
    saveSortState("t1", { columnId: "name", direction: "asc" });
    expect(loadSortState("t1")).toEqual({ columnId: "name", direction: "asc" });
  });

  it("round-trips a desc state", () => {
    saveSortState("t1", { columnId: "age", direction: "desc" });
    expect(loadSortState("t1")).toEqual({ columnId: "age", direction: "desc" });
  });

  it("saveSortState(null) removes the stored entry", () => {
    saveSortState("t1", { columnId: "name", direction: "asc" });
    saveSortState("t1", null);
    expect(loadSortState("t1")).toBeNull();
  });

  it("isolates state per tableId", () => {
    saveSortState("t1", { columnId: "name", direction: "asc" });
    saveSortState("t2", { columnId: "age", direction: "desc" });
    expect(loadSortState("t1")).toEqual({ columnId: "name", direction: "asc" });
    expect(loadSortState("t2")).toEqual({ columnId: "age", direction: "desc" });
  });

  it("returns null on corrupt stored JSON", () => {
    window.localStorage.setItem("dataTable.sort.t1", "{not json");
    expect(loadSortState("t1")).toBeNull();
  });

  it("returns null when stored value has an unknown direction", () => {
    window.localStorage.setItem(
      "dataTable.sort.t1",
      JSON.stringify({ columnId: "name", direction: "banana" }),
    );
    expect(loadSortState("t1")).toBeNull();
  });
});
