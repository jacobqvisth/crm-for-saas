import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace, fetchAssignmentsBySource } from "@/lib/forums/server";
import { scanRedditContributors, refreshSlackContributorSummary } from "@/lib/forums/contributors";

// A comment scrape can run through Apify (~30-90s); give it room.
export const maxDuration = 120;

const bodySchema = z.object({
  source: z.enum(["distribution", "post"]),
  source_id: z.string().uuid(),
});

// POST /api/forums/contributors/scan → { result, assignments }
// Read the posted thread's commenters and mark any that match a roster Reddit
// handle as having contributed (confirmed_via='reddit_detected'), then refresh
// the Slack thread summary. Returns the item's fresh per-member assignments.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { source, source_id } = parsed.data;

  const table = source === "distribution" ? "forum_distribution" : "forum_posts";
  const { data: row } = await supabase
    .from(table)
    .select("posted_url")
    .eq("id", source_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const url = (row as { posted_url?: string | null } | null)?.posted_url ?? null;
  if (!url) {
    return NextResponse.json({ error: "No posted URL to scan yet" }, { status: 400 });
  }

  const result = await scanRedditContributors({ supabase, workspaceId, source, sourceId: source_id, url });
  await refreshSlackContributorSummary({ supabase, source, sourceId: source_id });

  const grouped = await fetchAssignmentsBySource(supabase, workspaceId, source, [source_id]);
  return NextResponse.json({ result, assignments: grouped.get(source_id) ?? [] });
}
