import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

/**
 * Gets the next sender for a workspace using round-robin based on lowest daily send count.
 * Only picks accounts that are active and have remaining capacity.
 *
 * @param workspaceId — workspace to scope the query to
 * @param allowedAccountIds — optional sequence-scoped pool. When provided and
 *   non-empty, the rotation is restricted to those gmail_accounts.id values.
 *   An empty/undefined array falls back to "all active accounts" behavior.
 */
export async function getNextSender(
  workspaceId: string,
  allowedAccountIds?: string[]
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

  // Find the first account with remaining capacity
  const available = accounts.find(
    (account) => account.daily_sends_count < account.max_daily_sends
  );

  return available || null;
}

