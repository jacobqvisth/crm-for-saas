import { generateText } from "@/lib/ai/provider";
import { TARGET_LANGUAGE_LABELS } from "@/lib/i18n/languages";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";

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
- ${NO_LONG_DASH_INSTRUCTION}
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

  const label = TARGET_LANGUAGE_LABELS[targetLanguage] ?? targetLanguage.toUpperCase();

  const result = await generateText({
    label: "inbox/translate-outbound-text",
    anthropicModel: MODEL,
    system: SYSTEM_PROMPT,
    user: `Translate this English reply to ${label} (ISO code: ${targetLanguage}). Plain text out.\n\n${bodyEn}`,
    maxTokens: 2048,
  });
  if (!result.ok) return { ok: false, reason: `ai error: ${result.reason}` };

  const translated = stripLongDashes(result.text.trim());
  if (!translated) return { ok: false, reason: "empty translation from model" };

  return { ok: true, translated, targetLanguage, model: result.model };
}

const HTML_EMAIL_SYSTEM_PROMPT = `You translate a full B2B outreach email (subject line + HTML body) into the recipient's native language for a SaaS called Wrenchlane.

Rules:
- Translate naturally — native-speaker quality, business-professional tone, not literal.
- Preserve ALL HTML tags, attributes, and structure exactly (e.g. <p>, <a href="...">, <span data-variable="...">). Translate only the human-readable text between tags.
- Preserve every merge placeholder exactly as-is, including the surrounding characters. Placeholders look like {{first_name}}, {{company_name}}, {{first_name_optional}}. Never translate, reword, space, or remove them. Example: "Hi{{first_name_optional}}," → Swedish "Hej{{first_name_optional}},".
- Preserve URLs and email addresses exactly.
- Do not translate the product name "Wrenchlane".
- Do not add, remove, or reorder content. Same structure in, same structure out — only the language changes.
- ${NO_LONG_DASH_INSTRUCTION}
- Return ONLY minified JSON: {"subject":"...","bodyHtml":"..."}. No markdown fences, no commentary.`;

const SUBJECT_ONLY_SYSTEM_PROMPT = `You translate the subject line of a B2B outreach email for a SaaS called Wrenchlane.

Rules:
- Return the subject translated into the requested language, nothing else.
- Do not translate the product name "Wrenchlane". Everything around it MUST be translated.
- Preserve merge placeholders like {{first_name}} exactly as-is.
- ${NO_LONG_DASH_INSTRUCTION}
- Return ONLY the translated subject line. No quotes, no JSON, no commentary.`;

/**
 * Same text once case and surrounding whitespace stop mattering.
 *
 * Used to catch the one failure this translation makes silently: the body
 * comes back in the target language while the subject is handed straight
 * back untouched.
 */
export function sameSubjectText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Second pass over just the subject line.
 *
 * The combined subject + body call occasionally returns a subject that looks
 * enough like a brand tagline ("Wrenchlane - Faster diagnostics") that the
 * model leaves it alone. Asking for the subject on its own, with no body to
 * distract from it, fixes it. Returns null when the retry itself fails, so
 * the caller keeps the first pass rather than losing the translation.
 */
async function retranslateSubject(
  subject: string,
  sourceLabel: string,
  targetLabel: string,
  targetLanguage: string,
): Promise<string | null> {
  const result = await generateText({
    label: "inbox/translate-outbound-subject-retry",
    anthropicModel: MODEL,
    system: SUBJECT_ONLY_SYSTEM_PROMPT,
    user: `Translate this ${sourceLabel} email subject line to ${targetLabel} (ISO code: ${targetLanguage}). It came back untranslated on the first attempt, so translate it now.\n\n${subject}`,
    maxTokens: 256,
  });
  if (!result.ok) return null;

  const cleaned = stripLongDashes(result.text.trim().replace(/^["']|["']$/g, ""));
  return cleaned || null;
}

export type OutboundEmailTranslationResult =
  | {
      ok: true;
      subject: string;
      bodyHtml: string;
      targetLanguage: string;
      model: string;
      /**
       * The subject survived two passes unchanged. Sometimes correct (a
       * subject that is only the product name), usually not. Callers surface
       * it so a human decides rather than shipping an English subject line
       * on a Czech email.
       */
      subjectUntranslated?: boolean;
    }
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

  const label = TARGET_LANGUAGE_LABELS[targetLanguage] ?? targetLanguage.toUpperCase();
  const sourceLabel =
    TARGET_LANGUAGE_LABELS[sourceLanguage] ?? sourceLanguage.toUpperCase();

  const result = await generateText({
    label: "inbox/translate-outbound-email",
    anthropicModel: MODEL,
    system: HTML_EMAIL_SYSTEM_PROMPT,
    user: `Translate this ${sourceLabel} email to ${label} (ISO code: ${targetLanguage}).\n\nSubject: ${subject}\n\nBody (HTML):\n${bodyHtml}`,
    maxTokens: 2048,
  });
  if (!result.ok) return { ok: false, reason: `ai error: ${result.reason}` };

  const cleaned = result.text
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let parsed: { subject?: unknown; bodyHtml?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, reason: "model returned invalid JSON" };
  }

  let outSubject = typeof parsed.subject === "string" ? parsed.subject : "";
  const outBody = typeof parsed.bodyHtml === "string" ? parsed.bodyHtml : "";
  if (!outSubject.trim() && !outBody.trim()) {
    return { ok: false, reason: "empty translation from model" };
  }

  // The body translates and the subject slips through in the source language.
  // Nothing downstream compares the two, so an English subject line rides out
  // on a Czech email until a human notices. Retry the subject alone, and if it
  // still comes back identical, say so rather than pretending it translated.
  let subjectUntranslated = false;
  if (subject.trim() && sameSubjectText(subject, outSubject)) {
    const retried = await retranslateSubject(
      subject,
      sourceLabel,
      label,
      targetLanguage,
    );
    if (retried && !sameSubjectText(subject, retried)) {
      outSubject = retried;
    } else {
      subjectUntranslated = true;
    }
  }

  return {
    ok: true,
    subject: stripLongDashes(outSubject),
    bodyHtml: stripLongDashes(outBody),
    targetLanguage,
    model: result.model,
    subjectUntranslated,
  };
}
