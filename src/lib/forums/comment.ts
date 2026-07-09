import Anthropic from "@anthropic-ai/sdk";

// Drafts a Reddit *reply* the team can paste under one of our forum posts, so
// members can add to the conversation from their own accounts. Sonnet for the
// same human-quality reason as the post generator; low volume, cost is a
// non-issue.
const MODEL = "claude-sonnet-4-6";

export type GenerateCommentResult =
  | { ok: true; comment: string; model: string }
  | { ok: false; reason: string };

export async function generateForumComment(opts: {
  subreddit: string;
  tone?: string | null;
  rulesNote?: string | null;
  title: string;
  body?: string | null;
}): Promise<GenerateCommentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const system = `You write a single authentic reply to a car-forum post on ${opts.subreddit}. A real person on our team will paste it as a comment from their own account, so it must read exactly like a genuine community member replying — never like marketing.

${opts.tone ? `Community tone: ${opts.tone}\n` : ""}${opts.rulesNote ? `Community norms (respect these): ${opts.rulesNote}\n` : ""}
Rules for the reply:
- Add something real to the discussion: share a specific opinion, an experience, or a concrete example. Take a stance; don't just agree blandly.
- Sound human — contractions, a little imperfect, specific over generic. 2–5 sentences.
- Do NOT mention Wrenchlane, any app, brand, or product. No links. No sales language.
- Don't restate the whole question. Reply as if you're one of many commenters.

Return ONLY the reply text, no quotes, no preamble, no markdown.`;

  const user = `The post you're replying to:\n\nTitle: ${opts.title}\n\n${
    opts.body ? `Body:\n${opts.body}` : "(no body)"
  }\n\nWrite the reply now.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    if (!text) return { ok: false, reason: "empty comment from model" };
    return { ok: true, comment: text, model: MODEL };
  } catch (err) {
    return {
      ok: false,
      reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// --- Per-member comments -----------------------------------------------------

export type PerMemberComment = { owner_label: string; comment: string };

export type GenerateCommentsResult =
  | { ok: true; comments: PerMemberComment[]; model: string }
  | { ok: false; reason: string };

// Drafts a *distinct* reply for each team member in one call. Doing it in a
// single call (rather than N independent ones) lets the model see all the
// replies at once and deliberately diversify them — different anecdote, stance,
// and phrasing — so N teammates posting them don't look like coordinated spam.
// Each member picks the one drafted for them and reworks it in their own voice.
export async function generateForumComments(opts: {
  subreddit: string;
  tone?: string | null;
  rulesNote?: string | null;
  title: string;
  body?: string | null;
  members: string[]; // owner labels, e.g. ["Hans", "Matteo", ...]
}): Promise<GenerateCommentsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const members = opts.members.filter((m) => m && m.trim()).map((m) => m.trim());
  if (members.length === 0) return { ok: false, reason: "no members" };

  const system = `You write authentic replies to a car-forum post on ${opts.subreddit}. ${members.length} different people on our team will each paste ONE of these as a comment from their own Reddit account, so each reply must read like a genuine, independent community member — never like marketing, and never like variations of the same message.

${opts.tone ? `Community tone: ${opts.tone}\n` : ""}${opts.rulesNote ? `Community norms (respect these): ${opts.rulesNote}\n` : ""}
Write exactly ${members.length} replies, one per person, in this order: ${members.join(", ")}.

Hard rules:
- Each reply must be GENUINELY DIFFERENT from the others: a different specific experience or example, a different stance or angle, different sentence rhythm and length. Two of them should never feel interchangeable.
- Sound human — contractions, a little imperfect, specific over generic. 2–5 sentences each.
- Add something real: an opinion, an experience, a concrete example. Take a stance; don't just agree blandly.
- Do NOT mention Wrenchlane, any app, brand, or product. No links. No sales language.
- Don't restate the whole question. Reply as one of many commenters.

Return ONLY a JSON array of objects, no prose, no markdown fences:
[{"member":"<name>","comment":"<the reply text>"}, ...]
One object per person, in the order given.`;

  const user = `The post everyone is replying to:\n\nTitle: ${opts.title}\n\n${
    opts.body ? `Body:\n${opts.body}` : "(no body)"
  }\n\nWrite the ${members.length} replies now.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const parsed = parseCommentsJson(raw);
    if (!parsed) return { ok: false, reason: "could not parse comments JSON from model" };

    // Map back to the requested members by name (case-insensitive), falling back
    // to positional order so a slightly-off name label still lands.
    const byName = new Map(parsed.map((p) => [p.member.trim().toLowerCase(), p.comment]));
    const comments: PerMemberComment[] = members.map((label, i) => {
      const comment =
        byName.get(label.toLowerCase()) ?? parsed[i]?.comment ?? "";
      return { owner_label: label, comment: comment.trim() };
    });
    if (comments.every((c) => !c.comment)) {
      return { ok: false, reason: "empty comments from model" };
    }
    return { ok: true, comments, model: MODEL };
  } catch (err) {
    return {
      ok: false,
      reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function parseCommentsJson(
  raw: string,
): Array<{ member: string; comment: string }> | null {
  // Strip accidental ```json fences, then slice to the outermost array.
  let text = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter(
        (o): o is { member: unknown; comment: unknown } =>
          o && typeof o === "object",
      )
      .map((o) => ({
        member: typeof o.member === "string" ? o.member : "",
        comment: typeof o.comment === "string" ? o.comment : "",
      }))
      .filter((o) => o.comment);
    return out.length ? out : null;
  } catch {
    return null;
  }
}
