// Hard-failing insert helpers for the `activities` table.
//
// Background: 22 call sites across the codebase write activity rows. Until
// PR #248 (2026-05-19), only `logVisit` checked `.error` after the insert
// — every other site discarded the response. The result: when the
// `activities_type_check` CHECK constraint diverged from the set of
// `type` values the code was writing (e.g. `field_visit`, `email_bounced`,
// `sequence_paused`, `link_clicked`, `system`, etc.), 23514 errors were
// silently dropped for months. Production confirmed only `email_sent`,
// `note`, and `contact_created` had actually been landing.
//
// This module exists so every server-side activity write goes through the
// same throw-on-error path that `logVisit` already used. The two
// functions return the inserted row id(s) — callers that want the id
// (e.g. for a follow-up update) use that; callers that don't can ignore
// the return.
//
// Tracking endpoints (open pixel, click redirect, unsubscribe handler)
// have a strict "must always return 200 to the user-agent" contract.
// They wrap `insertActivity` in `try/catch` + `console.error` to log the
// failure without breaking the response. Cron + mutation routes let the
// throw propagate to their outer error boundary.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/database.types";

export type ActivityRow = TablesInsert<"activities">;

type Options = {
  /**
   * Optional caller identifier for the thrown error. Useful when the same
   * insert site can be reached from multiple branches (e.g. the
   * check-replies cron logs replies, bounces, and sequence-pause activities
   * from three separate paths). Defaults to no context label.
   */
  context?: string;
};

function formatError(
  prefix: string,
  row: Pick<ActivityRow, "type" | "workspace_id">,
  options: Options | undefined,
  message: string,
) {
  const ctx = options?.context ? ` [${options.context}]` : "";
  return `${prefix}${ctx}: type=${row.type ?? "?"} ws=${row.workspace_id ?? "?"} -> ${message}`;
}

/**
 * Insert a single activity row. Throws if the insert returns an error or
 * no row. Always pair with an outer try/catch boundary that can decide
 * whether to soft-fail (tracking pixels) or hard-fail (cron / mutations).
 */
export async function insertActivity(
  supabase: SupabaseClient<Database>,
  row: ActivityRow,
  options?: Options,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("activities")
    .insert(row)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      formatError(
        "insertActivity",
        row,
        options,
        error?.message ?? "no row returned",
      ),
    );
  }
  return { id: data.id };
}

/**
 * Insert many activity rows in one round trip. Returns the ids of every
 * inserted row in input order. Empty array is a no-op (returns `{ ids: [] }`).
 */
export async function insertActivities(
  supabase: SupabaseClient<Database>,
  rows: ActivityRow[],
  options?: Options,
): Promise<{ ids: string[] }> {
  if (rows.length === 0) return { ids: [] };

  const { data, error } = await supabase
    .from("activities")
    .insert(rows)
    .select("id");

  if (error || !data) {
    const ctx = options?.context ? ` [${options.context}]` : "";
    throw new Error(
      `insertActivities${ctx}: ${rows.length} rows -> ${error?.message ?? "no rows returned"}`,
    );
  }
  return { ids: data.map((r) => r.id) };
}
