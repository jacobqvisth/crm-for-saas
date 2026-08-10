/**
 * Language labels, normalisation, and picker ordering, shared by client and
 * server.
 *
 * Kept dependency-free (no Anthropic SDK / server imports) so client
 * components can import LANGUAGE_OPTIONS without bundling server-only code.
 */

export const TARGET_LANGUAGE_LABELS: Record<string, string> = {
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
  sk: "Slovak",
  hu: "Hungarian",
  ro: "Romanian",
  bg: "Bulgarian",
  uk: "Ukrainian",
  ru: "Russian",
  tr: "Turkish",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
  ar: "Arabic",
  fa: "Persian",
  zh: "Chinese",
};

/**
 * Languages written right to left. Bodies in these need `dir="rtl"` on the
 * wrapper to render correctly in a mail client.
 */
export const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

/**
 * Codes that mean the same language as one we already label. Contacts synced
 * from the app carry `nb` (Norwegian Bokmal) while our label map is keyed on
 * `no`, so without this every Norwegian falls through to the default language.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  nb: "no",
  nn: "no",
  iw: "he",
  in: "id",
  ji: "yi",
};

/**
 * Reduce any incoming language tag to the bare code we key on.
 *
 * Handles case (`SV`), region suffixes in either separator (`sv-SE`, `en_US`),
 * surrounding whitespace, and the aliases above. Returns null for anything
 * empty so callers can fall through to their own default rather than matching
 * on an empty string.
 */
export function normalizeLanguage(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const bare = code.trim().toLowerCase().split(/[-_]/)[0];
  if (!bare) return null;
  return LANGUAGE_ALIASES[bare] ?? bare;
}

/** True when we can actually author and translate copy in this language. */
export function isSupportedLanguage(code: string | null | undefined): boolean {
  const normalized = normalizeLanguage(code);
  return !!normalized && normalized in TARGET_LANGUAGE_LABELS;
}

export function languageLabel(code: string | null | undefined): string {
  const normalized = normalizeLanguage(code);
  if (!normalized) return "English";
  return TARGET_LANGUAGE_LABELS[normalized] ?? normalized.toUpperCase();
}

/**
 * Language codes in display order for pickers: English first, then the Nordic /
 * Baltic markets Wrenchlane sells into, then the rest alphabetically by label.
 */
export const LANGUAGE_OPTIONS: { code: string; label: string }[] = (() => {
  const priority = ["en", "sv", "no", "da", "fi", "et", "lv", "lt"];
  const rest = Object.keys(TARGET_LANGUAGE_LABELS)
    .filter((c) => !priority.includes(c))
    .sort((a, b) => TARGET_LANGUAGE_LABELS[a].localeCompare(TARGET_LANGUAGE_LABELS[b]));
  return [...priority, ...rest].map((code) => ({
    code,
    label: TARGET_LANGUAGE_LABELS[code],
  }));
})();

/**
 * Default written language per country, used only when a contact has no
 * `language` of its own.
 *
 * Deliberately conservative: countries with no single obvious business
 * language are omitted rather than guessed. Belgium (nl/fr), Switzerland
 * (de/fr/it), Cyprus (el/en) and Canada (en/fr) are absent on purpose, and
 * Finland maps to `fi` knowing a Swedish-speaking minority exists. In practice
 * the app-sourced `contacts.language` covers those cases correctly, and it
 * always wins over this map.
 */
export const COUNTRY_DEFAULT_LANGUAGE: Record<string, string> = {
  SE: "sv",
  NO: "no",
  DK: "da",
  FI: "fi",
  IS: "en",
  EE: "et",
  LV: "lv",
  LT: "lt",
  PL: "pl",
  CZ: "cs",
  SK: "sk",
  HU: "hu",
  RO: "ro",
  BG: "bg",
  UA: "uk",
  DE: "de",
  AT: "de",
  FR: "fr",
  NL: "nl",
  ES: "es",
  IT: "it",
  PT: "pt",
  TR: "tr",
  GB: "en",
  IE: "en",
  US: "en",
  AU: "en",
  NZ: "en",
};

/** Default language for a country code, or null when we would be guessing. */
export function languageForCountry(
  countryCode: string | null | undefined,
): string | null {
  if (!countryCode) return null;
  return COUNTRY_DEFAULT_LANGUAGE[countryCode.trim().toUpperCase()] ?? null;
}
