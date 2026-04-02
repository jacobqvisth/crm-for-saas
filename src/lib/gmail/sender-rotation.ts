import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

/**
 * Gets the next sender for a workspace using round-robin based on lowest daily send count.
 * Only picks accounts with status='active'. Excludes setup_pending, paused, disconnected, rate_limited.
 */
export async function getNextSender(workspaceId: string): Promise<GmailAccount | null> {
  const supabase = createServiceClient();

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

