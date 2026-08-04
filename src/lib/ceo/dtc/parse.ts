/**
 * Parsing and normalisation of the fault codes technicians type into the
 * WrenchLane app, read from `dashboard_diagnostics.metadata->'dtcs'`.
 *
 * The field is free text, one string per array entry, and prod carries four
 * genuinely different shapes (measured 2026-08-04 over 2,214 non-internal code
 * occurrences):
 *
 *  1. `P0299`   — 1,370 occurrences. The plain 5-character SAE J2012 code.
 *  2. `P029900` — 771 occurrences. The same code plus a 2-hex-digit *failure
 *     type byte* (FTB) appended, as UDS / ISO 14229 scan tools report it.
 *     `P0299` and `P029900` are THE SAME FAULT. Collapsing the FTB is the
 *     single most important thing this module does: without it the top list
 *     splits one fault across two rows and understates it by up to 60%
 *     (P0299 reads 32 uncollapsed, 51 collapsed).
 *  3. `0029D0`  — 73 occurrences. Raw manufacturer hex with no SAE letter at
 *     all, mostly BMW (28 of them) and Mercedes. Not convertible to an SAE
 *     code, so it is kept as its own kind rather than forced into one.
 *  4. Typos and malformed entries — 19 occurrences. Overwhelmingly the letter
 *     `O` typed where a zero belongs (`POO12`, `PO0299`, `POCEE2A`).
 *
 * Repairs are deliberately conservative: only substitutions that cannot be
 * anything else are applied, and every repair is recorded on the result so the
 * page can show the data-quality panel instead of silently laundering input.
 */

/** Failure type byte, e.g. the `92` in `P001792`. */
export type DtcFtb = string;

export type DtcKind =
  /** Plain 5-char SAE code: `P0299`. */
  | "sae"
  /** SAE code + 2-hex failure type byte: `P029900`. */
  | "sae-ftb"
  /** Raw manufacturer hex, no SAE letter: `0029D0`. */
  | "manufacturer-hex"
  /** Manufacturer-native lettered scheme that is not SAE, e.g. Renault `DF175`. */
  | "manufacturer-native"
  /** Could not be read as a fault code at all. */
  | "unparseable";

/**
 * What was wrong with the raw string. Drives the data-quality panel — these
 * are things the app could validate at input time.
 */
export type DtcDefect =
  /** Letter `O` used instead of digit `0`. Hex has no `O`, so this is unambiguous. */
  | "letter-o-for-zero"
  /** Lower-case input, upper-cased. Harmless, tracked for completeness. */
  | "lowercase"
  /** Separators (spaces, dashes, dots, commas) stripped from inside the code. */
  | "separators"
  /** 6 characters with an SAE prefix: a failure type byte cut in half. */
  | "truncated-failure-type"
  /** SAE prefix but the remainder is not readable as a code. */
  | "not-a-code";

export type ParsedDtc = {
  /** Exactly what the technician typed. */
  raw: string;
  /** Upper-cased, separator-stripped, `O`→`0` repaired. */
  normalized: string;
  kind: DtcKind;
  /**
   * The 5-character SAE base code with any failure type byte removed — the key
   * everything on the page aggregates on. Null for manufacturer-hex and
   * unparseable entries.
   */
  base: string | null;
  /** The 2-hex failure type byte, when the scan tool sent one. */
  ftb: DtcFtb | null;
  /** SAE system letter: P powertrain, B body, C chassis, U network. */
  system: "P" | "B" | "C" | "U" | null;
  defects: DtcDefect[];
};

const SAE_BASE = /^[PBCU][0-3][0-9A-F]{3}$/;
const SAE_WITH_FTB = /^[PBCU][0-3][0-9A-F]{3}[0-9A-F]{2}$/;
const RAW_HEX = /^[0-9A-F]{6}$/;
/** Renault/Dacia `DF` codes and the handful of other lettered native schemes. */
const MANUFACTURER_NATIVE = /^(DF|DTC|SPN|FMI)[0-9]{2,5}$/;
const SEPARATORS = /[\s._:,;/\\-]+/g;

/**
 * SAE J2012 reserves the second character for the code's "scope": 0 and 2 are
 * generic (defined by the standard, same meaning on every vehicle), 1 and 3 are
 * manufacturer-specific. Anything outside 0-3 is not a valid SAE code, which is
 * why the regexes above use `[0-3]` rather than `[0-9]`.
 */
