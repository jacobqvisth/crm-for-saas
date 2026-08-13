import { stableDimensionKey } from "@/lib/ceo/metrics/dimensions";
import { TABLES } from "@/lib/ceo/tables";
import type {
  CostEntryRow,
  DiagnosticChatRow,
  DiagnosticRow,
  FeatureUsageRow,
  FunnelPoint,
  MetricPoint,
  MotorUsageRow,
  RawMetricRow,
  SubscriptionRow,
  UserAttributionRow,
  UserLoginRow,
  UserRow,
  WorkshopRow,
} from "./types";

export type SupabaseWriter = {
  from(table: string): {
    upsert: (
      rows: unknown[],
      options?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) => unknown;
    select: (
      columns: string,
    ) => {
      in: (column: string, values: string[]) => unknown;
    };
  };
};

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/**
 * PostgREST runs as `authenticator`, which carries a role-level
 * `statement_timeout=8s`; `service_role` doesn't override it, so every upsert
 * below has an 8-second budget no matter how many rows it carries.
 *
 * A single-statement upsert therefore has a hard ceiling that scales with the
 * source export, and core_app crossed it: from 2026-07-12 every run failed with
 * `canceling statement due to statement timeout` (24 runs/day for 22 days)
 * while the ~4k-row, multi-MB JSONB batch for dashboard_raw_metric_rows was
 * matched against that table's unique index (794k rows / 701 MB by then).
 *
 * Chunking keeps each statement's work proportional to the chunk, not to the
 * whole export, so growth stops translating into timeouts. Chunks are written
 * sequentially: these are upserts keyed on a conflict target, so a partial run
 * leaves already-written chunks correct and the next sync re-sends the rest.
 */
const UPSERT_CHUNK_SIZE = 500;

/**
 * `dashboard_raw_metric_rows` stores whole source payloads as JSONB, averaging
 * ~1.25 KB/row against core_app's slice, so it gets a smaller chunk to keep the
 * per-statement byte volume in the same ballpark as the leaner tables.
 */
const RAW_ROW_CHUNK_SIZE = 250;

async function upsertChunked(
  supabase: SupabaseWriter,
  table: string,
  rows: unknown[],
  options?: { onConflict?: string; ignoreDuplicates?: boolean },
  chunkSize: number = UPSERT_CHUNK_SIZE,
) {
  for (const batch of chunk(rows, chunkSize)) {
    const { error } = (await supabase
      .from(table)
      .upsert(batch, options)) as { error: Error | null };

    if (error) {
      throw error;
    }
  }

  return rows.length;
}

/**
 * Postgres rejects an upsert payload that contains two rows with the same
 * ON CONFLICT key — even if both would resolve to "update the same row" — with
 * `ON CONFLICT DO UPDATE command cannot affect row a second time`. Source data
 * (S3 exports especially) can ship the same user_id twice, so we dedupe in
 * JS with last-value-wins before handing the batch to Supabase.
 */
function dedupeByKey<T extends Record<string, unknown>>(
  rows: T[],
  keyField: keyof T,
): T[] {
  const byKey = new Map<unknown, T>();
  for (const row of rows) {
    const k = row[keyField];
    if (k == null) continue;
    byKey.set(k, row);
  }
  return [...byKey.values()];
}

function earliestIso(
  ...values: Array<string | null | undefined>
): string | null {
  let earliest: Date | null = null;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    if (!earliest || parsed.getTime() < earliest.getTime()) {
      earliest = parsed;
    }
  }

  return earliest ? earliest.toISOString() : null;
}

function isCanonicalCreatedAtSource(value: unknown) {
  return value === "core_app";
}

