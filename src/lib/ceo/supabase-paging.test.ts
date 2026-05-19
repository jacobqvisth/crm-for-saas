import { describe, expect, it, vi } from "vitest";

import { pageAll } from "./supabase-paging";

describe("pageAll", () => {
  it("returns a single short page without extra requests", async () => {
    const factory = vi.fn(async () => ({
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      error: null,
    }));

    const { data, error } = await pageAll<{ id: number }>(factory, 1000);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith({ from: 0, to: 999 });
  });

  it("walks every page until a short one returns", async () => {
    const totalRows = 2350;
    const pageSize = 1000;
    const allRows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));

    const factory = vi.fn(async ({ from, to }: { from: number; to: number }) => ({
      data: allRows.slice(from, to + 1),
      error: null,
    }));

    const { data, error } = await pageAll<{ id: number }>(factory, pageSize);

    expect(error).toBeNull();
    expect(data).toHaveLength(totalRows);
    expect(data[0]).toEqual({ id: 0 });
    expect(data[totalRows - 1]).toEqual({ id: totalRows - 1 });
    // 1000 + 1000 + 350 — short final page stops the loop.
    expect(factory).toHaveBeenCalledTimes(3);
    expect(factory).toHaveBeenNthCalledWith(1, { from: 0, to: 999 });
    expect(factory).toHaveBeenNthCalledWith(2, { from: 1000, to: 1999 });
    expect(factory).toHaveBeenNthCalledWith(3, { from: 2000, to: 2999 });
  });

  it("stops the loop and returns the error on the first failed page", async () => {
    const factory = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "boom" },
      });

    const { data, error } = await pageAll<{ id: number }>(factory, 1000);

    expect(error).toEqual({ message: "boom" });
    expect(data).toHaveLength(1000); // keeps the rows it already accumulated
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("returns an exact-page-size response that happens to be the last page", async () => {
    // Edge case: total rows is an exact multiple of pageSize. The factory
    // returns a full page, then an empty page, then we stop.
    const factory = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const { data, error } = await pageAll<{ id: number }>(factory, 1000);

    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
