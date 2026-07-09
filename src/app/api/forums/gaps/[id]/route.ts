import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import type { FailureStory } from "@/lib/forums/gaps";

const patchSchema = z.object({
  source_url: z.string().max(2000).nullable().optional(),
  source_subreddit: z.string().max(200).nullable().optional(),
  source_author: z.string().max(200).nullable().optional(),
  symptom: z.string().min(1).max(4000).optional(),
  ai_tool: z.string().max(200).nullable().optional(),
  ai_claimed_cause: z.string().max(4000).nullable().optional(),
  action_taken: z.string().max(4000).nullable().optional(),
  cost_amount: z.number().nonnegative().nullable().optional(),
  cost_currency: z.string().max(8).nullable().optional(),
  actual_cause: z.string().max(4000).nullable().optional(),
  outcome: z.enum(["failure", "partial", "success", "unknown"]).optional(),
  our_verdict: z
    .enum(["not_reviewed", "would_have_caught", "would_have_missed", "unsure"])
    .optional(),
  our_notes: z.string().max(4000).nullable().optional(),
});

// PATCH /api/forums/gaps/[id] → { story }
// Edit a logged story, most often the R&D verdict (would we have caught it?)
// and the reasoning note.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ai_failure_stories")
    .update(parsed.data)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ story: data as unknown as FailureStory });
}

// DELETE /api/forums/gaps/[id] → { ok: true }
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("ai_failure_stories")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
