/**
 * Normalization helpers — reused by every scrape pass.
 * All functions are pure and safe to call with null/undefined (return null).
 */

export function normalizedDomain(url) {
  if (!url) return null;
  try {
    let s = url.trim().toLowerCase();
    // Add scheme if missing so URL can parse it
    if (!/^https?:\/\//.test(s)) s = 'https://' + s;
    const u = new URL(s);
    let host = u.hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export function normalizedPhone(phone, countryCode = 'SE') {
  if (!phone) return null;
  // Strip everything except digits and leading +
  let digits = phone.replace(/[^\d]/g, '');
  if (!digits) return null;
  // Swedish numbers: strip leading 0, prepend +46
  if (countryCode === 'SE') {
    if (digits.startsWith('46')) {
      return '+' + digits;
    }
    if (digits.startsWith('0')) {
      return '+46' + digits.slice(1);
    }
    // Already bare number without leading 0
    return '+46' + digits;
  }
  // Generic: just return digits with +
  return '+' + digits;
}

export function normalizedName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/\s+(ab|hb|kb|as|aps|oy|gmbh|ltd|llc|inc)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}
