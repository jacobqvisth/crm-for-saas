import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspace } from "@/lib/forums/server";
import type { ForumCandidate } from "@/lib/forums/candidates";

// PATCH /api/forums/candidates/[id]  { status: "new" | "skipped", reason? }
//
// Skip a question you've decided not to answer, or restore one you skipped by
// mistake. Skipping is what stops a rejected post reappearing at the top of
// every search, so it's the whole reason the queue is worth persisting.
//
// "answered" is not settable here: that transition belongs to the reply
// generator (see markCandidateAnswered), which has the reply id to link.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await ctx.params;
  const raw = supabase as unknown as SupabaseClient;

  let body: { status?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.status !== "new" && body.status !== "skipped") {
    return NextResponse.json({ error: "status must be 'new' or 'skipped'" }, { status: 400 });
  }

  const { data, error } = await raw
    .from("forum_candidates")
    .update({
      status: body.status,
      // Restoring clears the reason so the card doesn't keep explaining a
      // decision that was undone.
      skipped_reason: body.status === "skipped" ? (body.reason ?? null) : null,
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ candidate: data as unknown as ForumCandidate });
}
