import { generateText } from "@/lib/ai/provider";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You translate inbound business emails to English for a B2B CRM inbox.
Rules:
- First, detect the source language. Output its ISO 639-1 code (en, sv, lv, lt, et, fi, da, no, de, pl, ru, …).
- If the source language is English, do NOT translate — return the language code only and leave subject/body fields empty strings.
- If the source language is NOT English: translate naturally to English (native-speaker quality, professional business tone, not literal).
- PRESERVE all HTML tags in the body (<p>, <a>, <br>, <div>, <span>, blockquote, etc.) exactly as in the source.
- PRESERVE URLs and email addresses exactly.
- PRESERVE quoted-reply blocks (the part with "On ... wrote:" / "<blockquote>") — translate the prose inside them, keep the structure.
- Translate the subject too unless source is English.
- Return ONLY valid JSON in this exact shape — no markdown fences, no commentary:
{"language": "lv", "subject_en": "...", "body_en": "..."}`;

export type TranslationResult =
  | {
      ok: true;
      language: string;
      subjectEn: string | null;
      bodyHtmlEn: string | null;
      model: string;
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Detect language and translate an inbound email to English in one Claude call.
 *
 * Returns ok=true even for English (with subjectEn/bodyHtmlEn = null), so the
 * caller can write `detected_language` once and short-circuit any UI-side
 * "Show English" affordances for English-native rows.
 */
export async function translateInboundMessage(input: {
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
}): Promise<TranslationResult> {
  // Need at least some content to work with.
  const subject = input.subject?.trim() ?? "";
  const bodyHtml = input.bodyHtml?.trim() ?? "";
  const bodyText = input.bodyText?.trim() ?? "";
  if (!subject && !bodyHtml && !bodyText) {
    return { ok: false, reason: "empty message" };
  }

  // Prefer HTML body (preserves formatting), fall back to text wrapped in <p>.
  // Cap input size: bodies larger than this are almost always Microsoft 365
  // NDRs / Office365 HTML boilerplate (40 KB+ wrappers around a single
  // "couldn't be delivered" line), and they're already English anyway. Trying
  // to translate them just busts max_tokens and returns truncated JSON.
  const MAX_BODY_CHARS = 15_000;
  let bodyForModel = bodyHtml || `<p>${escapeHtml(bodyText)}</p>`;
  let truncated = false;
  if (bodyForModel.length > MAX_BODY_CHARS) {
    bodyForModel = bodyForModel.slice(0, MAX_BODY_CHARS) + "\n<!-- truncated for translation -->";
    truncated = true;
  }
  void truncated; // for future telemetry; the translation still proceeds

  const result = await generateText({
    label: "inbox/translate-inbound",
    anthropicModel: MODEL,
    system: SYSTEM_PROMPT,
    user: `Subject: ${subject || "(no subject)"}

Body (HTML):
${bodyForModel}`,
    // 8192 gives ~2x headroom over realistic email lengths. 4096 truncated
    // long Latvian replies mid-JSON during the historic backfill.
    maxTokens: 8192,
  });
  if (!result.ok) return { ok: false, reason: `ai error: ${result.reason}` };

  // The model that actually served this, which may be the Gemini fallback.
  const servedModel = result.model;

  const cleaned = result.text
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let parsed: { language?: unknown; subject_en?: unknown; body_en?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, reason: "invalid JSON from model" };
  }

  const language = normalizeLang(parsed.language);
  if (!language) {
    return { ok: false, reason: "missing or invalid language in response" };
  }

  // English: model leaves subject/body blank; we store NULL.
  if (language === "en") {
    return {
      ok: true,
      language: "en",
      subjectEn: null,
      bodyHtmlEn: null,
      model: servedModel,
    };
  }

  const subjectEn = typeof parsed.subject_en === "string" && parsed.subject_en.trim()
    ? parsed.subject_en
    : null;
  const bodyHtmlEn = typeof parsed.body_en === "string" && parsed.body_en.trim()
    ? parsed.body_en
    : null;

  return {
    ok: true,
    language,
    subjectEn,
    bodyHtmlEn,
    model: servedModel,
  };
}

function normalizeLang(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().toLowerCase();
  // Accept 2-letter ISO codes and a few common 3-letter forms.
  if (/^[a-z]{2}$/.test(trimmed)) return trimmed;
  if (trimmed === "lav") return "lv";
  if (trimmed === "lit") return "lt";
  if (trimmed === "est") return "et";
  if (trimmed === "swe") return "sv";
  if (trimmed === "fin") return "fi";
  if (trimmed === "dan") return "da";
  if (trimmed === "nor") return "no";
  if (trimmed === "eng") return "en";
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
