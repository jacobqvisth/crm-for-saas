import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

type SelectableAccount = Pick<
  GmailAccount,
  "id" | "user_id" | "daily_sends_count" | "max_daily_sends"
>;

function hasCapacity(account: SelectableAccount): boolean {
  return (account.daily_sends_count ?? 0) < (account.max_daily_sends ?? 0);
}

/**
 * Pure sender-selection policy over an already-fetched, capacity-ordered list
 * of active accounts (ascending daily_sends_count). Exposed for unit testing.
 *
 * When `preferredUserId` is given, an account owned by that user is chosen if
 * one exists AND still has daily capacity — so an interactive send (a one-off
 * email or a post-call follow-up) goes out "from" the rep who is actually
 * acting, not whichever account happens to have the lowest send count. Falls
 * back to the lowest-count account with capacity (the historical behavior).
 */
export function selectSender<T extends SelectableAccount>(
  accounts: T[],
  preferredUserId?: string | null
): T | null {
  if (preferredUserId) {
    const own = accounts.find(
      (a) => a.user_id === preferredUserId && hasCapacity(a)
    );
    if (own) return own;
  }
  return accounts.find(hasCapacity) ?? null;
}

/**
 * Gets the next sender for a workspace using round-robin based on lowest daily send count.
 * Only picks accounts that are active and have remaining capacity.
 *
 * @param workspaceId — workspace to scope the query to
 * @param allowedAccountIds — optional sequence-scoped pool. When provided and
 *   non-empty, the rotation is restricted to those gmail_accounts.id values.
 *   An empty/undefined array falls back to "all active accounts" behavior.
 * @param preferredUserId — optional auth user_id whose own active account
 *   should win (if it has capacity). Used for interactive sends so the email
 *   comes from the logged-in rep. Ignored if that user has no eligible account.
 */
export async function getNextSender(
  workspaceId: string,
  allowedAccountIds?: string[],
  preferredUserId?: string | null
): Promise<GmailAccount | null> {
  const supabase = createServiceClient();

  let query = supabase
    .from("gmail_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("daily_sends_count", { ascending: true });

  if (allowedAccountIds && allowedAccountIds.length > 0) {
    query = query.in("id", allowedAccountIds);
  }

  const { data: accounts, error } = await query;

  if (error || !accounts || accounts.length === 0) {
    return null;
  }

  return selectSender(accounts, preferredUserId);
}

