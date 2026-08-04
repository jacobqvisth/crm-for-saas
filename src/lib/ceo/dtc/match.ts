import { parseDtc } from "./parse";

/**
 * Matching a session against a *set* of fault codes.
 *
 * The diagnostics drilldown's free-text `q` filter substring-matches one term at
 * a time, which cannot express "sessions that had both of these codes" — the two
 * codes live in different entries of the same `dtcs` array, so no single
 * substring matches. The `codes=` filter uses the helpers here instead: every
 * listed code must be present, ANDed.
 *
 * Comparison happens on the **base code**, exactly like the DTC Codes page
 * aggregates: a session storing `P029900` matches a filter on `P0299`, and a
 * pair link built from base codes therefore finds the sessions it was counted
 * from.
 */

/**
 * Enough for any combination the DTC Codes page links to (pairs are 2, the
 * longest repeating code set seen is well under this) while keeping a
 * hand-edited URL from turning into an unbounded per-row scan.
 */
const MAX_FILTER_CODES = 8;

/** Separators a `codes=` value may use: comma, whitespace, or a literal `+`. */
const FILTER_SEPARATORS = /[\s,+]+/;

/**
 * The key a raw DTC string is compared on: its SAE base code, or — for
 * manufacturer-hex and native schemes that have no base — the normalized string.
 * Null when there is nothing left after normalizing.
 */
export function dtcMatchKey(raw: string): string | null {
  const parsed = parseDtc(raw);
  const key = parsed.base ?? parsed.normalized;
  return key.length > 0 ? key : null;
}

/**
 * Parse a `codes=` query value into normalized, deduped match keys. Accepts the
 * `P0562,U0416` form the links use and the `P0562 + U0416` form a human might
 * paste. Unparseable fragments are dropped rather than failing the whole filter.
 */
export function parseDtcCodeFilter(raw: string): string[] {
  const codes: string[] = [];
  for (const part of raw.split(FILTER_SEPARATORS)) {
    const key = dtcMatchKey(part);
    if (!key || codes.includes(key)) {
      continue;
    }
    codes.push(key);
    if (codes.length >= MAX_FILTER_CODES) {
      break;
    }
  }
  return codes;
}

/**
 * True when the session's codes cover *every* required code. An empty
 * requirement list matches everything, so callers can pass an unfiltered value
 * through without branching.
 */
export function dtcsMatchAllCodes(
  dtcs: readonly string[],
  required: readonly string[],
): boolean {
  if (required.length === 0) {
    return true;
  }
  const present = new Set<string>();
  for (const raw of dtcs) {
    const key = dtcMatchKey(raw);
    if (key) {
      present.add(key);
    }
  }
  return required.every((code) => present.has(code));
}
