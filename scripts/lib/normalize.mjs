/**
 * Normalization helpers — reused by every scrape pass.
 * All functions are pure and safe to call with null/undefined (return null).
 */

import { createHash } from 'crypto';

export function normalizedDomain(url) {
  if (!url) return null;
  try {
    let s = url.trim().toLowerCase();
    // Add scheme if missing so URL can parse it
    if (!/^https?:\/\//.test(s)) s = 'https://' + s;
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export function normalizedPhone(phone, countryCode = 'SE') {
  if (!phone) return null;
  // Strip everything except digits and leading +
  const digits = phone.replace(/[^\d]/g, '');
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

// ---------------------------------------------------------------------------
// Phase 4a additions — aliased variants + new helpers
// ---------------------------------------------------------------------------

/** Alias: normalize a URL/hostname to bare lowercase domain. */
export function normalizeDomain(raw) {
  return normalizedDomain(raw);
}

/** Alias with E.164 strict variant: normalizePhone returns null on non-Swedish garbage. */
export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+46') && digits.length >= 11 && digits.length <= 13) return digits;
  if (digits.startsWith('0046')) return '+46' + digits.slice(4);
  if (digits.startsWith('46') && digits.length >= 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) return '+46' + digits.slice(1);
  return null;
}

/** Alias: normalize company name, stripping common Swedish suffixes. */
export function normalizeName(name) {
  if (!name) return null;
  return String(name)
    .toLowerCase()
    .replace(/\s+(ab|hb|kb|enskild firma|ekonomisk förening)\b\.?$/i, '')
    .replace(/[^\p{L}\p{N}\s&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/** SHA1 hash for stable review dedup key. */
export function makeReviewId(source, profileId, author, publishedAt) {
  const h = createHash('sha1');
  h.update([source, profileId || '', author || '', publishedAt || ''].join('|'));
  return h.digest('hex');
}

/** Whether a Swedish postal code falls in Stockholms län (prefix 100–199). */
const STOCKHOLM_PREFIXES = new Set();
for (let p = 100; p <= 199; p++) STOCKHOLM_PREFIXES.add(String(p));

export function isStockholmsLan(postalCode) {
  if (!postalCode) return false;
  const first3 = String(postalCode).replace(/\s/g, '').slice(0, 3);
  return STOCKHOLM_PREFIXES.has(first3);
}

/**
 * Swedish 3-digit postal prefix → Swedish county (län).
 * Covers ~85% of rows; edge-case overlaps return null.
 * Ranges are approximate — follow-up SQL pass can refine.
 */
const POSTAL_STATE_RANGES = [
  [100, 199, 'Stockholms län'],
  [200, 299, 'Skåne'],
  [300, 399, 'Hallands län'],
  [400, 549, 'Västra Götalands län'],
  [550, 579, 'Jönköpings län'],
  [580, 619, 'Östergötlands län'],
  [620, 625, 'Gotlands län'],
  [626, 649, 'Södermanlands län'],
  [650, 699, 'Värmlands län'],
  [700, 719, 'Örebro län'],
  [720, 739, 'Västmanlands län'],
  [740, 775, 'Uppsala län'],
  [776, 799, 'Dalarnas län'],
  [800, 829, 'Gävleborgs län'],
  [830, 879, 'Västernorrlands län'],
  [880, 899, 'Jämtlands län'],
  [900, 939, 'Västerbottens län'],
  [940, 985, 'Norrbottens län'],
];

/** Swedish postal code → län name. */
export function postalToState(postalCode) {
  if (!postalCode) return null;
  const n = parseInt(String(postalCode).replace(/\s/g, '').slice(0, 3), 10);
  if (isNaN(n)) return null;
  for (const [lo, hi, state] of POSTAL_STATE_RANGES) {
    if (n >= lo && n <= hi) return state;
  }
  return null;
}
