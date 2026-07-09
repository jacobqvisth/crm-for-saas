import Anthropic from "@anthropic-ai/sdk";
import { CALL_OUTCOMES, type CallOutcome } from "./decision";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";

// AI summarization of a recorded call. One Sonnet tool-call returns both the
// human summary and the structured follow-up suggestions, so the CRM can
// auto-log the call and pre-fill a follow-up email / tasks for the agent to
// approve. Grounded in the workspace's Wrenchlane product knowledge so the
// suggested email stays factually accurate.

const MODEL = "claude-sonnet-4-6";

export interface SuggestedFollowupEmail {
  /** Whether a follow-up email makes sense at all for this call. */
  recommended: boolean;
  subject: string;
  /** Plain-text body; the composer wraps it. No signature/greeting boilerplate. */
  body: string;
  reason: string;
}

export interface SuggestedTask {
  title: string;
  /** ISO date (YYYY-MM-DD) when this should happen, or null for "soon". */
  due_date: string | null;
}

export interface CallFeedbackItem {
  category: "bug" | "feature_request" | "complaint" | "praise" | "other";
  severity: "low" | "medium" | "high" | "critical" | null;
  title: string | null;
  body: string;
}

export interface CallAnalysis {
  /** Summary in English — always present (the agent's scanning language). */
  summary: string;
  /** Summary in Swedish — present only for Swedish calls, else "". */
  summary_native: string;
  /**
   * The contact's language as a 2-letter ISO code (e.g. "sv", "en", "fi"), the
   * language the follow-up email should ultimately be sent in. Best guess from
   * the language hint + the language actually spoken in the transcript.
   */
  contact_language: string;
  key_takeaways: string[];
  sentiment: "positive" | "neutral" | "negative";
  suggested_outcome: CallOutcome;
  suggested_followup_email: SuggestedFollowupEmail;
  suggested_tasks: SuggestedTask[];
  feedback_items: CallFeedbackItem[];
}

export interface AnalyzeCallContext {
  transcript: string;
  contactName: string | null;
  companyName: string | null;
  /** Workspace product knowledge (from loadWrenchlaneKnowledge). */
  knowledgeMd: string;
  /** Today's date (ISO) so the model can schedule callbacks sensibly. */
  today: string;
  /**
   * Whether the contact is Swedish, from the contact's stored language/country.
   * "sv" → Swedish; "other" → a known non-Swedish contact; "unknown" → no data,
   * infer from the transcript. Drives the output-language rule:
   *   Swedish contact  → email + a Swedish summary (plus the English summary)
   *   everyone else    → email + summary in English only
   */
  languageHint: "sv" | "other" | "unknown";
}

export type AnalyzeResult =
  | { ok: true; analysis: CallAnalysis; model: string }
  | { ok: false; reason: string };

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "record_call_analysis",
  description: "Record the structured analysis of a sales/customer phone call.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "2-5 sentence summary of what was discussed and decided. ALWAYS in English.",
      },
      summary_native: {
        type: "string",
        description:
          "The SAME summary written in Swedish — ONLY when the contact is Swedish (see the language rule). For a non-Swedish contact, return an empty string \"\".",
      },
      contact_language: {
        type: "string",
        description:
          "The contact's language as a 2-letter ISO code (e.g. \"sv\", \"en\", \"fi\", \"no\", \"da\"). This is the language the follow-up email will ultimately be sent in. Infer from the language hint and the language actually spoken in the transcript. Default to \"en\" only if genuinely unclear.",
      },
      key_takeaways: {
        type: "array",
        items: { type: "string" },
        description: "Short bullet points in English: the most important facts, asks, objections, or commitments.",
      },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
      suggested_outcome: {
        type: "string",
        enum: CALL_OUTCOMES as unknown as string[],
        description:
          "Best-fit call outcome. 'closed' = signed up/committed; 'interested'; 'not_interested'; 'callback_scheduled' (only if a specific follow-up time was agreed); 'no_answer'; 'left_voicemail'; 'wrong_number'.",
      },
      suggested_followup_email: {
        type: "object",
        properties: {
          recommended: { type: "boolean" },
          subject: {
            type: "string",
            description:
              "Subject line in English (translated at send). Short and specific to this call — no generic 'Following up' filler.",
          },
          body: {
            type: "string",
            description:
              "Plain-text email body, ALWAYS in English (the agent reviews/edits in English; it is translated to the contact's language at send time — see the language rule). No greeting line and no signature — those are added at send time. Write like a human peer following up, not a chatbot. Requirements: (1) Reference at least one specific, concrete thing from THIS call — a question they raised, an objection, a vehicle/workflow they mentioned, or a commitment made — so it's obviously not a template. (2) Match the call outcome and sentiment: 'interested' → propose the concrete next step discussed; 'callback_scheduled' → confirm the agreed time; 'closed' → warm welcome + the one thing to do first; 'not_interested' → gracious, low-pressure, leave the door open; 'no_answer'/'left_voicemail' → brief nudge referencing the voicemail. (3) Keep it tight (2-4 sentences) with exactly one soft CTA. (4) Stay grounded in the product knowledge; never invent features, pricing, stats, or links.",
          },
          reason: { type: "string", description: "Why this email (or why not, if not recommended). One sentence." },
        },
        required: ["recommended", "subject", "body", "reason"],
      },
      suggested_tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            due_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD or null." },
          },
          required: ["title", "due_date"],
        },
        description: "Concrete follow-up actions the agent committed to or should take. Empty if none.",
      },
      feedback_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["bug", "feature_request", "complaint", "praise", "other"],
            },
            severity: { type: ["string", "null"], enum: ["low", "medium", "high", "critical", null] },
            title: { type: ["string", "null"] },
            body: { type: "string" },
          },
          required: ["category", "severity", "title", "body"],
        },
        description:
          "Product feedback the user gave (bugs, feature requests, complaints, praise). Empty if none. These feed the product triage board.",
      },
    },
    required: [
      "summary",
      "summary_native",
      "contact_language",
      "key_takeaways",
      "sentiment",
      "suggested_outcome",
      "suggested_followup_email",
      "suggested_tasks",
      "feedback_items",
    ],
  },
};

