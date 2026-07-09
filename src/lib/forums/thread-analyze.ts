import Anthropic from "@anthropic-ai/sdk";
import { WRENCHLANE_KNOWLEDGE } from "@/lib/inbox/wrenchlane-knowledge";
import { stripLongDashes } from "@/lib/ai/no-long-dash";
import type { RedditComment } from "./reddit";
import type { ForumMentionLevel } from "./types";

// Reads a live comment thread on one of our posts and decides which of OTHER
// people's comments are worth a reply, drafts that reply, and assigns it to the
// teammate whose persona fits best — a hands-on mechanic answers a hands-on
// question; someone who uses AI apps drops the "I ran it through an app" aside;
// only a member cleared to name Wrenchlane ever does. Sonnet for the same
// human-quality reason as the post generator.
const MODEL = "claude-sonnet-4-6";

// A roster member with the persona flags that gate assignment + mention level.
export interface PersonaMember {
  owner_label: string;
  account_id: string | null;
  turns_wrenches: boolean;
  uses_ai_tools: boolean;
  can_mention_wrenchlane: boolean;
  persona_note: string | null;
}

// One "reply to this comment" recommendation, resolved back to the real comment.
export interface ThreadReplyPick {
  reddit_comment_id: string;
  reddit_comment_url: string | null;
  comment_author: string | null;
  comment_excerpt: string;
  comment_score: number | null;
  why: string;
  assigned_owner_label: string;
  account_id: string | null;
  mention_level: ForumMentionLevel;
  reply_text: string;
  priority: number;
}

export type AnalyzeThreadResult =
  | { ok: true; picks: ThreadReplyPick[]; model: string }
  | { ok: false; reason: string };

// The strongest mention level a member is allowed to use, given their flags.
function ceilingFor(m: PersonaMember): ForumMentionLevel {
  if (m.can_mention_wrenchlane) return "explicit";
  if (m.uses_ai_tools) return "subtle";
  return "none";
}

const RANK: Record<ForumMentionLevel, number> = { none: 0, subtle: 1, explicit: 2 };

// Clamp a requested mention level down to what the assignee may actually say.
function clampMention(requested: ForumMentionLevel, m: PersonaMember): ForumMentionLevel {
  const ceiling = ceilingFor(m);
  return RANK[requested] <= RANK[ceiling] ? requested : ceiling;
}

function describeMember(m: PersonaMember): string {
  const traits: string[] = [];
  if (m.turns_wrenches) traits.push("works on cars hands-on (real bench experience)");
  if (m.uses_ai_tools) traits.push("has used AI car-diagnosis apps");
  if (m.can_mention_wrenchlane) traits.push("MAY name Wrenchlane, sparingly");
  const allowed = ceilingFor(m);
  const mentionRule =
    allowed === "explicit"
      ? "may use mention level none / subtle / explicit"
      : allowed === "subtle"
        ? "may use none or subtle (never explicit — do not let them name Wrenchlane)"
        : "must use none only (no AI-app aside, never name Wrenchlane)";
  const base = traits.length ? traits.join("; ") : "general enthusiast";
  const note = m.persona_note ? ` Note: ${m.persona_note}` : "";
  return `- ${m.owner_label}: ${base}. ${mentionRule}.${note}`;
}

// Trim a comment for the prompt without dropping the substance.
function excerpt(body: string, max = 700): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

const MENTION_GUIDANCE: Record<ForumMentionLevel, string> = {
  none: "pure help, no app or product mention",
  subtle:
    "one natural, incidental aside about running symptoms through an AI diagnosis app (no brand name); the reply must stand on its own without it",
  explicit:
    "may name Wrenchlane once, naturally, as a tool that helped; lead with real help, mention it as an afterthought, no link, no sales language",
};

