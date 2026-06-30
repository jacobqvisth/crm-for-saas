import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listReps } from "./list";

export type SetOwnerInput = {
  /** When true, hand control back to auto-assignment (recompute from activity). */
  auto: boolean;
  primaryOwnerId?: string | null;
  secondaryOwnerId?: string | null;
};

export function parseOwnerBody(raw: unknown): SetOwnerInput | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid body" };
  const b = raw as Record<string, unknown>;
  if (typeof b.auto !== "boolean") return { error: "`auto` (boolean) is required" };
  const primary =
    b.primaryOwnerId === null || b.primaryOwnerId === undefined
      ? null
      : String(b.primaryOwnerId);
  const secondary =
    b.secondaryOwnerId === null || b.secondaryOwnerId === undefined
      ? null
      : String(b.secondaryOwnerId);
  return { auto: b.auto, primaryOwnerId: primary, secondaryOwnerId: secondary };
}

/**
 * Validate a manual (locked) owner assignment against the workspace's reps.
 * Returns the normalized ids, or an error string.
 */
export async function resolveManualOwners(
  supabase: SupabaseClient<Database>,
  input: SetOwnerInput,
): Promise<{ primary: string | null; secondary: string | null } | { error: string }> {
  const reps = await listReps(supabase);
  const valid = new Set(reps.flatMap((r) => r.userIds));
  const primary = input.primaryOwnerId ?? null;
  const secondary = input.secondaryOwnerId ?? null;
  if (primary && !valid.has(primary)) return { error: "Unknown primary rep" };
  if (secondary && !valid.has(secondary)) return { error: "Unknown secondary rep" };
  if (secondary && secondary === primary) {
    return { error: "Primary and secondary rep must differ" };
  }
  return { primary, secondary };
}
