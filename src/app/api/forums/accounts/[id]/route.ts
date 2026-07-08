import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import type { RedditAccount } from "@/lib/forums/accounts";

const patchSchema = z.object({
  owner_label: z.string().min(1).max(100).optional(),
  username: z.string().max(100).nullable().optional(),
  subreddits: z.array(z.string().max(100)).max(50).optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

// PATCH /api/forums/accounts/[id] → { account }
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
    .from("reddit_accounts")
    .update(parsed.data)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ account: data as unknown as RedditAccount });
}

// DELETE /api/forums/accounts/[id] → { ok: true }
// forum_posts.assigned_account_id is ON DELETE SET NULL, so any posts assigned
// to this account are simply unassigned.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("reddit_accounts")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
