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
