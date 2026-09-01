import "server-only";
import { generateJson, type AiJsonSpec } from "@/lib/ai/provider";
import { NO_LONG_DASH_INSTRUCTION } from "@/lib/ai/no-long-dash";
import type { ProviderTranscriptTurn } from "@/lib/call-agent/elevenlabs";

// Read a switchboard call and work out what the receptionist could NOT answer.
//
// The point is a knowledge backlog built from real calls instead of guesses about
// what people might ask. The provider already writes its own summary; what it does
// not tell us is where the agent ran out of knowledge, and that is the only part
// that turns into work.

const MODEL = "claude-sonnet-4-6";

export interface SwitchboardAnalysis {
  /** Two or three sentences on what the caller wanted and what happened. */
  summary: string;
  /**
   * Questions the caller asked that the agent could not answer from what it knew.
   * Rewritten as a clear question a human could go and answer, not a quote.
   */
  unanswered: string[];
  /** Anything the agent stated that looks wrong or invented, for review. */
  suspect_claims: string[];
}

const TOOL: AiJsonSpec = {
  name: "record_switchboard_analysis",
  description:
    "Record what happened on a call to the AI receptionist, and specifically what it could not answer.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "Two or three sentences: what the caller wanted, what the receptionist did, how it ended.",
      },
      unanswered: {
        type: "array",
        items: { type: "string" },
        description:
          "Questions the caller asked that the receptionist could not answer, said it was unsure " +
          "about, deflected to a human, or promised to check. Phrase each as a clear question a " +
          "colleague could go and answer, in English, without the caller's filler. Empty array if " +
          "the receptionist answered everything asked of it.",
      },
      suspect_claims: {
        type: "array",
        items: { type: "string" },
        description:
          "Anything the receptionist asserted that looks invented, internally inconsistent, or " +
          "not the kind of fact it should have. Empty array if nothing stood out.",
      },
    },
    required: ["summary", "unanswered", "suspect_claims"],
  },
};

export function transcriptToText(turns: ProviderTranscriptTurn[] | undefined): string {
  if (!turns?.length) return "";
  return turns
    .map((t) => {
      const who = t.role === "agent" ? "Receptionist" : "Caller";
      const msg = (t.message ?? "").trim();
      // An empty user turn is the provider's way of saying it heard nothing, which
      // is meaningful: it usually means silence, not that the caller said nothing.
      return `${who}: ${msg || "(silence)"}`;
    })
    .join("\n");
}

export type AnalyzeSwitchboardResult =
  | { ok: true; analysis: SwitchboardAnalysis }
  | { ok: false; reason: string };

export async function analyzeSwitchboardCall(ctx: {
  transcript: string;
  knowledgeMd: string;
}): Promise<AnalyzeSwitchboardResult> {
  const text = ctx.transcript.trim();
  if (!text) return { ok: false, reason: "empty transcript" };

  const system = `You review calls to Wrenchlane's AI phone receptionist and report what it could not answer.

The receptionist is given the knowledge document below and nothing else. So a question counts as UNANSWERED when the answer is not in that document, regardless of how gracefully the receptionist handled it. Judge against the document, not against what you happen to know about cars or software.

Count as unanswered when the receptionist:
  - said it was not sure, did not know, or would find out
  - offered a human or took a message because it could not answer
  - answered only vaguely where the caller clearly wanted a specific fact

Do NOT count:
  - a transfer the caller asked for by name, that is the receptionist working correctly
  - questions the document does answer and the receptionist answered
  - the caller's own small talk

Be strict about suspect_claims. The receptionist must only state facts from the document. If it produced a number, a name, a policy or a promise that is not in there, list it, because that is a customer being misinformed.

=== KNOWLEDGE THE RECEPTIONIST HAD ===
${ctx.knowledgeMd}
=== END KNOWLEDGE ===

${NO_LONG_DASH_INSTRUCTION}

Call the record_switchboard_analysis tool exactly once. If the transcript is silence or a wrong number, say so in the summary and return empty arrays rather than inventing findings.`;

  const result = await generateJson<Partial<SwitchboardAnalysis>>(
    {
      label: "switchboard/analyze",
      anthropicModel: MODEL,
      system,
      user: `Transcript:\n${text}`,
      maxTokens: 1500,
    },
    TOOL,
  );
  if (!result.ok) return { ok: false, reason: result.reason };

  const input = result.data;
  return {
    ok: true,
    analysis: {
      summary: (input.summary ?? "").trim(),
      unanswered: (input.unanswered ?? []).map((s) => s.trim()).filter(Boolean),
      suspect_claims: (input.suspect_claims ?? []).map((s) => s.trim()).filter(Boolean),
    },
  };
}
