import Anthropic from "@anthropic-ai/sdk";
import { WRENCHLANE_KNOWLEDGE } from "@/lib/inbox/wrenchlane-knowledge";
import type {
  ForumMentionLevel,
  ForumPostType,
  ForumScenario,
  ForumTarget,
} from "./types";

// Sonnet for creative quality — these are public-facing posts that have to read
// like a real person wrote them (decided 2026-06-16). Low volume, so cost is
// a non-issue.
const MODEL = "claude-sonnet-4-6";

const POST_TYPE_GUIDANCE: Record<ForumPostType, string> = {
  help_question:
    "Write as the car owner who has this problem RIGHT NOW and is asking the community for help. Open with the symptom in your own words, give the relevant facts (car, mileage, any codes), say what you've already noticed or tried, and end with a genuine question. Sound a little uncertain — you don't know the answer, that's why you're posting.",
  solved_story:
    "Write as the owner who already figured this one out and is sharing it so the next person who searches finds it. Tell the short story: the symptom, the dead ends, how you narrowed it down, and what it actually was. Helpful and a bit relieved in tone.",
  helpful_answer:
    "Write as a knowledgeable person answering a common version of this problem for whoever searches it later. Lead with the most likely cause, explain how to confirm it, and cover the runner-up causes briefly. Confident but not condescending.",
};

const MENTION_GUIDANCE: Record<ForumMentionLevel, string> = {
  none: "Do NOT mention Wrenchlane, any app, or any product at all. This is a pure community post.",
  subtle:
    "You MAY mention, in one passing and natural aside, that you ran the symptoms through an AI car-diagnosis app to narrow things down — without naming a brand or linking anything. Keep it incidental; the post must stand on its own as helpful even if that line were deleted.",
  explicit:
    "You may name Wrenchlane once, naturally, as the tool you used to diagnose this (e.g. 'I put the symptoms into Wrenchlane and it flagged X as the most likely cause'). One mention only, no link, no sales language. The post must still read as a genuine owner/helper post, never an ad.",
};

function buildSystemPrompt(opts: {
  target: ForumTarget;
  postType: ForumPostType;
  mentionLevel: ForumMentionLevel;
  language: string;
}): string {
  const { target, postType, mentionLevel, language } = opts;
  return `You write authentic posts for car forums. The output will be copy-pasted, by a human, into ${target.name} (${target.platform}). Your job is to produce ONE post that reads exactly like a real person in that community wrote it.

Community tone for ${target.name}: ${target.tone}
Community posting norms (respect these): ${target.rulesNote}

Post angle: ${POST_TYPE_GUIDANCE[postType]}

Brand-mention rule: ${MENTION_GUIDANCE[mentionLevel]}

Language: Write the entire post (title and body) in ${language === "sv" ? "Swedish" : "English"}.

How to sound human, not like AI:
- Use the real car facts you're given. Don't invent a different car, mileage, or codes.
- Imperfect and specific beats polished and generic. Real people ramble a little, use contractions, and mention concrete details ("started about two weeks ago, mostly when cold").
- No corporate phrasing, no bullet-point listicles unless the angle is helpful_answer. No emojis unless they'd be natural. Don't end with "Any help appreciated!" every time — vary it.
- Never sound like marketing. If the brand-mention rule is "none", there is zero product talk.
- Keep it realistic in length: a help question is a short paragraph or two; a solved story or helpful answer can be a bit longer.

${
  mentionLevel === "none"
    ? ""
    : `For grounding ONLY (so any mention is accurate — do not paste this in):
=== WRENCHLANE PRODUCT KNOWLEDGE ===
${WRENCHLANE_KNOWLEDGE}
=== END ===
`
}
Return ONLY a JSON object, no markdown fences, no commentary, of exactly this shape:
{"title": "<the forum post title>", "body": "<the post body, plain text, real line breaks as \\n>"}`;
}

function describeScenario(s: ForumScenario): string {
  const lines: string[] = [];
  const car = [s.carYear, s.carMake, s.carModel].filter(Boolean).join(" ");
  if (car) lines.push(`Car: ${car}`);
  if (s.mileage) lines.push(`Mileage: ${s.mileage}`);
  if (s.description) lines.push(`Owner's description of the problem: ${s.description}`);
  if (s.symptoms.length) lines.push(`Symptoms: ${s.symptoms.join(", ")}`);
  if (s.dtcs.length) lines.push(`Fault codes (DTCs): ${s.dtcs.join(", ")}`);
  if (s.causes.length) {
    lines.push("Likely causes the diagnosis surfaced (most likely first):");
    for (const c of s.causes) {
      const prob =
        c.probability != null ? ` (~${Math.round(c.probability * 100)}% likely)` : "";
      const sev = c.severity ? `, severity ${c.severity}` : "";
      lines.push(`  - ${c.name}${prob}${sev}${c.description ? ` — ${c.description}` : ""}`);
    }
  }
  return lines.join("\n");
}

export type GenerateForumPostResult =
  | { ok: true; title: string; body: string; model: string }
  | { ok: false; reason: string };

export async function generateForumPost(opts: {
  scenario: ForumScenario;
  target: ForumTarget;
  postType: ForumPostType;
  mentionLevel: ForumMentionLevel;
  language: string;
}): Promise<GenerateForumPostResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt(opts);
  const userPrompt = `Here is the real diagnostic scenario to base the post on:\n\n${describeScenario(
    opts.scenario,
  )}\n\nWrite the post now. Return only the JSON object.`;

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
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

  const parsed = parseTitleBody(raw);
  if (!parsed) return { ok: false, reason: "could not parse model output" };
  if (!parsed.title.trim() || !parsed.body.trim()) {
    return { ok: false, reason: "empty title or body from model" };
  }
  return { ok: true, title: parsed.title.trim(), body: parsed.body.trim(), model: MODEL };
}

// The model is told to return bare JSON, but be defensive: strip code fences and
// grab the first {...} block before parsing.
function parseTitleBody(raw: string): { title: string; body: string } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
      title?: unknown;
      body?: unknown;
    };
    if (typeof obj.title !== "string" || typeof obj.body !== "string") return null;
    return { title: obj.title, body: obj.body };
  } catch {
    return null;
  }
}
