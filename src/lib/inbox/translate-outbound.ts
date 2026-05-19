import Anthropic from "@anthropic-ai/sdk";

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

const TARGET_LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  de: "German",
  fr: "French",
  pl: "Polish",
  cs: "Czech",
  ru: "Russian",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
};

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