export function isValidSaeSecondChar(char: string) {
  return char === "0" || char === "1" || char === "2" || char === "3";
}

export function parseDtc(raw: string): ParsedDtc {
  const defects: DtcDefect[] = [];
  const trimmed = raw.trim();

  let working = trimmed;

  const upper = working.toUpperCase();
  if (upper !== working) {
    defects.push("lowercase");
  }
  working = upper;

  const deseparated = working.replace(SEPARATORS, "");
  if (deseparated !== working) {
    defects.push("separators");
  }
  working = deseparated;

  // The letter O is not a hex digit, so an O anywhere after the leading system
  // letter can only ever be a mistyped zero. Repairing it recovers real codes
  // (`POO12` -> `P0012`) without any guesswork. Applied only when the string
  // actually starts with an SAE system letter, so manufacturer-native schemes
  // that legitimately contain O are left alone.
  if (/^[PBCU]/.test(working) && working.slice(1).includes("O")) {
    working = working[0] + working.slice(1).replaceAll("O", "0");
    defects.push("letter-o-for-zero");
  }

  const normalized = working;

  const base = (value: string) => value.slice(0, 5);
  const systemOf = (value: string) => value[0] as "P" | "B" | "C" | "U";

  if (SAE_BASE.test(normalized)) {
    return {
      raw: trimmed,
      normalized,
      kind: "sae",
      base: normalized,
      ftb: null,
      system: systemOf(normalized),
      defects,
    };
  }

  if (SAE_WITH_FTB.test(normalized)) {
    return {
      raw: trimmed,
      normalized,
      kind: "sae-ftb",
      base: base(normalized),
      ftb: normalized.slice(5, 7),
      system: systemOf(normalized),
      defects,
    };
  }

  // 6 characters with a valid 5-character SAE code in front: a failure type
  // byte that lost a digit somewhere between the scan tool and the text field
  // (`P02990`, `P01006`). The base code is still trustworthy, so recover it and
  // drop the half-byte rather than throwing the whole entry away.
  if (
    normalized.length === 6 &&
    /^[PBCU]/.test(normalized) &&
    SAE_BASE.test(base(normalized))
  ) {
    return {
      raw: trimmed,
      normalized,
      kind: "sae",
      base: base(normalized),
      ftb: null,
      system: systemOf(normalized),
      defects: [...defects, "truncated-failure-type"],
    };
  }

  if (RAW_HEX.test(normalized)) {
    return {
      raw: trimmed,
      normalized,
      kind: "manufacturer-hex",
      base: null,
      ftb: null,
      system: null,
      defects,
    };
  }

  if (MANUFACTURER_NATIVE.test(normalized)) {
    return {
      raw: trimmed,
      normalized,
      kind: "manufacturer-native",
      base: null,
      ftb: null,
      system: null,
      defects,
    };
  }

  return {
    raw: trimmed,
    normalized,
    kind: "unparseable",
    base: null,
    ftb: null,
    system: null,
    defects: [
      ...defects,
      ...(/^[PBCU]/.test(normalized) ? (["not-a-code"] as DtcDefect[]) : []),
    ],
  };
}

/** Parses every entry, dropping blanks. Order is preserved. */
export function parseDtcList(values: readonly string[]): ParsedDtc[] {
  return values
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0)
    .map((value) => parseDtc(value));
}

/**
 * The numeric value of a base code's 4-character suffix, for range tests.
 *
 * Reading the suffix as hex is safe: the second character is restricted to 0-3
 * and the rest are hex digits, so hex ordering matches the ordering SAE range
 * definitions assume (`P0299` = 0x0299 = 665 sorts before `P0300` = 0x0300 =
 * 768).
 */
export function baseCodeValue(base: string): number {
  return Number.parseInt(base.slice(1), 16);
}

/**
 * Whether a base code is generic (defined by SAE J2012 and identical on every
 * make) or manufacturer-specific. Only the generic ones can carry a
 * standardised description, which is why the page never invents names for the
 * manufacturer-specific ranges.
 */
export function baseCodeScope(base: string): "generic" | "manufacturer" {
  const second = base[1];
  return second === "0" || second === "2" ? "generic" : "manufacturer";
}
