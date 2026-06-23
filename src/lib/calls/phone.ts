// Phone-number normalization for the calling pipeline. Contacts/companies store
// phones in mixed formats (local "070-123 45 67", "0046…", "+46…", or already
// E.164). 46elks requires E.164. We default unknown national numbers to Sweden
// (the user base today is Swedish), but pass through any number already in
// +<country> form untouched.

/**
 * Normalize a raw phone string to E.164, defaulting national numbers to Sweden.
 * Returns null when there aren't enough digits to be a real number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Already E.164-ish: keep the leading + and strip separators.
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }

  // "00" international prefix → "+".
  let digits = s.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    return digits.length >= 8 ? `+${digits}` : null;
  }

  // Swedish national format: leading 0 + 8–9 digits → +46.
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
    return digits.length >= 7 ? `+46${digits}` : null;
  }

  // Bare "46…" already includes the country code.
  if (digits.startsWith("46") && digits.length >= 10) {
    return `+${digits}`;
  }

  // Fallback: assume a Swedish subscriber number.
  return digits.length >= 7 ? `+46${digits}` : null;
}

/** True when a string can be normalized to a dialable E.164 number. */
export function isDialable(raw: string | null | undefined): boolean {
  return normalizePhone(raw) !== null;
}
