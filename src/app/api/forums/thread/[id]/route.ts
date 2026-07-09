import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { stripLongDashes } from "@/lib/ai/no-long-dash";
import type { ForumThreadReply } from "@/lib/forums/types";

const patchSchema = z.object({
  status: z.enum(["suggested", "posted", "skipped"]).optional(),
  // Manual edits to the drafted reply / assignment before posting.
  reply_text: z.string().max(10000).nullable().optional(),
  assigned_owner_label: z.string().max(100).nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  mention_level: z.enum(["none", "subtle", "explicit"]).optional(),
  posted_url: z.string().max(2000).nullable().optional(),
});

// PATCH /api/forums/thread/[id] → { reply }
// Update one drafted reply: mark it posted (a teammate pasted it under the
// comment), skip it, tweak the text, or reassign it.
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
  const { status, reply_text, ...rest } = parsed.data;

  const update: Record<string, unknown> = { ...rest };
  if (reply_text !== undefined) {
    update.reply_text = reply_text === null ? null : stripLongDashes(reply_text);
  }
  if (status) {
    update.status = status;
    if (status === "posted") {
      update.posted_at = new Date().toISOString();
      update.confirmed_via = "crm";
    } else {
      // Un-posting / skipping clears the manual confirmation.
      update.posted_at = null;
      update.confirmed_via = null;
    }
  }

  const { data, error } = await supabase
    .from("forum_thread_replies")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ reply: data as unknown as ForumThreadReply });
}

// DELETE /api/forums/thread/[id] → { ok: true }
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("forum_thread_replies")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
