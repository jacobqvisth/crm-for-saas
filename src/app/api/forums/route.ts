import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/forums/server";
import type { ForumPost } from "@/lib/forums/types";

// GET /api/forums → { posts: ForumPost[] }
// All generated posts for the workspace, newest first.
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
  return NextResponse.json({ posts: (data ?? []) as unknown as ForumPost[] });
}
