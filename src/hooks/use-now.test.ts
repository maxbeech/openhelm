import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a Date", () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toBeInstanceOf(Date);
  });

  it("updates after the 60 s interval elapses", () => {
    const { result } = renderHook(() => useNow());
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.getTime()).toBeGreaterThan(first.getTime());
  });

  it("does not update before the interval elapses", () => {
    const { result } = renderHook(() => useNow());
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current).toBe(first);
  });
});
