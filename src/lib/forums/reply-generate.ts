import Anthropic from "@anthropic-ai/sdk";
import { WRENCHLANE_KNOWLEDGE } from "@/lib/inbox/wrenchlane-knowledge";
import { stripLongDashes } from "@/lib/ai/no-long-dash";
import type { ForumMentionLevel, ReplySource } from "./replies";

// Sonnet for creative quality — same call as the post generator. These are
// public-facing comments that have to read like a real, knowledgeable person
// wrote them.
const MODEL = "claude-sonnet-4-6";

const MENTION_GUIDANCE: Record<ForumMentionLevel, string> = {
  none: "Do NOT mention Wrenchlane, any app, or any product. This is a pure helpful reply — your only goal is to actually help this person fix their car.",
  subtle:
    "You MAY add one passing, natural aside that you ran the symptoms through an AI car-diagnosis app to narrow it down — without naming a brand or linking anything. It must be incidental; the reply has to stand on its own as genuinely useful even if that line were deleted. Do not add it if it would feel forced.",
  explicit:
    "You may name Wrenchlane once, naturally, as a tool that helped (e.g. 'I ran these symptoms through Wrenchlane and it flagged X'). One mention only, no link, no sales language. The reply must still read as a real mechanic/enthusiast helping out, never an ad — lead with real help, mention it at most as an afterthought.",
};

function buildSystemPrompt(mentionLevel: ForumMentionLevel, subreddit: string | null): string {
  const where = subreddit ? `r/${subreddit.replace(/^r\//i, "")}` : "a car-repair subreddit";
  return `You are an experienced mechanic and car enthusiast writing a reply to a real post on ${where}. The reply will be copy-pasted, by a human, as a Reddit comment. Your job is to write ONE genuinely helpful comment that reads exactly like a knowledgeable regular wrote it.

What a good reply does:
- Actually engages with THIS person's specific problem — reference their car, symptoms and what they've already tried. Never a generic checklist that ignores their details.
- Gives real diagnostic direction: the most likely cause given what they described, how to confirm it, and the next thing to check. If their described fix should have worked, explain why it might not have (e.g. air still in the system, wrong bleed order, a failing component upstream).
- Is honest about uncertainty. If it could be several things, say what you'd rule out first and how. Don't pretend to be certain you can't be.
- Asks a pointed follow-up question only if a specific missing detail would actually change the diagnosis.

Brand-mention rule: ${MENTION_GUIDANCE[mentionLevel]}

How to sound human, not like AI:
- Reddit comment voice: conversational, contractions, gets to the point. No headings, no "Here are the steps:", no numbered listicle unless it genuinely reads better as a short list.
- Match the effort to the question — usually a couple of tight paragraphs. Don't pad.
- No corporate phrasing, no "I hope this helps!", no emojis unless natural. Don't restate their whole post back to them.
- You're a peer helping out, not customer support. Confident but not condescending.

${
  mentionLevel === "none"
    ? ""
    : `For grounding ONLY, so any mention is accurate (do not paste this in):
=== WRENCHLANE PRODUCT KNOWLEDGE ===
${WRENCHLANE_KNOWLEDGE}
=== END ===
`
}Return ONLY a JSON object, no markdown fences, no commentary, of exactly this shape:
{"body": "<the reply text, plain text, real line breaks as \\n>"}`;
}

function describeSource(s: ReplySource): string {
  const lines: string[] = [];
  if (s.subreddit) lines.push(`Subreddit: r/${s.subreddit.replace(/^r\//i, "")}`);
  if (s.title) lines.push(`Post title: ${s.title}`);
  if (s.body && s.body.trim()) {
    lines.push(`Post body:\n${s.body.trim()}`);
  } else {
    lines.push("(No post body — the title is the whole question.)");
  }
  return lines.join("\n\n");
}

export type GenerateReplyResult =
  | { ok: true; body: string; model: string }
  | { ok: false; reason: string };

export async function generateForumReply(opts: {
  source: ReplySource;
  mentionLevel: ForumMentionLevel;
}): Promise<GenerateReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };
  if (!opts.source.title?.trim()) return { ok: false, reason: "The post has no title/question to reply to" };

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt(opts.mentionLevel, opts.source.subreddit ?? null);
  const userPrompt = `Here is the real post to reply to:\n\n${describeSource(
    opts.source,
  )}\n\nWrite your reply now. Return only the JSON object.`;

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch (err) {
    return {
      ok: false,
      reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const body = parseBody(raw);
  if (!body) return { ok: false, reason: "could not parse model output" };
  if (!body.trim()) return { ok: false, reason: "empty reply from model" };
  return { ok: true, body: stripLongDashes(body.trim()), model: MODEL };
}

// The model is told to return bare JSON; be defensive about fences.
function parseBody(raw: string): string | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { body?: unknown };
    return typeof obj.body === "string" ? obj.body : null;
  } catch {
    return null;
  }
}