export async function analyzeThreadReplies(opts: {
  subreddit: string;
  postTitle: string;
  postBody?: string | null;
  comments: RedditComment[];
  members: PersonaMember[];
  maxPicks?: number;
}): Promise<AnalyzeThreadResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };
  if (opts.members.length === 0) return { ok: false, reason: "no roster members to assign replies to" };

  // Keep substantive comments only, best (highest score) first, capped so the
  // prompt stays bounded. One-liners ("this", "lol") rarely deserve a reply.
  const candidates = opts.comments
    .filter((c) => c.body && c.body.replace(/\s+/g, " ").trim().length >= 20)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 40);
  if (candidates.length === 0) return { ok: false, reason: "no substantive comments to reply to yet" };

  const maxPicks = Math.min(Math.max(opts.maxPicks ?? 8, 1), 15);
  const anyMentions = opts.members.some((m) => m.uses_ai_tools || m.can_mention_wrenchlane);

  const commentList = candidates
    .map(
      (c, i) =>
        `[${i}] u/${c.author ?? "unknown"} (${c.score ?? 0} pts): ${excerpt(c.body)}`,
    )
    .join("\n\n");

  const system = `You help a small team decide which comments on THEIR car-forum post to reply to, and draft each reply. The post is on r/${opts.subreddit.replace(/^r\//i, "")}. Real people paste these replies from their own Reddit accounts, so each must read like a genuine community member, never like marketing or a coordinated campaign.

Pick the ${maxPicks} comments (or fewer) most worth replying to. Good picks:
- Someone describing a real problem or symptom your team can genuinely help diagnose.
- A thoughtful or skeptical take on AI diagnostics that invites a substantive, respectful back-and-forth.
- A direct question, or a claim worth a specific, experience-backed counter or addition.
Skip low-value comments: one-liners, pure agreement, jokes, anything a reply wouldn't add to.

For each pick, assign ONE teammate whose persona fits the reply, and set the mention level. Mention levels:
- none = ${MENTION_GUIDANCE.none}
- subtle = ${MENTION_GUIDANCE.subtle}
- explicit = ${MENTION_GUIDANCE.explicit}

Assignment rules (hard):
- Only assign a mention level a member is allowed to use (see each member's rule). Default to "none" for most replies — brand mentions must be rare across the thread.
- Match the voice: a hands-on wrench answers hands-on/diagnostic questions; an AI-app user is the natural one for a "subtle" aside; spread picks across members so it doesn't look like one person.
- Never assign two of your picks to reply to the same commenter.

Writing rules:
- Reply directly to THAT comment: engage its specific point, don't post a generic take. Confident peer, not customer support.
- Human Reddit voice: contractions, gets to the point, 2 to 5 sentences. No headings, no listicles, no "hope this helps", no emojis unless natural.
- Do NOT use long dashes (— or –); write with commas or periods instead.

Team members you can assign to:
${opts.members.map(describeMember).join("\n")}
${
  anyMentions
    ? `\nFor grounding ONLY, so any Wrenchlane/AI-app mention is accurate (never paste this in):\n=== WRENCHLANE PRODUCT KNOWLEDGE ===\n${WRENCHLANE_KNOWLEDGE}\n=== END ===\n`
    : ""
}
Return ONLY a JSON array, no prose, no markdown fences, of this exact shape:
[{"comment_index": <number>, "why": "<one short line: why this comment is worth a reply>", "member": "<one of the member names above>", "mention_level": "none|subtle|explicit", "reply": "<the reply text, plain text, real line breaks as \\n>"}]
Order by priority, best first. Never invent a comment_index that isn't listed.`;

  const user = `Your team's post:\nTitle: ${opts.postTitle}\n${
    opts.postBody?.trim() ? `Body:\n${opts.postBody.trim()}\n` : ""
  }\nComments on it (index in brackets):\n\n${commentList}\n\nReturn the JSON array now.`;

  let raw = "";
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch (err) {
    return { ok: false, reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const parsed = parsePicks(raw);
  if (!parsed) return { ok: false, reason: "could not parse analysis from model" };

  const byName = new Map(opts.members.map((m) => [m.owner_label.trim().toLowerCase(), m]));
  const seenComments = new Set<string>();
  const picks: ThreadReplyPick[] = [];

  for (const p of parsed) {
    const c = candidates[p.comment_index];
    if (!c || !c.id) continue;
    if (seenComments.has(c.id)) continue; // one reply per comment
    const member = byName.get(p.member.trim().toLowerCase()) ?? opts.members[0];
    const reply = stripLongDashes((p.reply ?? "").trim());
    if (!reply) continue;
    seenComments.add(c.id);
    picks.push({
      reddit_comment_id: c.id,
      reddit_comment_url: c.permalink,
      comment_author: c.author,
      comment_excerpt: excerpt(c.body, 500),
      comment_score: c.score,
      why: stripLongDashes((p.why ?? "").trim()),
      assigned_owner_label: member.owner_label,
      account_id: member.account_id,
      mention_level: clampMention(p.mention_level, member),
      reply_text: reply,
      priority: picks.length,
    });
  }

  if (picks.length === 0) return { ok: false, reason: "the model returned no usable replies" };
  return { ok: true, picks, model: MODEL };
}

interface RawPick {
  comment_index: number;
  why: string;
  member: string;
  mention_level: ForumMentionLevel;
  reply: string;
}

function parsePicks(raw: string): RawPick[] | null {
  let text = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return null;
    const out: RawPick[] = [];
    for (const o of arr) {
      if (!o || typeof o !== "object") continue;
      const idx = typeof o.comment_index === "number" ? o.comment_index : Number(o.comment_index);
      if (!Number.isInteger(idx)) continue;
      const level: ForumMentionLevel =
        o.mention_level === "subtle" || o.mention_level === "explicit" ? o.mention_level : "none";
      out.push({
        comment_index: idx,
        why: typeof o.why === "string" ? o.why : "",
        member: typeof o.member === "string" ? o.member : "",
        mention_level: level,
        reply: typeof o.reply === "string" ? o.reply : "",
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