export async function analyzeCall(ctx: AnalyzeCallContext): Promise<AnalyzeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const client = new Anthropic({ apiKey });

  const contactSwedishness =
    ctx.languageHint === "sv"
      ? "The contact IS Swedish."
      : ctx.languageHint === "other"
        ? "The contact is NOT Swedish."
        : "The contact's language is unknown — decide whether they are Swedish by the language actually spoken in the transcript.";

  const system = `You analyze recorded phone calls between a Wrenchlane team member (the "Agent") and a user/prospect (the "Contact"), then produce a structured summary and follow-up plan that the Agent reviews before anything is sent.

Stay grounded in the canonical product knowledge below — never invent features, pricing, partners, stats, or links that aren't in it. Everything must read like a human peer, not a chatbot.

LANGUAGE RULE (important):
- ${contactSwedishness}
- Set \`contact_language\` to the contact's language as a 2-letter ISO code — the language the follow-up email will be sent in. Use the hint above and the language actually spoken in the transcript.
- The follow-up email (subject + body) is ALWAYS written in English. The agent reviews and edits it in English, and it is automatically translated to \`contact_language\` at send time. Do NOT pre-translate it yourself.
- If the contact is Swedish: also write \`summary_native\` as the Swedish version of the summary (a reading aid for the agent). Otherwise set \`summary_native\` to an empty string "".
- \`summary\` and \`key_takeaways\` are ALWAYS in English regardless.

=== WRENCHLANE PRODUCT KNOWLEDGE (authoritative) ===
${ctx.knowledgeMd}
=== END PRODUCT KNOWLEDGE ===

${NO_LONG_DASH_INSTRUCTION} This applies to every text field, especially the follow-up email subject and body.

Today's date is ${ctx.today}. Call the record_call_analysis tool exactly once with your analysis. Be honest: if the transcript is empty, garbled, or clearly a voicemail/no-answer, reflect that in the outcome and do not fabricate content.`;

  const userParts: string[] = [];
  if (ctx.contactName || ctx.companyName) {
    userParts.push(
      `Contact: ${ctx.contactName ?? "(unknown)"}${ctx.companyName ? ` at ${ctx.companyName}` : ""}`,
    );
  }
  userParts.push("Transcript:\n" + (ctx.transcript || "(no speech detected)"));

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "record_call_analysis" },
      system,
      messages: [{ role: "user", content: userParts.join("\n\n") }],
    });

    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return { ok: false, reason: "model did not return tool output" };
    }
    const analysis = toolUse.input as CallAnalysis;

    // Defensive: ensure the outcome is in our taxonomy.
    if (!CALL_OUTCOMES.includes(analysis.suggested_outcome)) {
      analysis.suggested_outcome = "interested";
    }
    if (typeof analysis.summary_native !== "string") analysis.summary_native = "";
    // Normalize the language code to a 2-letter lowercase ISO; default to the
    // hint (or English) if the model omitted or malformed it.
    const rawLang =
      typeof analysis.contact_language === "string"
        ? analysis.contact_language.slice(0, 2).toLowerCase()
        : "";
    analysis.contact_language =
      rawLang || (ctx.languageHint === "sv" ? "sv" : "en");
    // Strip long dashes from every human-facing text field the CRM will show or
    // send. The suggested follow-up email is the one that gets sent to a contact.
    const email = analysis.suggested_followup_email;
    if (email) {
      if (typeof email.subject === "string") email.subject = stripLongDashes(email.subject);
      if (typeof email.body === "string") email.body = stripLongDashes(email.body);
    }
    if (typeof analysis.summary === "string") analysis.summary = stripLongDashes(analysis.summary);
    if (typeof analysis.summary_native === "string")
      analysis.summary_native = stripLongDashes(analysis.summary_native);
    return { ok: true, analysis, model: MODEL };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "analyzeCall failed" };
  }
}
