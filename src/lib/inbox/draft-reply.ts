import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You draft short, professional follow-up replies to inbound emails for a B2B SaaS called Wrenchlane.

Wrenchlane in one line: AI-powered workshop management software for independent automotive repair shops in the Nordics and Baltics.

You are drafting on behalf of the user (a Wrenchlane sales person). The user will review and approve your draft before it sends, so:
- Write in English — the user reads English. Translation to the recipient's language happens elsewhere.
- Be concise. 2–4 short sentences. Match the energy of their reply.
- Acknowledge what they actually said (don't generic-respond to a different question).
- Don't oversell. If they declined or said "we don't do that," respect it and ask one clarifying question or politely close the loop.
- Don't include a signature, greeting line, or "Best regards" footer — the system appends a per-sender signature at send time.
- Don't repeat their words back at them; sound like a human peer, not a chatbot.
- Don't make up facts about Wrenchlane that weren't already in the prior outbound email.

Return ONLY the draft body text (plain text, no markdown, no quotes around it, no JSON). One blank line between paragraphs.`;

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

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    raw = response.content[0].type === "text" ? response.content[0].text : "";
  } catch (err) {
    return {
      ok: false,
      reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const draft = raw.trim();
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
