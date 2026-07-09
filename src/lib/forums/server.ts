import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ForumCommentAssignment } from "./types";

type DB = Awaited<ReturnType<typeof createClient>>;

interface WorkspaceOk {
  supabase: DB;
  userId: string;
  workspaceId: string;
  error?: undefined;
}
interface WorkspaceErr {
  error: NextResponse;
  supabase?: undefined;
}

/**
 * Resolve the authenticated user + their workspace. Mirrors
 * src/lib/videos/server.ts — the same auth/membership guard used across the
 * workspace-scoped APIs.
 */
export async function resolveWorkspace(): Promise<WorkspaceOk | WorkspaceErr> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) {
    return { error: NextResponse.json({ error: "No workspace" }, { status: 403 }) };
  }

  return { supabase, userId: user.id, workspaceId: membership.workspace_id };
}

/**
 * Fetch per-member comment assignments for a batch of forum items and group
 * them by source_id, so a GET can attach `assignments` to each rec/post.
 * Members are returned owner-label A→Z for stable rendering.
 */
export async function fetchAssignmentsBySource(
  supabase: DB,
  workspaceId: string,
  source: "distribution" | "post",
  ids: string[],
): Promise<Map<string, ForumCommentAssignment[]>> {
  const grouped = new Map<string, ForumCommentAssignment[]>();
  if (ids.length === 0) return grouped;

  const { data } = await supabase
    .from("forum_comment_assignments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .in("source_id", ids)
    .order("owner_label", { ascending: true });

  for (const row of (data ?? []) as unknown as ForumCommentAssignment[]) {
    const list = grouped.get(row.source_id) ?? [];
    list.push(row);
    grouped.set(row.source_id, list);
  }
  return grouped;
}
