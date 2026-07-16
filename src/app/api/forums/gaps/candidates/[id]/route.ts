import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import type { FailureStory, GapCandidate } from "@/lib/forums/gaps";

const patchSchema = z.object({
  action: z.enum(["confirm", "dismiss"]),
});

// PATCH /api/forums/gaps/candidates/[id]  body: { action: "confirm" | "dismiss" }
//
// confirm → write an ai_failure_stories row from the candidate (idempotent on
//           source_url; if a story already covers this post we reuse it), mark
//           the candidate confirmed and link story_id. Returns { candidate, story }.
// dismiss → mark the candidate dismissed. Returns { candidate }.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { workspaceId } = ws;
  // forum_gap_candidates isn't in the generated Database types yet — use a loose
  // client for all queries here, same as the reddit_mentions routes.
  const supabase = ws.supabase as unknown as SupabaseClient;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: cand, error: candErr } = await supabase
    .from("forum_gap_candidates")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();
  if (candErr || !cand) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }
  const candidate = cand as unknown as GapCandidate;

  if (parsed.data.action === "dismiss") {
    const { data, error } = await supabase
      .from("forum_gap_candidates")
      .update({ status: "dismissed" })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ candidate: data as unknown as GapCandidate });
  }

  // confirm — create (or find) the story, then link the candidate to it.
  let story: FailureStory | null = null;

  const { data: existing } = await supabase
    .from("ai_failure_stories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source_url", candidate.source_url)
    .maybeSingle();

  if (existing) {
    story = existing as unknown as FailureStory;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("ai_failure_stories")
      .insert({
        workspace_id: workspaceId,
        source_url: candidate.source_url,
        source_subreddit: candidate.source_subreddit,
        source_author: candidate.source_author,
        symptom: candidate.symptom || candidate.source_title || "Unknown symptom",
        ai_tool: candidate.ai_tool,
        ai_claimed_cause: candidate.ai_claimed_cause,
        action_taken: candidate.action_taken,
        cost_amount: candidate.cost_amount,
        cost_currency: candidate.cost_currency ?? "USD",
        actual_cause: candidate.actual_cause,
        outcome: candidate.outcome,
        our_verdict: "not_reviewed",
      })
      .select("*")
      .single();
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
    story = created as unknown as FailureStory;
  }

  const { data: updatedCand, error: updErr } = await supabase
    .from("forum_gap_candidates")
    .update({ status: "confirmed", story_id: story.id })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ candidate: updatedCand as unknown as GapCandidate, story });
}
