import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/**
 * Find the call the receptionist is talking on right now.
 *
 * The provider's tool calls carry only the arguments we declared, not the 46elks
 * call id, so the correlation happens here instead. We deliberately do NOT ask
 * the model to echo an id back to us: this codebase has already been bitten by
 * the model mangling dynamic variables (see the greeting fix in PR #662), and a
 * mangled id would transfer a caller to the wrong place. A server-side lookup
 * cannot be mangled.
 *
 * Limitation, surfaced on the Phone System page: if two callers are talking to
 * the receptionist in the same moment, the newer call wins. That is acceptable
 * for an internal switchboard, and the fix if volume ever demands it is a
 * per-call SIP identifier rather than a smarter guess.
 */
export async function findLiveCall(
  supabase: Client,
  workspaceId: string,
): Promise<Tables<"switchboard_calls"> | null> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await supabase
    .from("switchboard_calls")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("status", ["ringing", "with_agent"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

/** Resolve the workspace whose switchboard owns this webhook secret. */
export async function settingsForToken(
  supabase: Client,
  token: string | null,
): Promise<Tables<"switchboard_settings"> | null> {
  if (!token) return null;
  const { data } = await supabase
    .from("switchboard_settings")
    .select("*")
    .eq("webhook_secret", token)
    .maybeSingle();
  return data ?? null;
}
