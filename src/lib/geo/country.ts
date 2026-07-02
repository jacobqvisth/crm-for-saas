// Small country helpers shared by the contact/company profiles so the
// Country (name), Country Code (ISO alpha-2), and Language fields stay in sync.

// ISO alpha-2 → our 2-letter `language` locale code (the values used by
// contacts.language / sequence variants). Only the markets we operate in;
// extend as needed.
const ISO_TO_LANGUAGE: Record<string, string> = {
  SE: "sv",
  FI: "fi",
  NO: "no",
  DK: "da",
  EE: "et",
  LV: "lv",
  LT: "lt",
  IS: "is",
  DE: "de",
  AT: "de",
  CH: "de",
  GB: "en",
  IE: "en",
  US: "en",
  NL: "nl",
  BE: "fr",
  FR: "fr",
  ES: "es",
  IT: "it",
  PT: "pt",
  PL: "pl",
  CZ: "cs",
  SK: "sk",
  RS: "sr",
};

let displayNames: Intl.DisplayNames | null = null;
function regionNames(): Intl.DisplayNames | null {
  if (displayNames) return displayNames;
  try {
    displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    displayNames = null;
  }
  return displayNames;
}

/** "FI" → "Finland". Returns null if it can't resolve. */
export function countryNameFromIso(iso: string | null | undefined): string | null {
  const code = iso?.trim().toUpperCase();
  if (!code || code.length !== 2) return null;
  const name = regionNames()?.of(code);
  return name && name !== code ? name : null;
}

/** "FI" → "fi" (our locale code), or null when unknown. */
export function languageFromIso(iso: string | null | undefined): string | null {
  const code = iso?.trim().toUpperCase();
  return code ? (ISO_TO_LANGUAGE[code] ?? null) : null;
}

/** Best-effort reverse: "Finland" → "FI". Scans the known markets only. */
export function isoFromCountryName(name: string | null | undefined): string | null {
  const n = name?.trim().toLowerCase();
  if (!n) return null;
  for (const iso of Object.keys(ISO_TO_LANGUAGE)) {
    if (countryNameFromIso(iso)?.toLowerCase() === n) return iso;
  }
  return null;
}
