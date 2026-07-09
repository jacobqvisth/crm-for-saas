import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import type { FailureStory } from "@/lib/forums/gaps";

// GET /api/forums/gaps → { stories: FailureStory[] }
// All logged AI-failure stories for the workspace, newest first.
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { data, error } = await supabase
    .from("ai_failure_stories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stories: (data ?? []) as unknown as FailureStory[] });
}

const createSchema = z.object({
  source_url: z.string().max(2000).nullable().optional(),
  source_subreddit: z.string().max(200).nullable().optional(),
  source_author: z.string().max(200).nullable().optional(),
  symptom: z.string().min(1).max(4000),
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

// POST /api/forums/gaps → { story: FailureStory }
// Log a new AI-failure story harvested from a thread (or entered by hand).
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ai_failure_stories")
    .insert({ ...parsed.data, workspace_id: workspaceId })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ story: data as unknown as FailureStory });
}
