import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * A sales rep — a *person*, not a mailbox. One rep may connect several Gmail
 * accounts under different auth users (e.g. Hans has 2 user_ids, Magnus 4), so
 * we group accounts by identity (display name, then email) and treat the
 * earliest-connected user_id as canonical. This mirrors the `rep_identity` view
 * the DB uses for attribution, so the canonical ids stored on contacts/companies
 * always resolve back to a rep here.
 *
 * Each rep gets a stable shorthand `number` (1, 2, 3 …) by connect order, so the
 * UI can render compact badges like "① Hans" that stay consistent over time.
 */
export type Rep = {
  /** Canonical (earliest) user_id — what we write when locking an assignment. */
  userId: string;
  /** Every user_id belonging to this person (for resolving stored owner ids). */
  userIds: string[];
  number: number;
  name: string;
  email: string | null;
};

function personKey(displayName: string | null, email: string | null, userId: string): string {
  const name = displayName?.trim().toLowerCase();
  if (name) return name;
  const e = email?.trim().toLowerCase();
  return e || userId;
}

/**
 * List the workspace's sales reps. RLS scopes `gmail_accounts` to the caller's
 * workspace, so no explicit workspace filter is needed. Reps are de-duplicated
 * by person and numbered by the earliest account each one connected.
 */
export async function listReps(
  supabase: SupabaseClient<Database>,
): Promise<Rep[]> {
  const { data, error } = await supabase
    .from("gmail_accounts")
    .select("user_id, display_name, email_address, created_at")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  // Insertion order follows created_at asc, so the first time we see a person is
  // their earliest account → both numbering order and the canonical user_id.
  const groups = new Map<string, { name: string; email: string | null; userIds: string[] }>();
  for (const row of data) {
    if (!row.user_id) continue;
    const key = personKey(row.display_name, row.email_address, row.user_id);
    let g = groups.get(key);
    if (!g) {
      g = {
        name: row.display_name?.trim() || row.email_address || "Rep",
        email: row.email_address ?? null,
        userIds: [],
      };
      groups.set(key, g);
    }
    if (!g.userIds.includes(row.user_id)) g.userIds.push(row.user_id);
  }

  let n = 0;
  const reps: Rep[] = [];
  for (const g of groups.values()) {
    n += 1;
    reps.push({ userId: g.userIds[0], userIds: g.userIds, number: n, name: g.name, email: g.email });
  }
  return reps;
}