async function mergeExistingUserCreatedAt(
  supabase: SupabaseWriter,
  users: UserRow[],
) {
  const internalUserIds = [...new Set(users.map((user) => user.internal_user_id))];
  if (internalUserIds.length === 0) {
    return users;
  }

  const existingCreatedAtByUserId = new Map<string, string | null>();
  const existingSignedUpAtByUserId = new Map<string, string | null>();
  const existingSignedUpAtSourceByUserId = new Map<string, string | null>();

  for (const ids of chunk(internalUserIds, 200)) {
    const { data, error } = (await supabase
      .from(TABLES.users)
      .select("internal_user_id, created_at, signed_up_at, metadata")
      .in("internal_user_id", ids)) as {
      data: Array<Record<string, unknown>> | null;
      error: Error | null;
    };

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      const internalUserId =
        typeof row.internal_user_id === "string" ? row.internal_user_id : null;
      const createdAt =
        typeof row.created_at === "string" ? row.created_at : null;
      const signedUpAt =
        typeof row.signed_up_at === "string" ? row.signed_up_at : null;
      const metadata =
        row.metadata && typeof row.metadata === "object" ? row.metadata : null;
      const createdAtSource =
        metadata && "user_created_at_source" in metadata
          ? metadata.user_created_at_source
          : null;
      const signedUpAtSource =
        metadata &&
        "signed_up_at_source" in metadata &&
        typeof (metadata as Record<string, unknown>).signed_up_at_source ===
          "string"
          ? ((metadata as Record<string, unknown>).signed_up_at_source as string)
          : null;

      if (!internalUserId) {
        continue;
      }

      existingCreatedAtByUserId.set(
        internalUserId,
        isCanonicalCreatedAtSource(createdAtSource) ? createdAt : null,
      );
      // signed_up_at is the canonical signup field — once recorded it
      // shouldn't ratchet later. Earliest-wins keeps the first observed
      // timestamp stable across re-syncs.
      existingSignedUpAtByUserId.set(internalUserId, signedUpAt);
      existingSignedUpAtSourceByUserId.set(internalUserId, signedUpAtSource);
    }
  }

  return users.map((user) => {
    const existingCreatedAt =
      existingCreatedAtByUserId.get(user.internal_user_id) ?? null;
    const existingSignedUpAt =
      existingSignedUpAtByUserId.get(user.internal_user_id) ?? null;
    const createdAt = earliestIso(existingCreatedAt, user.created_at);
    const signedUpAt = earliestIso(existingSignedUpAt, user.signed_up_at);

    // The upsert replaces metadata wholesale, so the source stamps must be
    // re-derived from the merged values — not taken from the incoming row.
    // Otherwise an export that stops shipping user_created_at stamps
    // user_created_at_source=null on the first sync, and the next sync
    // treats the preserved created_at as non-canonical and wipes it.
    // Defensive: raw-payload history shows this sequence has never actually
    // fired (user_created_at has been sparse-but-stable since the export
    // began), but the two-sync wipe is real if a source field ever vanishes.
    const metadata = { ...user.metadata };
    if (createdAt) {
      metadata.user_created_at_source = "core_app";
    }
    if (
      signedUpAt &&
      existingSignedUpAt === signedUpAt &&
      user.signed_up_at !== signedUpAt
    ) {
      // The preserved (earlier) timestamp won over the fresh derivation —
      // keep the source label that described it, if we have one.
      const existingSource = existingSignedUpAtSourceByUserId.get(
        user.internal_user_id,
      );
      if (existingSource) {
        metadata.signed_up_at_source = existingSource;
      }
    }

    return {
      ...user,
      created_at: createdAt,
      signed_up_at: signedUpAt,
      metadata,
    };
  });
}

