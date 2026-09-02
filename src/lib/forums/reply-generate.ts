import { generateText } from "@/lib/ai/provider";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";
import {
  buildStyleGuidance,
  MENTION_GUIDANCE,
  mentionKnowledgeBlock,
  normalizeOptions,
  type ForumGenerationOptions,
} from "./generation-options";
import { boardLabel, type ReplySource } from "./replies";
import type { ForumPlatform } from "./types";

// Sonnet for creative quality — same call as the post generator. These are
// public-facing comments that have to read like a real, knowledgeable person
// wrote them.
const MODEL = "claude-sonnet-4-6";

// Gemini's strong model when Gemini serves this call. Named explicitly rather
// than left to the provider default: a forum reply is public-facing prose in a
// language the reviewer may not read closely, so it is the wrong place to save
// a few tokens on the flash model. See src/lib/ai/provider.ts for how the
// primary provider is chosen (AI_PRIMARY_PROVIDER).
const GEMINI_MODEL = "gemini-pro-latest";

/**
 * Community-specific framing for the prompt.
 *
 * Garaget is not "Reddit but Swedish". It is an older, slower forum where
 * threads are read by people who work on the car themselves, the board asks for
 * a specific set of facts before you diagnose, and a reply that reads as
 * translated English is worse than no reply at all. So the language instruction
 * is stated as a hard constraint rather than left to the tone guidance, which
 * models routinely drift away from over a long generation.
 */
function communityFraming(platform: ForumPlatform, board: string | null): {
  where: string;
  medium: string;
  language: string;
} {
  if (platform === "garaget") {
    const label = board ? `Garaget (${board})` : "Garaget";
    return {
      where: `the Swedish car forum ${label} (garaget.org)`,
      medium: "forum reply",
      language: `HARD REQUIREMENT: write the entire reply in Swedish. Not English, not a translation of an English answer, but Swedish written from the start, the way a Swedish mechanic or experienced owner writes on a forum. Use the ordinary Swedish workshop words (felkod, felsökning, tomgång, lambdasond, kamrem, laddtryck, bränslepump) rather than English terms. Address the person as "du".

The board's own pinned posting guide asks every question to state the full model designation, the engine, whether the car is modified, and when the fault appears. If the poster left any of that out and it changes your answer, ask for it specifically instead of guessing.`,
    };
  }

  const where = board ? `r/${board.replace(/^r\//i, "")}` : "a car-repair subreddit";
  return {
    where,
    medium: "Reddit comment",
    language: "Write in English.",
  };
}

function buildSystemPrompt(
  options: ForumGenerationOptions,
  platform: ForumPlatform,
  board: string | null,
): string {
  const { where, medium, language } = communityFraming(platform, board);
  return `You are writing a reply to a real post on ${where}. The reply will be copy-pasted, by a human, as a ${medium}. Your job is to write ONE genuinely helpful comment that reads exactly like a knowledgeable regular wrote it.

${language}

What a good reply does:
- Actually engages with THIS person's specific problem: reference their car, symptoms and what they've already tried. Never a generic checklist that ignores their details.
- Gives real diagnostic direction: the most likely cause given what they described, how to confirm it, and the next thing to check. If their described fix should have worked, explain why it might not have (e.g. air still in the system, wrong bleed order, a failing component upstream).
- Is honest about uncertainty. If it could be several things, say what you'd rule out first and how. Don't pretend to be certain you can't be.

Brand-mention rule: ${MENTION_GUIDANCE[options.mentionLevel]}

How to write this one:
${buildStyleGuidance(options)}

How to sound human, not like AI:
- Forum voice: conversational, contractions, gets to the point. No headings, no "Here are the steps:", no numbered listicle unless it genuinely reads better as a short list.
- No corporate phrasing, no "I hope this helps!", no emojis unless natural. Don't restate their whole post back to them.
- You're a peer helping out, not customer support. Confident but not condescending.
- ${NO_LONG_DASH_INSTRUCTION}

${mentionKnowledgeBlock(options.mentionLevel)}Return ONLY a JSON object, no markdown fences, no commentary, of exactly this shape:
{"body": "<the reply text, plain text, real line breaks as \\n>"}`;
}

function describeSource(s: ReplySource, platform: ForumPlatform): string {
  const lines: string[] = [];
  const board = sourceBoard(s);
  if (board) lines.push(`Board: ${boardLabel(platform, board)}`);
  if (s.title) lines.push(`Post title: ${s.title}`);
  if (s.body && s.body.trim()) {
    lines.push(`Post body:\n${s.body.trim()}`);
  } else {
    lines.push("(No post body — the title is the whole question.)");
  }
  return lines.join("\n\n");
}

/** Which board a source came from, tolerating the older subreddit-only shape. */
function sourceBoard(s: ReplySource): string | null {
  return s.board ?? s.subreddit ?? null;
}

/**
 * A source written before platforms existed has no `platform`, and every one of
 * those is a Reddit post, so defaulting to Reddit is correct rather than merely
 * convenient. A pasted garaget.org URL is recognised on its own.
 */
function sourcePlatform(s: ReplySource): ForumPlatform {
  if (s.platform) return s.platform;
  if (s.url && /garaget\.org/i.test(s.url)) return "garaget";
  return "reddit";
}

export type GenerateReplyResult =
  | { ok: true; body: string; model: string }
  | { ok: false; reason: string };

export async function generateForumReply(opts: {
  source: ReplySource;
  options: ForumGenerationOptions;
}): Promise<GenerateReplyResult> {
  if (!opts.source.title?.trim()) return { ok: false, reason: "The post has no title/question to reply to" };

  const options = normalizeOptions(opts.options);
  const platform = sourcePlatform(opts.source);
  const systemPrompt = buildSystemPrompt(options, platform, sourceBoard(opts.source));
  const userPrompt = `Here is the real post to reply to:\n\n${describeSource(
    opts.source,
    platform,
  )}\n\nWrite your reply now. Return only the JSON object.`;

  const result = await generateText({
    label: "forums/reply-generate",
    anthropicModel: MODEL,
    geminiModel: GEMINI_MODEL,
    system: systemPrompt,
    user: userPrompt,
    // Swedish runs longer than English for the same content, and a truncated
    // reply is worse than a short one, so give the non-English path headroom.
    maxTokens: platform === "garaget" ? 2048 : 1536,
  });
  if (!result.ok) return { ok: false, reason: `ai error: ${result.reason}` };

  const body = parseBody(result.text);
  if (!body) return { ok: false, reason: "could not parse model output" };
  if (!body.trim()) return { ok: false, reason: "empty reply from model" };
  return { ok: true, body: stripLongDashes(body.trim()), model: result.model };
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
