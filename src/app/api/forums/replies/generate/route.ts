import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { generateForumReply } from "@/lib/forums/reply-generate";
import type { ForumReply, ReplySource } from "@/lib/forums/replies";

const sourceSchema = z.object({
  url: z.string().max(2000).nullable().optional(),
  subreddit: z.string().max(120).nullable().optional(),
  title: z.string().min(1).max(500),
  body: z.string().max(20000).nullable().optional(),
  author: z.string().max(120).nullable().optional(),
  score: z.number().int().nullable().optional(),
  num_comments: z.number().int().nullable().optional(),
});

const bodySchema = z.object({
  source: sourceSchema,
  mentionLevel: z.enum(["none", "subtle", "explicit"]),
});

// POST /api/forums/replies/generate → { reply: ForumReply }
// Draft a helpful reply to a real post, then persist it (status=draft) so it
// shows on the board with copy + mark-posted controls.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { source, mentionLevel } = parsed.data;

  const result = await generateForumReply({ source: source as ReplySource, mentionLevel });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  const { data, error } = await supabase
    .from("forum_replies")
    .insert({
      workspace_id: workspaceId,
      source_url: source.url ?? null,
      source_subreddit: source.subreddit ?? null,
      source_title: source.title,
      source_body: source.body ?? null,
      source_author: source.author ?? null,
      source_score: source.score ?? null,
      source_num_comments: source.num_comments ?? null,
      mention_level: mentionLevel,
      generated_body: result.body,
      status: "draft",
      model: result.model,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reply: data as unknown as ForumReply });
}
