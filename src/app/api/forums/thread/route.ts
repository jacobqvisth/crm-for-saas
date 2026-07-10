import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspace, fetchAssignmentsBySource } from "@/lib/forums/server";
import type { DistributionRec } from "@/lib/forums/distribution";
import type { ForumThreadReply } from "@/lib/forums/types";

// GET /api/forums/thread?source=distribution|post&source_id=<id>
//   → { rec, replies, assignments }
// Everything the per-post sub-page needs: the posted item, the per-member
// top-level comment assignments, and the drafted replies to other people's
// comments (in priority order). Works for a topic-campaign rec (distribution)
// or a diagnostic post (post).
export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const source = request.nextUrl.searchParams.get("source") ?? "distribution";
  const sourceId = request.nextUrl.searchParams.get("source_id");
  if (source !== "distribution" && source !== "post") {
    return NextResponse.json({ error: "Unsupported source" }, { status: 400 });
  }
  if (!sourceId) {
    return NextResponse.json({ error: "source_id required" }, { status: 400 });
  }

  const table = source === "post" ? "forum_posts" : "forum_distribution";
  const { data: rec, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", sourceId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const grouped = await fetchAssignmentsBySource(supabase, workspaceId, source, [sourceId]);

  const { data: replies } = await supabase
    .from("forum_thread_replies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .eq("source_id", sourceId)
    .order("priority", { ascending: true });

  const out = rec as Record<string, unknown>;
  out.assignments = grouped.get(sourceId) ?? [];

  return NextResponse.json({
    rec: out as unknown as DistributionRec,
    assignments: out.assignments,
    replies: (replies ?? []) as unknown as ForumThreadReply[],
  });
}
