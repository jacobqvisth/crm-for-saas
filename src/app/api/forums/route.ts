import { NextResponse } from "next/server";
import { resolveWorkspace, fetchAssignmentsBySource } from "@/lib/forums/server";
import type { ForumPost } from "@/lib/forums/types";

// GET /api/forums → { posts: ForumPost[] }
// All generated posts for the workspace, newest first, each with its per-member
// comment assignments attached.
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { data, error } = await supabase
    .from("forum_posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const posts = (data ?? []) as unknown as ForumPost[];
  const grouped = await fetchAssignmentsBySource(
    supabase,
    workspaceId,
    "post",
    posts.map((p) => p.id),
  );
  return NextResponse.json({
    posts: posts.map((p) => ({ ...p, assignments: grouped.get(p.id) ?? [] })),
  });
}
