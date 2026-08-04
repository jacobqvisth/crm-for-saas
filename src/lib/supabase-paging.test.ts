import { describe, expect, it, vi } from "vitest";

import { pageAll, chunkedIn } from "./supabase-paging";

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

describe("chunkedIn", () => {
  it("returns an empty result without calling the factory when values is empty", async () => {
    const factory = vi.fn();
    const result = await chunkedIn<{ id: number }, string>(factory, [], 200);
    expect(result).toEqual({ data: [], error: null });
    expect(factory).not.toHaveBeenCalled();
  });

  it("slices the input array into chunks and concatenates results", async () => {
    const values = Array.from({ length: 450 }, (_, i) => `v${i}`);
    const chunkSizes: number[] = [];

    const factory = vi.fn(async (chunk: string[], { from }: { from: number; to: number }) => {
      chunkSizes.push(chunk.length);
      // Each value yields a single matching row when from=0; subsequent
      // pages within a chunk return empty so pageAll stops.
      if (from > 0) return { data: [], error: null };
      return {
        data: chunk.map((v) => ({ id: v })),
        error: null,
      };
    });

    const { data, error } = await chunkedIn<{ id: string }, string>(factory, values, 200);

    expect(error).toBeNull();
    expect(data).toHaveLength(450);
    expect(chunkSizes).toEqual([200, 200, 50]);
  });

  it("paginates within a chunk when a single .in() match fans out past 1000 rows", async () => {
    const values = ["A", "B"]; // tiny chunk count
    const rowsPerChunk = 1500;
    const allRows = Array.from({ length: rowsPerChunk }, (_, i) => ({ id: i }));

    const factory = vi.fn(async (_chunk: string[], { from, to }: { from: number; to: number }) => ({
      data: allRows.slice(from, to + 1),
      error: null,
    }));

    const { data, error } = await chunkedIn<{ id: number }, string>(factory, values, 200);

    expect(error).toBeNull();
    expect(data).toHaveLength(rowsPerChunk);
    // pageAll inside the one chunk: 1000 + 500 short page = 2 calls.
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("returns the error and the rows collected so far on a mid-chunk failure", async () => {
    const factory = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const { data, error } = await chunkedIn<{ id: string }, string>(
      factory,
      ["v1", "v2"],
      1,
    );

    expect(error).toEqual({ message: "boom" });
    expect(data).toEqual([{ id: "a" }]);
  });
});

describe("pageAll ceiling", () => {
  it("warns on the way to the truncation ceiling instead of silently dropping rows", async () => {
    // dashboard_metric_snapshots was 161k rows and growing ~1,300/day when the
    // ceiling was 200 pages, so this guard was about a month from silently
    // wronging every all-time dashboard number.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let served = 0;
    const factory = async ({ from }: { from: number; to: number }) => {
      served += 1;
      return {
        data: Array.from({ length: 1000 }, (_, i) => ({ i: from + i })),
        error: null,
      };
    };
    const result = await pageAll(factory, 1000);
    // Reads to the raised ceiling rather than stopping at the old 200.
    expect(served).toBe(600);
    expect(result.data).toHaveLength(600_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("silently dropped");
    warn.mockRestore();
  });
});
