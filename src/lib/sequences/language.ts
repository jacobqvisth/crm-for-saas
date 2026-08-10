/**
 * Which language does this contact get for this sequence?
 *
 * Resolved ONCE at enrollment and stored on `sequence_enrollments.language`,
 * never recomputed per step. That pinning matters: the hourly propagator can
 * rewrite `contacts.language` mid-campaign, and a per-step resolution would
 * then send email 1 in English and email 2 in Polish to the same person.
 */

import {
  languageForCountry,
  normalizeLanguage,
} from "@/lib/i18n/languages";

/** The language-related slice of a sequence's `settings` JSON. */
export type SequenceLanguageSettings = {
  /**
   * Languages this campaign has been authored and reviewed in. When empty or
   * absent the sequence is unbounded: whatever language the contact resolves
   * to is recorded as-is. Bounding it is what stops "support every language"
   * from meaning "translate every step 26 times".
   */
  languages?: string[] | null;
  /** Used when the contact's own language isn't one this campaign speaks. */
  default_language?: string | null;
};

export const FALLBACK_LANGUAGE = "en";

/** Normalised, deduped, order-preserving list of a sequence's languages. */
export function sequenceLanguages(
  settings: SequenceLanguageSettings | null | undefined,
): string[] {
  const raw = settings?.languages;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const code = normalizeLanguage(typeof entry === "string" ? entry : null);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** The language this sequence falls back to. Always a concrete code. */
export function defaultLanguage(
  settings: SequenceLanguageSettings | null | undefined,
): string {
  const explicit = normalizeLanguage(settings?.default_language);
  if (explicit) return explicit;
  // An unset default with a bounded language set means the first listed
  // language is the master copy, which is how the step editor presents it.
  const configured = sequenceLanguages(settings);
  return configured[0] ?? FALLBACK_LANGUAGE;
}

export type LanguageResolvable = {
  language?: string | null;
  country_code?: string | null;
};

/**
 * Resolve a contact's language for a sequence.
 *
 * Order:
 *   1. `contacts.language` — set by the app from the UI language the user
 *      actually chose, so it beats any inference. Several Romanian and
 *      Lithuanian app users are legitimately `en`.
 *   2. the country's default written language, for unambiguous countries only
 *   3. the sequence's default language
 *
 * Steps 1 and 2 only win if the sequence actually speaks that language. With
 * no bounded language set, any resolved code is accepted.
 */
export function resolveContactLanguage(
  contact: LanguageResolvable | null | undefined,
  settings: SequenceLanguageSettings | null | undefined,
): string {
  const supported = sequenceLanguages(settings);
  const fallback = defaultLanguage(settings);
  const speaks = (code: string | null): code is string =>
    !!code && (supported.length === 0 || supported.includes(code));

  const explicit = normalizeLanguage(contact?.language);
  if (speaks(explicit)) return explicit;

  const fromCountry = normalizeLanguage(
    languageForCountry(contact?.country_code),
  );
  if (speaks(fromCountry)) return fromCountry;

  return fallback;
}
