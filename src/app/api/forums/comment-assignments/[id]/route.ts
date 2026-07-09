import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import type { ForumCommentAssignment } from "@/lib/forums/types";

const patchSchema = z.object({
  status: z.enum(["suggested", "posted", "skipped"]).optional(),
  posted_url: z.string().max(2000).nullable().optional(),
  // Allow hand-editing a member's comment before they post it.
  comment: z.string().max(10000).nullable().optional(),
});

// PATCH /api/forums/comment-assignments/[id] → { assignment }
// Mark a member's comment posted / skipped / back to suggested from the CRM, or
// tweak the drafted text. Marking posted here stamps confirmed_via='crm' (a
// Slack ✅ stamps 'slack_reaction' instead — see /api/slack/events).
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
  const { status, ...rest } = parsed.data;

  const update: Record<string, unknown> = { ...rest };
  if (status) {
    update.status = status;
    if (status === "posted") {
      update.posted_at = new Date().toISOString();
      update.confirmed_via = "crm";
    } else {
      // Back to suggested / skipped clears the posting stamp.
      update.posted_at = null;
      update.confirmed_via = null;
    }
  }

  const { data, error } = await supabase
    .from("forum_comment_assignments")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ assignment: data as unknown as ForumCommentAssignment });
}
