// Phone-number normalization for the calling pipeline. Contacts/companies store
// phones in mixed formats: "+358 40 134 0007", "0046…", "358 40 134 0007"
// (international without +), or "070-123 45 67" (national). 46elks requires
// E.164. We handle all of these without defaulting non-Swedish numbers to
// Sweden — a bare "358…" is Finnish, not Swedish.

// ISO 3166 alpha-2 → E.164 country calling code, for the markets in the CRM.
// Used to expand NATIONAL numbers (leading 0) when we know the contact's
// country. Extend as new markets are added.
const CALLING_CODE: Record<string, string> = {
  SE: "46",
  FI: "358",
  NO: "47",
  DK: "45",
  EE: "372",
  LV: "371",
  LT: "370",
  IS: "354",
  DE: "49",
  GB: "44",
  IE: "353",
  NL: "31",
  FR: "33",
  ES: "34",
  IT: "39",
  PT: "351",
  PL: "48",
  CZ: "420",
  SK: "421",
  RS: "381",
  AT: "43",
  CH: "41",
  BE: "32",
};

// All known calling codes, longest-first so we match 358 before 35, 46 before 4.
const KNOWN_CODES = Array.from(new Set(Object.values(CALLING_CODE))).sort(
  (a, b) => b.length - a.length,
);

/**
 * Normalize a raw phone string to E.164.
 *
 * @param raw          the stored phone string
 * @param countryCode  optional ISO alpha-2 hint (e.g. the contact's country_code),
 *                     used to expand a national number (leading 0). Defaults to SE.
 */
export function normalizePhone(
  raw: string | null | undefined,
  countryCode?: string | null,
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Already E.164: keep the leading + and strip separators.
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }

  let digits = s.replace(/\D/g, "");
  if (!digits) return null;

  // "00" international prefix → "+".
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    return digits.length >= 8 ? `+${digits}` : null;
  }

  const hint = countryCode?.trim().toUpperCase();
  const hintCode = hint ? CALLING_CODE[hint] : undefined;

  // National number (leading 0) → strip it and prepend the country calling code
  // (the contact's country when known, otherwise Sweden).
  if (digits.startsWith("0")) {
    const national = digits.slice(1);
    const code = hintCode ?? "46";
    return national.length >= 6 ? `+${code}${national}` : null;
  }

  // No leading 0: the number almost always already carries its country code
  // (e.g. "358 40 134 0007" or "46 70…"). If it starts with a known calling
  // code, treat it as international as-is. Otherwise, if we have a country hint
  // and it doesn't already start with that code, assume it's a national number
  // typed without the trunk 0 and prepend the code.
  if (digits.length < 8) return null;
  if (KNOWN_CODES.some((c) => digits.startsWith(c))) {
    return `+${digits}`;
  }
  if (hintCode && !digits.startsWith(hintCode)) {
    return `+${hintCode}${digits}`;
  }
  // Best effort: assume it's already international.
  return `+${digits}`;
}

/** True when a string can be normalized to a dialable E.164 number. */
export function isDialable(raw: string | null | undefined, countryCode?: string | null): boolean {
  return normalizePhone(raw, countryCode) !== null;
}
