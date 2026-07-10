// Forums → Gap log auto-discovery. Given a real Reddit post pulled by the
// Answer-posts scrape, decide whether it's an "AI diagnosis went wrong" case and,
// if so, extract the same fields the Gap log (ai_failure_stories) stores.
//
// Deliberately a close cousin of mention-enrich.ts: same cheap one-shot Claude
// call, same JSON-extraction + graceful ok/reason result, same stripLongDashes
// post-processing. The only differences are the system prompt and output schema.

import Anthropic from "@anthropic-ai/sdk";
import { stripLongDashes } from "@/lib/ai/no-long-dash";
import type { FailureOutcome } from "./gaps";

const MODEL = "claude-sonnet-4-6";

export interface GapClassification {
  // true only if this is a genuine case where someone leaned on an AI tool for a
  // car diagnosis and it steered them wrong (or partly wrong). A plain question
  // with no AI involvement, or a post about something else, is false.
  isAiFailureCase: boolean;
  confidence: number; // 0..1
  symptom: string; // what the car was doing (required if isAiFailureCase)
  aiTool: string | null; // which AI/chatbot/app they used
  aiClaimedCause: string | null; // what the AI said was wrong
  actionTaken: string | null; // the part they replaced / repair attempted
  costAmount: number | null; // what the wrong turn cost, if stated
  costCurrency: string | null;
  actualCause: string | null; // the real root cause, if known
  outcome: FailureOutcome;
}

export type GapClassifyResult =
  | { ok: true; classification: GapClassification; model: string }
  | { ok: false; reason: string };

const SYSTEM = `You screen Reddit posts for a car-diagnostics company (Wrenchlane) building an eval set of cases where AI diagnostic tools failed.

A case QUALIFIES only when the post describes a real vehicle problem where someone relied on an AI tool for the diagnosis and it turned out wrong or misleading. The AI tool can be ChatGPT, an OBD/scanner app with "AI", a chatbot, an app that reads fault codes, etc. Mechanic forums are full of ordinary help questions with NO AI involvement — those do NOT qualify.

You are given the subreddit, author, title and body of one Reddit post. Decide:

- is_ai_failure_case: true ONLY if an AI/chatbot/app was used for the diagnosis AND it gave a wrong, misleading, or unhelpful answer (fully or partly). If no AI tool is mentioned, or the AI was actually right, set false.
- confidence: 0..1, how sure you are it qualifies.
- symptom: what the car was doing (concise). Required when is_ai_failure_case is true.
- ai_tool: which AI/tool they used (e.g. "ChatGPT", "an OBD app"), or null.
- ai_claimed_cause: what the AI said was wrong, or null.
- action_taken: the part they replaced or repair they attempted on the AI's advice, or null.
- cost_amount: number only, what the wrong turn cost them if stated, else null.
- cost_currency: ISO-ish currency for cost_amount (e.g. "USD", "EUR"), else null.
- actual_cause: the real root cause once found, or null if unknown.
- outcome: one of failure | partial | success | unknown.
    - failure: AI was wrong, wasted money/time.
    - partial: AI was partly right or pointed vaguely in the right area.
    - success: AI actually got it right (rare here; still set is_ai_failure_case=false).
    - unknown: unresolved / unclear.

When is_ai_failure_case is false, still return the object with empty/null fields and confidence reflecting your certainty it does NOT qualify.

Use no dashes in any text. Return ONLY a JSON object:
{"is_ai_failure_case": bool, "confidence": number, "symptom": "...", "ai_tool": "...|null", "ai_claimed_cause": "...|null", "action_taken": "...|null", "cost_amount": number|null, "cost_currency": "...|null", "actual_cause": "...|null", "outcome": "failure|partial|success|unknown"}`;

const VALID_OUTCOMES: FailureOutcome[] = ["failure", "partial", "success", "unknown"];

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

function strOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = stripLongDashes(v.trim());
  return s ? s.slice(0, max) : null;
}

function parse(raw: string): GapClassification | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const outcome = String(o.outcome ?? "failure").toLowerCase();
    const conf = numOrNull(o.confidence);
    return {
      isAiFailureCase: o.is_ai_failure_case === true,
      confidence: conf === null ? 0 : Math.min(Math.max(conf, 0), 1),
      symptom: strOrNull(o.symptom, 4000) ?? "",
      aiTool: strOrNull(o.ai_tool, 200),
      aiClaimedCause: strOrNull(o.ai_claimed_cause, 4000),
      actionTaken: strOrNull(o.action_taken, 4000),
      costAmount: numOrNull(o.cost_amount),
      costCurrency: strOrNull(o.cost_currency, 8),
      actualCause: strOrNull(o.actual_cause, 4000),
      outcome: (VALID_OUTCOMES.includes(outcome as FailureOutcome) ? outcome : "failure") as FailureOutcome,
    };
  } catch {
    return null;
  }
}

export async function classifyGapPost(opts: {
  subreddit: string | null;
  author: string | null;
  title: string;
  body: string | null;
}): Promise<GapClassifyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const client = new Anthropic({ apiKey });
  const userPrompt = `Subreddit: ${opts.subreddit ? `r/${opts.subreddit}` : "unknown"}
Author: ${opts.author ? `u/${opts.author}` : "unknown"}
Title: ${opts.title}
Body:
"""
${(opts.body ?? "").slice(0, 4000)}
"""

Screen this post. Return only the JSON object.`;

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch (err) {
    return { ok: false, reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const classification = parse(raw);
  if (!classification) return { ok: false, reason: "could not parse model output" };
  return { ok: true, classification, model: MODEL };
}
