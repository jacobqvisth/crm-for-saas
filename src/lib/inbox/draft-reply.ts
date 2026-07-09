import Anthropic from "@anthropic-ai/sdk";
import { WRENCHLANE_KNOWLEDGE } from "./wrenchlane-knowledge";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";

const MODEL = "claude-haiku-4-5-20251001";

function buildSystemPrompt(knowledgeMd: string): string {
  return `You draft short, professional follow-up replies to inbound emails for a B2B SaaS called Wrenchlane.

The user (a Wrenchlane sales person) will review and approve your draft before it sends. Stay grounded in the canonical product knowledge below — do not invent features, pricing, partners, stats, or links that aren't in that document.

=== WRENCHLANE PRODUCT KNOWLEDGE (authoritative) ===
${knowledgeMd}
=== END PRODUCT KNOWLEDGE ===

How to draft:
- Write in English. Translation to the recipient's language happens downstream — don't translate yourself.
- Be concise. 2–4 short sentences. Match the energy of their reply.
- Acknowledge what they actually said (don't generic-respond to a different question).
- Don't oversell. If they declined or scoped themselves out (e.g. "we only work with Subaru"), respect it — one polite acknowledgement and close the loop, or one clarifying question.
- Don't include a signature, greeting line, or "Best regards" closer — a per-sender signature is appended at send time.
- Don't repeat their words back at them; sound like a human peer, not a chatbot.
- ${NO_LONG_DASH_INSTRUCTION}

When (and how) to include a video or article link:
- If — and only if — one of the videos or articles in the knowledge document above directly answers their question, include its URL on its own line in the draft.
- Maximum one link per reply. Prefer a video over an article if both fit.
- Match the recipient's language for video choice (Swedish videos for Swedish speakers; English otherwise). The draft body stays in English regardless — translation happens at send time.
- If nothing maps cleanly, do not include any URL. Don't shoehorn one in.

Return ONLY the draft body text (plain text, no markdown, no quotes around it, no JSON). One blank line between paragraphs. URLs go on their own line, not inline with prose.`;
}

export type DraftContext = {
  contactFirstName: string | null;
  contactLastName: string | null;
  companyName: string | null;
  detectedLanguage: string | null;
  // The user's prior outbound email (the one being replied to). HTML stripped to plain text.
  outboundPriorBody: string | null;
  outboundPriorSubject: string | null;
  // The current inbound reply (English-translated if non-EN; otherwise original).
  inboundBodyEn: string;
  inboundSubject: string | null;
  // Optional richer thread history (last N messages, each with type + body_en).
  threadHistory?: Array<{ from: "us" | "them"; body: string; subject?: string | null }>;
  // Workspace-edited product knowledge. Pass through from loadWrenchlaneKnowledge();
  // defaults to the static seed if omitted.
  knowledgeMd?: string;
};

export type DraftResult =
  | { ok: true; draft: string; model: string }
  | { ok: false; reason: string };

export async function draftReplyInEnglish(ctx: DraftContext): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const client = new Anthropic({ apiKey });

  const lines: string[] = [];

  if (ctx.contactFirstName || ctx.contactLastName || ctx.companyName) {
    lines.push(
      `Recipient: ${[ctx.contactFirstName, ctx.contactLastName].filter(Boolean).join(" ") || "(unknown)"}${
        ctx.companyName ? ` at ${ctx.companyName}` : ""
      }`,
    );
  }
  if (ctx.detectedLanguage) {
    lines.push(`Their reply was in ${ctx.detectedLanguage} (already translated to English for you below).`);
  }

  if (ctx.outboundPriorSubject || ctx.outboundPriorBody) {
    lines.push("");
    lines.push("## Your prior email (the one they're replying to)");
    if (ctx.outboundPriorSubject) lines.push(`Subject: ${ctx.outboundPriorSubject}`);
    if (ctx.outboundPriorBody) {
      lines.push("");
      lines.push(truncate(ctx.outboundPriorBody, 2000));
    }
  }

  if (ctx.threadHistory && ctx.threadHistory.length > 0) {
    lines.push("");
    lines.push("## Recent thread history (oldest first)");
    for (const item of ctx.threadHistory.slice(-5)) {
      lines.push("");
      lines.push(`### ${item.from === "us" ? "You" : "Them"}${item.subject ? ` — ${item.subject}` : ""}`);
      lines.push(truncate(item.body, 1500));
    }
  }

  lines.push("");
  lines.push("## Their latest reply");
  if (ctx.inboundSubject) lines.push(`Subject: ${ctx.inboundSubject}`);
  lines.push("");
  lines.push(truncate(ctx.inboundBodyEn, 4000));
  lines.push("");
  lines.push("Draft your reply now. Body text only — no signature, no greeting closer.");

  const systemPrompt = buildSystemPrompt(ctx.knowledgeMd ?? WRENCHLANE_KNOWLEDGE);

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    raw = response.content[0].type === "text" ? response.content[0].text : "";
  } catch (err) {
    return {
      ok: false,
      reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const draft = stripLongDashes(raw.trim());
  if (!draft) return { ok: false, reason: "empty draft from model" };

  return { ok: true, draft, model: MODEL };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n[…truncated]";
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
