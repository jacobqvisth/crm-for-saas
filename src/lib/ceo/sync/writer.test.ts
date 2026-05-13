import { describe, expect, it } from "vitest";
import { TABLES } from "@/lib/ceo/tables";
import { writeMetricPoints, writeUsers } from "./writer";
import type { MetricPoint, UserRow } from "./types";

type ExistingUserRow = {
  internal_user_id: string;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
};

function createSupabaseStub(existingUsers: ExistingUserRow[]) {
  let upsertedRows: UserRow[] = [];

  return {
    getUpsertedRows() {
      return upsertedRows;
    },
    supabase: {
      from(table: string) {
        return {
          select() {
            return {
              async in(column: string, values: string[]) {
                expect(table).toBe(TABLES.users);
                expect(column).toBe("internal_user_id");

                return {
                  data: existingUsers.filter((row) =>
                    values.includes(row.internal_user_id),
                  ),
                  error: null,
                };
              },
            };
          },
          async upsert(rows: unknown[]) {
            upsertedRows = rows as UserRow[];
            return { error: null };
          },
        };
      },
    },
  };
}

function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    internal_user_id: "user-1",
    workshop_id: "workshop-1",
    email_hash: "hash",
    customer_io_id: "cio-1",
    ga_client_id: null,
    created_at: "2026-02-01T00:00:00.000Z",
    signed_up_at: "2026-02-01T00:00:00.000Z",
    last_seen_at: "2026-02-05T00:00:00.000Z",
    name: null,
    phone: null,
    core_stripe_customer_id: null,
    metadata: {},
    ...overrides,
  };
}

describe("writeUsers", () => {
  it("preserves an earlier existing created_at value", async () => {
    const stub = createSupabaseStub([
      {
        internal_user_id: "user-1",
        created_at: "2026-01-10T00:00:00.000Z",
        metadata: {
          user_created_at_source: "core_app",
        },
      },
    ]);

    await writeUsers(stub.supabase, [makeUserRow()]);

    expect(stub.getUpsertedRows()).toEqual([
      expect.objectContaining({
        internal_user_id: "user-1",
        created_at: "2026-01-10T00:00:00.000Z",
      }),
    ]);
  });

  it("keeps the existing created_at when the incoming row is null", async () => {
    const stub = createSupabaseStub([
      {
        internal_user_id: "user-1",
        created_at: "2026-01-10T00:00:00.000Z",
        metadata: {
          user_created_at_source: "core_app",
        },
      },
    ]);

    await writeUsers(stub.supabase, [makeUserRow({ created_at: null })]);

    expect(stub.getUpsertedRows()).toEqual([
      expect.objectContaining({
        internal_user_id: "user-1",
        created_at: "2026-01-10T00:00:00.000Z",
      }),
    ]);
  });

  it("does not preserve legacy non-canonical created_at values", async () => {
    const stub = createSupabaseStub([
      {
        internal_user_id: "user-1",
        created_at: "2026-01-10T00:00:00.000Z",
        metadata: {
          customer_io_match_type: "id",
        },
      },
    ]);

    await writeUsers(stub.supabase, [makeUserRow({ created_at: null })]);

    expect(stub.getUpsertedRows()).toEqual([
      expect.objectContaining({
        internal_user_id: "user-1",
        created_at: null,
      }),
    ]);
  });
});

describe("writeMetricPoints", () => {
  function createMetricPointStub() {
    let upsertedRows: Array<Record<string, unknown>> = [];
    let upsertOptions: { onConflict?: string } | undefined;

    return {
      getUpsertedRows() {
        return upsertedRows;
      },
      getUpsertOptions() {
        return upsertOptions;
      },
      supabase: {
        from(table: string) {
          return {
            select() {
              return {
                async in() {
                  return { data: [], error: null };
                },
              };
            },
            async upsert(rows: unknown[], options?: { onConflict?: string }) {
              expect(table).toBe(TABLES.metricSnapshots);
              upsertedRows = rows as Array<Record<string, unknown>>;
              upsertOptions = options;
              return { error: null };
            },
          };
        },
      },
    };
  }

  function makeMetricPoint(overrides: Partial<MetricPoint> = {}): MetricPoint {
    return {
      sourceKey: "app_store_connect",
      metricKey: "app_store_downloads",
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      periodEnd: new Date("2026-04-02T00:00:00.000Z"),
      value: 0,
      ...overrides,
    };
  }

  it("collapses duplicate conflict keys with last-value-wins", async () => {
    const stub = createMetricPointStub();

    // app_units, downloads, and first_downloads all map to the same
    // metric_key (app_store_downloads). Apple's reports return more than
    // one of those for the same period, which produced duplicate rows in
    // a single upsert and a Postgres "ON CONFLICT DO UPDATE command
    // cannot affect row a second time" error before this de-dup.
    await writeMetricPoints(stub.supabase, [
      makeMetricPoint({ value: 5 }),
      makeMetricPoint({ value: 7 }),
      makeMetricPoint({
        value: 9,
        periodStart: new Date("2026-04-02T00:00:00.000Z"),
        periodEnd: new Date("2026-04-03T00:00:00.000Z"),
      }),
    ]);

    const rows = stub.getUpsertedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      period_start: "2026-04-01T00:00:00.000Z",
      value: 7,
    });
    expect(rows[1]).toMatchObject({
      period_start: "2026-04-02T00:00:00.000Z",
      value: 9,
    });
    expect(stub.getUpsertOptions()).toMatchObject({
      onConflict: "source_key,metric_key,period_start,period_end,dimension_key",
    });
  });

  it("keeps rows with different dimension_keys distinct", async () => {
    const stub = createMetricPointStub();

    await writeMetricPoints(stub.supabase, [
      makeMetricPoint({
        value: 3,
        dimensions: { platform: "ios" },
      }),
      makeMetricPoint({
        value: 4,
        dimensions: { platform: "android" },
      }),
    ]);

    expect(stub.getUpsertedRows()).toHaveLength(2);
  });
});
