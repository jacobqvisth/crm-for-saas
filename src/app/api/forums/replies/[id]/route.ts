import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { generateForumReply } from "@/lib/forums/reply-generate";
import { fetchRedditTraction } from "@/lib/forums/reddit";
import {
  generationOptionsSchema,
  normalizeOptions,
  type ForumGenerationOptions,
} from "@/lib/forums/generation-options";
import type { ForumReply, ReplySource } from "@/lib/forums/replies";
import type { Json } from "@/lib/database.types";

// A traction refresh may run via an Apify scrape (~30-90s); raise the timeout.
export const maxDuration = 300;

const patchSchema = z.object({
  status: z.enum(["draft", "posted", "archived"]).optional(),
  posted_url: z.string().max(2000).nullable().optional(),
  generated_body: z.string().max(20000).optional(),
  mention_level: z.enum(["none", "subtle", "explicit"]).optional(),
  // New style options for a regenerate (else the stored ones are reused).
  options: generationOptionsSchema.optional(),
  // Which roster account posted our reply (picked when marking posted).
  posted_by_account_id: z.string().uuid().nullable().optional(),
  // Manual traction entry (used when auto-fetch is blocked).
  score: z.number().int().nullable().optional(),
  num_comments: z.number().int().nullable().optional(),
  traction_note: z.string().max(2000).nullable().optional(),
  // When true, re-fetch our reply's traction from Reddit now.
  refresh: z.boolean().optional(),
  // When true, re-draft the reply from the stored source (optionally with a new
  // mention_level passed alongside).
  regenerate: z.boolean().optional(),
});

// PATCH /api/forums/replies/[id] → { reply }
// Edit the reply text, mark it posted (with the comment URL), archive it, or
// regenerate it from the stored source post. status=posted stamps posted_at.
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
  const { regenerate, refresh, status, mention_level, options, ...rest } = parsed.data;

  const update: Record<string, unknown> = { ...rest };
  if (mention_level) update.mention_level = mention_level;
  if (status) {
    update.status = status;
    if (status === "posted") update.posted_at = new Date().toISOString();
  }

  // Manual traction entry — stamp the check time and clear any error note.
  if (!refresh && (rest.score !== undefined || rest.num_comments !== undefined)) {
    update.last_checked_at = new Date().toISOString();
    if (rest.traction_note === undefined) update.traction_note = null;
  }

  // Pull fresh upvotes + comments for our posted reply from Reddit. Prefer an
  // incoming posted_url (just set alongside), else read the stored one.
  if (refresh) {
    let url = typeof rest.posted_url === "string" ? rest.posted_url : null;
    if (!url) {
      const { data: row } = await supabase
        .from("forum_replies")
        .select("posted_url")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single();
      url = (row?.posted_url as string | null) ?? null;
    }
    update.last_checked_at = new Date().toISOString();
    if (!url) {
      update.traction_note = "No posted URL to check yet";
    } else {
      const result = await fetchRedditTraction(url);
      if (result.ok) {
        update.score = result.traction.score;
        update.num_comments = result.traction.num_comments;
        update.upvote_ratio = result.traction.upvote_ratio;
        if (result.traction.author) update.posted_by_username = result.traction.author;
        update.traction_note = null;
      } else {
        update.traction_note = result.reason;
      }
    }
  }

  if (regenerate) {
    const { data: row } = await supabase
      .from("forum_replies")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = row as unknown as ForumReply;

    const source: ReplySource = {
      url: existing.source_url,
      subreddit: existing.source_subreddit,
      title: existing.source_title ?? "",
      body: existing.source_body,
      author: existing.source_author,
      score: existing.source_score,
      num_comments: existing.source_num_comments,
    };
    // New options win; else reuse the stored mention_level + generation_options.
    const genOptions = normalizeOptions({
      mentionLevel: existing.mention_level,
      ...((existing.generation_options ?? {}) as Partial<ForumGenerationOptions>),
      ...(mention_level ? { mentionLevel: mention_level } : {}),
      ...(options ?? {}),
    });
    const result = await generateForumReply({ source, options: genOptions });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 502 });
    update.generated_body = result.body;
    update.model = result.model;
    update.mention_level = genOptions.mentionLevel;
    update.generation_options = genOptions as unknown as Json;
  }

  const { data: reply, error } = await supabase
    .from("forum_replies")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!reply) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reply: reply as unknown as ForumReply });
}

// DELETE /api/forums/replies/[id] → { ok: true }
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("forum_replies")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
