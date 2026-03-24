import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

/**
 * Gets the next sender for a workspace using round-robin based on lowest daily send count.
 * Only picks accounts that are active and have remaining capacity.
 */
export async function getNextSender(workspaceId: string): Promise<GmailAccount | null> {
  const supabase = await createClient();

  const { data: accounts, error } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("daily_sends_count", { ascending: true });

  if (error || !accounts || accounts.length === 0) {
    return null;
  }

  // Find the first account with remaining capacity
  const available = accounts.find(
    (account) => account.daily_sends_count < account.max_daily_sends
  );

  return available || null;
}

/**
 * Returns the total remaining daily send capacity across all active accounts in a workspace.
 */
export async function getTotalDailyCapacity(workspaceId: string): Promise<number> {
  const supabase = await createClient();

  const { data: accounts, error } = await supabase
    .from("gmail_accounts")
    .select("daily_sends_count, max_daily_sends")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  if (error || !accounts) {
    return 0;
  }

  return accounts.reduce(
    (total, account) => total + Math.max(0, account.max_daily_sends - account.daily_sends_count),
    0
  );
}
