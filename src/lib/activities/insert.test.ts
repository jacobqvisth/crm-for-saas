import { describe, expect, it, vi } from "vitest";

import { insertActivity, insertActivities, type ActivityRow } from "./insert";

type AnySupabase = Parameters<typeof insertActivity>[0];

const ROW: ActivityRow = {
  workspace_id: "ws-1",
  type: "note",
  subject: "Test",
};

/**
 * Tiny chainable mock matching the slice of the Supabase builder used by
 * the helper: `.from(table).insert(row).select("id").single()`.
 */
function makeClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ table?: string; insertArg?: unknown; selectCols?: string }> = [];
  const state: { table?: string; insertArg?: unknown; selectCols?: string } = {};
  calls.push(state);

  const chain: Record<string, unknown> = {};
  chain.insert = (arg: unknown) => {
    state.insertArg = arg;
    return chain;
  };
  chain.select = (cols: string) => {
    state.selectCols = cols;
    return chain;
  };
  chain.single = async () => result;
  // For the multi-row variant, the final node is `.select(...)`, not `.single()`.
  chain.then = (resolve: (value: { data: unknown; error: unknown }) => void) =>
    Promise.resolve(result).then(resolve);

  const client = {
    from: (table: string) => {
      state.table = table;
      return chain;
    },
  } as unknown as AnySupabase;

  return { client, calls };
}

describe("insertActivity", () => {
  it("returns the inserted id on success", async () => {
    const { client } = makeClient({ data: { id: "act-1" }, error: null });
    const result = await insertActivity(client, ROW);
    expect(result).toEqual({ id: "act-1" });
  });

  it("throws with a rich message when supabase returns an error", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "violates check constraint" },
    });
    await expect(insertActivity(client, ROW)).rejects.toThrow(
      /insertActivity:.*type=note.*ws=ws-1.*violates check constraint/,
    );
  });

  it("throws when the response has no row even though error is null", async () => {
    const { client } = makeClient({ data: null, error: null });
    await expect(insertActivity(client, ROW)).rejects.toThrow(/no row returned/);
  });

  it("includes the context label in the thrown message when supplied", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "boom" },
    });
    await expect(
      insertActivity(client, ROW, { context: "check-replies/bounce" }),
    ).rejects.toThrow(/\[check-replies\/bounce\]/);
  });

  it("calls the right supabase builder methods in the right order", async () => {
    const { client, calls } = makeClient({ data: { id: "act-x" }, error: null });
    await insertActivity(client, ROW);
    expect(calls[0]).toMatchObject({
      table: "activities",
      insertArg: ROW,
      selectCols: "id",
    });
  });
});

describe("insertActivities", () => {
  it("returns an empty result without calling the client when input is empty", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as AnySupabase;
    const result = await insertActivities(client, []);
    expect(result).toEqual({ ids: [] });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns all inserted ids on success", async () => {
    const { client } = makeClient({
      data: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
      error: null,
    });
    const result = await insertActivities(client, [ROW, ROW, ROW]);
    expect(result).toEqual({ ids: ["a1", "a2", "a3"] });
  });

  it("throws with the row count when supabase returns an error", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "boom" },
    });
    await expect(insertActivities(client, [ROW, ROW])).rejects.toThrow(
      /insertActivities: 2 rows -> boom/,
    );
  });
});
