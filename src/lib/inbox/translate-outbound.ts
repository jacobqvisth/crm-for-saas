import Anthropic from "@anthropic-ai/sdk";
import { TARGET_LANGUAGE_LABELS } from "@/lib/i18n/languages";

export { TARGET_LANGUAGE_LABELS, LANGUAGE_OPTIONS } from "@/lib/i18n/languages";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You translate short, professional business email replies from English to the recipient's native language for a B2B SaaS called Wrenchlane.

Rules:
- Output is plain text (no HTML, no markdown).
- Translate naturally — native-speaker quality, business-professional tone, not literal.
- Preserve paragraph breaks (blank lines between paragraphs).
- Preserve URLs and email addresses exactly.
- Do not translate the product name "Wrenchlane".
- Do not add a signature, greeting closer, or boilerplate. Whatever the user wrote in English is what gets translated — nothing more.
- Return ONLY the translated text. No markdown fences, no quotes around it, no commentary.`;

export type OutboundTranslationResult =
  | { ok: true; translated: string; targetLanguage: string; model: string }
  | { ok: false; reason: string };

/**
 * Translate an English business reply to the recipient's language.
 *
 * Returns the translated plain-text body. Caller HTML-wraps before sending.
 * No-ops to identity when targetLanguage is 'en'.
 */
export async function translateOutboundReply(input: {
  bodyEn: string;
  targetLanguage: string;
}): Promise<OutboundTranslationResult> {
  const targetLanguage = input.targetLanguage.toLowerCase();
  const bodyEn = input.bodyEn.trim();

  if (!bodyEn) return { ok: false, reason: "empty body" };

  // Already English — no translation needed.
  if (targetLanguage === "en") {
    return { ok: true, translated: bodyEn, targetLanguage: "en", model: "identity" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const label = TARGET_LANGUAGE_LABELS[targetLanguage] ?? targetLanguage.toUpperCase();
  const client = new Anthropic({ apiKey });

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Translate this English reply to ${label} (ISO code: ${targetLanguage}). Plain text out.\n\n${bodyEn}`,
        },
      ],
    });
    raw = response.content[0].type === "text" ? response.content[0].text : "";
  } catch (err) {
    return {
      ok: false,
      reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const translated = raw.trim();
  if (!translated) return { ok: false, reason: "empty translation from model" };

  return { ok: true, translated, targetLanguage, model: MODEL };
}

const HTML_EMAIL_SYSTEM_PROMPT = `You translate a full B2B outreach email (subject line + HTML body) into the recipient's native language for a SaaS called Wrenchlane.

Rules:
- Translate naturally — native-speaker quality, business-professional tone, not literal.
- Preserve ALL HTML tags, attributes, and structure exactly (e.g. <p>, <a href="...">, <span data-variable="...">). Translate only the human-readable text between tags.
- Preserve every merge placeholder exactly as-is, including the surrounding characters. Placeholders look like {{first_name}}, {{company_name}}, {{first_name_optional}}. Never translate, reword, space, or remove them. Example: "Hi{{first_name_optional}}," → Swedish "Hej{{first_name_optional}},".
- Preserve URLs and email addresses exactly.
- Do not translate the product name "Wrenchlane".
- Do not add, remove, or reorder content. Same structure in, same structure out — only the language changes.
- Return ONLY minified JSON: {"subject":"...","bodyHtml":"..."}. No markdown fences, no commentary.`;

export type OutboundEmailTranslationResult =
  | { ok: true; subject: string; bodyHtml: string; targetLanguage: string; model: string }
  | { ok: false; reason: string };

/**
 * Translate a composed outreach email (subject + HTML body) to the recipient's
 * language, preserving HTML tags and {{merge}} placeholders so the existing
 * variable-resolution + tracking pipeline still works on the translated output.
 *
 * The draft may be authored in any language (sourceLanguage, default 'en' —
 * e.g. a rep composing in Swedish). No-ops to identity when the target matches
 * the source.
 */
export async function translateOutboundEmail(input: {
  subject: string;
  bodyHtml: string;
  targetLanguage: string;
  sourceLanguage?: string;
}): Promise<OutboundEmailTranslationResult> {
  const targetLanguage = input.targetLanguage.toLowerCase();
  const sourceLanguage = (input.sourceLanguage ?? "en").toLowerCase();
  const subject = input.subject ?? "";
  const bodyHtml = input.bodyHtml ?? "";

  if (!subject.trim() && !bodyHtml.trim()) {
    return { ok: false, reason: "empty email" };
  }

  // Already in the target language — no translation needed.
  if (targetLanguage === sourceLanguage) {
    return { ok: true, subject, bodyHtml, targetLanguage, model: "identity" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const label = TARGET_LANGUAGE_LABELS[targetLanguage] ?? targetLanguage.toUpperCase();
  const sourceLabel =
    TARGET_LANGUAGE_LABELS[sourceLanguage] ?? sourceLanguage.toUpperCase();
  const client = new Anthropic({ apiKey });

  let raw = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: HTML_EMAIL_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Translate this ${sourceLabel} email to ${label} (ISO code: ${targetLanguage}).\n\nSubject: ${subject}\n\nBody (HTML):\n${bodyHtml}`,
        },
      ],
    });
    raw = response.content[0].type === "text" ? response.content[0].text : "";
  } catch (err) {
    return {
      ok: false,
      reason: `anthropic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const cleaned = raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let parsed: { subject?: unknown; bodyHtml?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, reason: "model returned invalid JSON" };
  }

  const outSubject = typeof parsed.subject === "string" ? parsed.subject : "";
  const outBody = typeof parsed.bodyHtml === "string" ? parsed.bodyHtml : "";
  if (!outSubject.trim() && !outBody.trim()) {
    return { ok: false, reason: "empty translation from model" };
  }

  return {
    ok: true,
    subject: outSubject,
    bodyHtml: outBody,
    targetLanguage,
    model: MODEL,
  };
}
