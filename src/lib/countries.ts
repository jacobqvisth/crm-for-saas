// Country and language metadata for the CRM UI.
//
// Single source of truth for:
//   - flag emoji per ISO-3166-1 alpha-2 country code
//   - country name (English) for display fallback
//   - default language code per country (used by the sequence-duplicate dialog)
//   - language label with a leading flag for the language picker
//
// Keep this list at least as wide as the set of country codes that appear in
// `discovered_shops` and `contacts` so flags don't fall back to 🏳️ in the UI.

export type CountryCode =
  | "EE" | "SE" | "FI" | "NO" | "DK"
  | "LV" | "LT" | "CZ" | "SK" | "RS"
  | "DE" | "FR" | "GB" | "NL" | "PL" | "US" | "IE" | "AU";

export type LanguageCode =
  | "et" | "sv" | "fi" | "no" | "da"
  | "lv" | "lt" | "cs" | "sk" | "sr"
  | "de" | "fr" | "en" | "nl" | "pl";

export const COUNTRY_FLAGS: Record<string, string> = {
  EE: "🇪🇪",
  SE: "🇸🇪",
  FI: "🇫🇮",
  NO: "🇳🇴",
  DK: "🇩🇰",
  LV: "🇱🇻",
  LT: "🇱🇹",
  CZ: "🇨🇿",
  SK: "🇸🇰",
  RS: "🇷🇸",
  DE: "🇩🇪",
  FR: "🇫🇷",
  GB: "🇬🇧",
  NL: "🇳🇱",
  PL: "🇵🇱",
  US: "🇺🇸",
  IE: "🇮🇪",
  AU: "🇦🇺",
};

export const COUNTRY_NAMES: Record<string, string> = {
  EE: "Estonia",
  SE: "Sweden",
  FI: "Finland",
  NO: "Norway",
  DK: "Denmark",
  LV: "Latvia",
  LT: "Lithuania",
  CZ: "Czech Republic",
  SK: "Slovakia",
  RS: "Serbia",
  DE: "Germany",
  FR: "France",
  GB: "United Kingdom",
  NL: "Netherlands",
  PL: "Poland",
  US: "United States",
  IE: "Ireland",
  AU: "Australia",
};

// Default outbound language per country. Used by the sequence-duplicate
// dialog to auto-pick a translation language when a country is chosen.
export const COUNTRY_DEFAULT_LANG: Record<string, LanguageCode> = {
  EE: "et",
  SE: "sv",
  FI: "fi",
  NO: "no",
  DK: "da",
  LV: "lv",
  LT: "lt",
  CZ: "cs",
  SK: "sk",
  RS: "sr",
  DE: "de",
  FR: "fr",
  GB: "en",
  NL: "nl",
  PL: "pl",
  US: "en",
  IE: "en",
  AU: "en",
};

// Countries that the outbound pipeline currently supports (i.e. the CRM has
// — or could have — sequences and contacts in this country). Drives the
// duplicate-sequence dialog's country picker. Sorted by name for display.
export const SUPPORTED_OUTBOUND_COUNTRIES: ReadonlyArray<{
  code: CountryCode;
  name: string;
  defaultLang: LanguageCode;
}> = [
  { code: "CZ", name: "Czech Republic", defaultLang: "cs" },
  { code: "DK", name: "Denmark", defaultLang: "da" },
  { code: "EE", name: "Estonia", defaultLang: "et" },
  { code: "FI", name: "Finland", defaultLang: "fi" },
  { code: "LV", name: "Latvia", defaultLang: "lv" },
  { code: "LT", name: "Lithuania", defaultLang: "lt" },
  { code: "NO", name: "Norway", defaultLang: "no" },
  { code: "RS", name: "Serbia", defaultLang: "sr" },
  { code: "SK", name: "Slovakia", defaultLang: "sk" },
  { code: "SE", name: "Sweden", defaultLang: "sv" },
  { code: "GB", name: "United Kingdom", defaultLang: "en" },
] as const;

// Localized labels with leading flag for the language picker.
export const LANGUAGE_LABELS: Record<string, string> = {
  et: "🇪🇪 Estonian",
  sv: "🇸🇪 Swedish",
  fi: "🇫🇮 Finnish",
  no: "🇳🇴 Norwegian",
  da: "🇩🇰 Danish",
  lv: "🇱🇻 Latvian",
  lt: "🇱🇹 Lithuanian",
  cs: "🇨🇿 Czech",
  sk: "🇸🇰 Slovak",
  sr: "🇷🇸 Serbian",
  de: "🇩🇪 German",
  fr: "🇫🇷 French",
  en: "🇬🇧 English",
  nl: "🇳🇱 Dutch",
  pl: "🇵🇱 Polish",
};

// Languages used in the duplicate-sequence dialog. Order matches
// SUPPORTED_OUTBOUND_COUNTRIES roughly.
export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: LanguageCode; label: string }> = [
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "en", label: "English" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "no", label: "Norwegian" },
  { code: "sr", label: "Serbian" },
  { code: "sk", label: "Slovak" },
  { code: "sv", label: "Swedish" },
] as const;

export function countryFlag(code: string | null | undefined): string {
  if (!code) return "🏳️";
  return COUNTRY_FLAGS[code.toUpperCase()] ?? "🏳️";
}

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}
