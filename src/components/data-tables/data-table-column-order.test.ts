import { describe, it, expect } from "vitest";
import type { DataTableColumn } from "@openhelm/shared";
import { reorderColumns, reorderColumnsById } from "./data-table-column-order";

const col = (id: string): DataTableColumn => ({ id, name: id, type: "text", config: {} });

describe("reorderColumns", () => {
  const cols = [col("a"), col("b"), col("c"), col("d")];

  it("returns the input unchanged when from === to", () => {
    expect(reorderColumns(cols, 1, 1)).toBe(cols);
  });

  it("returns the input unchanged for out-of-range indices", () => {
    expect(reorderColumns(cols, -1, 1)).toBe(cols);
    expect(reorderColumns(cols, 1, 99)).toBe(cols);
  });

  it("moves a column from earlier to later", () => {
    expect(reorderColumns(cols, 0, 2).map((c) => c.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a column from later to earlier", () => {
    expect(reorderColumns(cols, 3, 0).map((c) => c.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...cols];
    reorderColumns(cols, 0, 2);
    expect(cols).toEqual(copy);
  });
});

describe("reorderColumnsById", () => {
  const cols = [col("a"), col("b"), col("c")];

  it("moves a column by id", () => {
    expect(reorderColumnsById(cols, "a", "c").map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("returns the input unchanged when an id is unknown", () => {
    expect(reorderColumnsById(cols, "x", "c")).toBe(cols);
  });
});