export async function writeMetricPoints(
  supabase: SupabaseWriter,
  points: MetricPoint[],
) {
  if (points.length === 0) {
    return 0;
  }

  const rowsByConflictKey = new Map<
    string,
    {
      source_key: string;
      metric_key: string;
      period_start: string;
      period_end: string;
      dimension_key: string;
      dimensions: Record<string, unknown>;
      value: number;
      unit: string;
      currency: string | null;
      collected_at: string;
    }
  >();

  for (const point of points) {
    const dimensions = point.dimensions ?? {};
    const period_start = point.periodStart.toISOString();
    const period_end = point.periodEnd.toISOString();
    const dimension_key = stableDimensionKey(dimensions);
    // Postgres rejects an upsert that contains two rows with the same
    // ON CONFLICT key. De-dup with last-value-wins, matching what the
    // DB would have done across separate upserts.
    const conflictKey = `${point.sourceKey} ${point.metricKey} ${period_start} ${period_end} ${dimension_key}`;
    rowsByConflictKey.set(conflictKey, {
      source_key: point.sourceKey,
      metric_key: point.metricKey,
      period_start,
      period_end,
      dimension_key,
      dimensions,
      value: point.value,
      unit: point.unit ?? "count",
      currency: point.currency ?? null,
      collected_at: new Date().toISOString(),
    });
  }

  const rows = [...rowsByConflictKey.values()];

  return upsertChunked(supabase, TABLES.metricSnapshots, rows, {
    onConflict: "source_key,metric_key,period_start,period_end,dimension_key",
  });
}

export async function writeFunnelPoints(
  supabase: SupabaseWriter,
  points: FunnelPoint[],
) {
  if (points.length === 0) {
    return 0;
  }

  const rowsByConflictKey = new Map<
    string,
    {
      source_key: string;
      step_key: string;
      period_start: string;
      period_end: string;
      dimension_key: string;
      dimensions: Record<string, unknown>;
      count: number;
      collected_at: string;
    }
  >();

  for (const point of points) {
    const dimensions = point.dimensions ?? {};
    const period_start = point.periodStart.toISOString();
    const period_end = point.periodEnd.toISOString();
    const dimension_key = stableDimensionKey(dimensions);
    const conflictKey = `${point.sourceKey} ${point.stepKey} ${period_start} ${period_end} ${dimension_key}`;
    rowsByConflictKey.set(conflictKey, {
      source_key: point.sourceKey,
      step_key: point.stepKey,
      period_start,
      period_end,
      dimension_key,
      dimensions,
      count: point.count,
      collected_at: new Date().toISOString(),
    });
  }

  const rows = [...rowsByConflictKey.values()];

  return upsertChunked(supabase, TABLES.funnelSnapshots, rows, {
    onConflict: "source_key,step_key,period_start,period_end,dimension_key",
  });
}

export async function writeRawRows(supabase: SupabaseWriter, rows: RawMetricRow[]) {
  if (rows.length === 0) {
    return 0;
  }

  const rowsByConflictKey = new Map<
    string,
    {
      source_key: string;
      external_id: string;
      period_start: string;
      period_end: string;
      payload: unknown;
      collected_at: string;
    }
  >();

  for (const row of rows) {
    const period_start = row.periodStart.toISOString();
    const conflictKey = `${row.sourceKey} ${row.externalId} ${period_start}`;
    rowsByConflictKey.set(conflictKey, {
      source_key: row.sourceKey,
      external_id: row.externalId,
      period_start,
      period_end: row.periodEnd.toISOString(),
      payload: row.payload,
      collected_at: new Date().toISOString(),
    });
  }

  const payload = [...rowsByConflictKey.values()];

  return upsertChunked(
    supabase,
    TABLES.rawMetricRows,
    payload,
    { onConflict: "source_key,external_id,period_start" },
    RAW_ROW_CHUNK_SIZE,
  );
}

export async function writeSubscriptions(
  supabase: SupabaseWriter,
  subscriptions: SubscriptionRow[],
) {
  if (subscriptions.length === 0) {
    return 0;
  }

  const workshopRows = [
    ...new Set(
      subscriptions
        .map((subscription) => subscription.workshop_id)
        .filter((workshopId): workshopId is string => Boolean(workshopId)),
    ),
  ].map((workshopId) => ({
    workshop_id: workshopId,
    metadata: { created_from: "stripe_subscription_placeholder" },
  }));

  if (workshopRows.length > 0) {
    await upsertChunked(supabase, TABLES.workshops, workshopRows, {
      onConflict: "workshop_id",
      ignoreDuplicates: true,
    });
  }

  const deduped = dedupeByKey(subscriptions, "stripe_subscription_id");

  return upsertChunked(supabase, TABLES.subscriptions, deduped, {
    onConflict: "stripe_subscription_id",
  });
}

