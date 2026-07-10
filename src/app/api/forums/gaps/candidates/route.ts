import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspace } from "@/lib/forums/server";
import type { GapCandidate } from "@/lib/forums/gaps";

// GET /api/forums/gaps/candidates?status=new → { candidates: GapCandidate[] }
// Persisted AI-failure candidates from the Answer-posts scan, newest first.
// Defaults to status=new (the review queue); pass ?status=all for everything.
export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { workspaceId } = ws;
  // forum_gap_candidates isn't in the generated Database types yet — use a loose
  // client, same as the reddit_mentions routes.
  const supabase = ws.supabase as unknown as SupabaseClient;

  const status = new URL(request.url).searchParams.get("status") ?? "new";

  let query = supabase
    .from("forum_gap_candidates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ candidates: (data ?? []) as unknown as GapCandidate[] });
}
