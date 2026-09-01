// Forums → Wrenchlane mention enrichment (Phase 4). A raw keyword hit for
// "wrenchlane" is noisy — it can be someone praising us, warning others off a
// competitor, or a false positive (a username, an unrelated word). One cheap
// Claude call per third-party hit classifies it so the review queue and the
// Stats exposure section show signal, not raw matches.
//
// Only third-party hits need this. Our own posts are trusted (audience='us',
// status='confirmed') and never enriched.

import { generateText } from "@/lib/ai/provider";
import { stripLongDashes } from "@/lib/ai/no-long-dash";

const MODEL = "claude-sonnet-4-6";

export type MentionSentiment = "positive" | "neutral" | "negative" | "competitor";

export interface MentionEnrichment {
  // Is this actually about Wrenchlane the AI car-diagnostics company? "wrenchlane"
  // can be a username, a typo, or an unrelated string — false = noise to dismiss.
  isAboutUs: boolean;
  sentiment: MentionSentiment;
  // Short kebab-ish tag: "recommendation", "complaint", "comparison", "question", …
  contextTag: string;
  // One-sentence plain summary of what was said, for the review list.
  summary: string;
}

export type EnrichResult =
  | { ok: true; enrichment: MentionEnrichment; model: string }
  | { ok: false; reason: string };

const SYSTEM = `You classify Reddit mentions of "Wrenchlane" for a brand-monitoring tool.

Wrenchlane is an AI-driven car-diagnostics product for mechanics and car owners: you describe symptoms / paste fault codes and it suggests likely causes.

You are given the subreddit, author, and the text of a Reddit post or comment that contains the word "wrenchlane" or a link to a wrenchlane domain. Decide:

- is_about_us: true only if this genuinely refers to the Wrenchlane car-diagnostics product/company. Set false for coincidental matches (a username, an unrelated word, a different company).
- sentiment: one of positive | neutral | negative | competitor.
    - positive: recommends or praises Wrenchlane.
    - negative: complains about or warns against Wrenchlane.
    - neutral: mentions it factually, asks about it, or is ambiguous.
    - competitor: brings it up while recommending a DIFFERENT tool over it.
- context_tag: one short lowercase tag, e.g. recommendation, complaint, comparison, question, mention, spam.
- summary: one plain sentence (no dashes) on what was said about Wrenchlane.

Return ONLY a JSON object: {"is_about_us": bool, "sentiment": "...", "context_tag": "...", "summary": "..."}`;

function parse(raw: string): MentionEnrichment | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const sentiment = String(o.sentiment ?? "neutral").toLowerCase();
    const valid: MentionSentiment[] = ["positive", "neutral", "negative", "competitor"];
    return {
      isAboutUs: o.is_about_us === true,
      sentiment: (valid.includes(sentiment as MentionSentiment) ? sentiment : "neutral") as MentionSentiment,
      contextTag: stripLongDashes(String(o.context_tag ?? "mention").toLowerCase().trim()).slice(0, 40),
      summary: stripLongDashes(String(o.summary ?? "").trim()).slice(0, 500),
    };
  } catch {
    return null;
  }
}

export async function enrichMention(opts: {
  subreddit: string | null;
  author: string | null;
  text: string;
}): Promise<EnrichResult> {
  const userPrompt = `Subreddit: ${opts.subreddit ? `r/${opts.subreddit}` : "unknown"}
Author: ${opts.author ? `u/${opts.author}` : "unknown"}
Text:
"""
${opts.text.slice(0, 4000)}
"""

Classify this mention. Return only the JSON object.`;

  const result = await generateText({
    label: "forums/mention-enrich",
    anthropicModel: MODEL,
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 400,
  });
  if (!result.ok) return { ok: false, reason: `ai error: ${result.reason}` };

  const enrichment = parse(result.text);
  if (!enrichment) return { ok: false, reason: "could not parse model output" };
  return { ok: true, enrichment, model: result.model };
}