export async function writeUsers(supabase: SupabaseWriter, users: UserRow[]) {
  if (users.length === 0) {
    return 0;
  }

  const deduped = dedupeByKey(users, "internal_user_id");
  const mergedUsers = await mergeExistingUserCreatedAt(supabase, deduped);

  return upsertChunked(supabase, TABLES.users, mergedUsers, {
    onConflict: "internal_user_id",
  });
}

export async function writeUserLogins(
  supabase: SupabaseWriter,
  logins: UserLoginRow[],
) {
  if (logins.length === 0) {
    return 0;
  }

  // Insert-ignore: the PK is (internal_user_id, logged_in_at), and a login
  // that's already recorded shouldn't have its collected_at touched. The
  // export only carries each user's last ~30 logins, so rows the export has
  // rotated past simply stay put — that's how history outgrows the cap.
  return upsertChunked(supabase, TABLES.userLogins, logins, {
    onConflict: "internal_user_id,logged_in_at",
    ignoreDuplicates: true,
  });
}

export async function writeUserAttribution(
  supabase: SupabaseWriter,
  rows: UserAttributionRow[],
) {
  if (rows.length === 0) {
    return 0;
  }

  // Last-write-wins on the user: firstUser* is immutable in GA4, so a
  // changed row only ever means better data (e.g. the Google Ads campaign
  // dimension backfilling), never a lost first touch.
  return upsertChunked(supabase, TABLES.userAttribution, rows, {
    onConflict: "internal_user_id",
  });
}

export async function writeFeatureUsage(
  supabase: SupabaseWriter,
  rows: FeatureUsageRow[],
) {
  if (rows.length === 0) {
    return 0;
  }

  // Last-write-wins: the export counter is cumulative within its period, so
  // the freshest snapshot is always >= what we stored earlier in the day.
  const payload = rows.map((row) => ({
    ...row,
    collected_at: new Date().toISOString(),
  }));

  return upsertChunked(supabase, TABLES.featureUsage, payload, {
    onConflict: "internal_user_id,feature_key,granularity,period_start",
  });
}

export async function writeWorkshops(
  supabase: SupabaseWriter,
  workshops: WorkshopRow[],
) {
  if (workshops.length === 0) {
    return 0;
  }

  const deduped = dedupeByKey(workshops, "workshop_id");

  return upsertChunked(supabase, TABLES.workshops, deduped, {
    onConflict: "workshop_id",
  });
}

export async function writeDiagnostics(
  supabase: SupabaseWriter,
  diagnostics: DiagnosticRow[],
) {
  if (diagnostics.length === 0) {
    return 0;
  }

  const deduped = dedupeByKey(diagnostics, "diagnostic_id");

  return upsertChunked(supabase, TABLES.diagnostics, deduped, {
    onConflict: "diagnostic_id",
  });
}

export async function writeDiagnosticChats(
  supabase: SupabaseWriter,
  chats: DiagnosticChatRow[],
) {
  if (chats.length === 0) {
    return 0;
  }

  const deduped = dedupeByKey(chats, "chat_id");

  return upsertChunked(supabase, TABLES.diagnosticChats, deduped, {
    onConflict: "chat_id",
  });
}

export async function writeMotorUsage(
  supabase: SupabaseWriter,
  rows: MotorUsageRow[],
) {
  if (rows.length === 0) {
    return 0;
  }

  const deduped = dedupeByKey(rows, "motor_usage_id");

  return upsertChunked(supabase, TABLES.motorUsage, deduped, {
    onConflict: "motor_usage_id",
  });
}

export async function writeCostEntries(
  supabase: SupabaseWriter,
  rows: CostEntryRow[],
) {
  if (rows.length === 0) {
    return 0;
  }

  const deduped = dedupeByKey(rows, "cost_entry_id");

  return upsertChunked(supabase, TABLES.costEntries, deduped, {
    onConflict: "cost_entry_id",
  });
}
