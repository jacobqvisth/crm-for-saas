/**
 * Analysis of the fault codes technicians enter when starting a diagnosis.
 *
 * Pure: takes the already-loaded diagnostics list and returns everything the
 * page renders. No I/O, so it is fully unit-testable and adds no queries — it
 * reads the same `getDiagnosticsDrilldownList` output the Diagnostics drilldown
 * and Search Terms pages already use, which is where internal-test users
 * (@wrenchlane.com and @codeoc.ai, flagged on `dashboard_users.is_internal_test`)
 * are excluded.
 *
 * Everything aggregates on the **base code** — the 5-character SAE code with any
 * failure type byte stripped. See `parse.ts` for why that matters.
 */

import type { DiagnosticListItem } from "@/lib/ceo/data/diagnostics";
import { codeName, dictionarySize } from "./dictionary";
import {
  baseCodeScope,
  parseDtcList,
  type DtcDefect,
  type ParsedDtc,
} from "./parse";
import {
  classifyFamily,
  DTC_FAMILY_ORDER,
  DTC_SYSTEMS,
  ftbFamily,
  ftbName,
  powertrainSubsystem,
  UNCLASSIFIED_FAMILY,
  type DtcSystemKey,
} from "./taxonomy";

/* ------------------------------------------------------------------- types */

export type DtcExample = {
  diagnosticId: string;
  car: string | null;
  country: string | null;
  description: string | null;
  createdAt: string | null;
};

export type DtcCodeRow = {
  base: string;
  name: string | null;
  scope: "generic" | "manufacturer";
  familyKey: string;
  familyLabel: string;
  /** Total times the code was entered, counting repeats within one session once per session. */
  entries: number;
  /** Share of code-carrying diagnostics that included this code. */
  share: number;
  distinctWorkshops: number;
  topMake: string | null;
  topMakeEntries: number;
  /** Raw strings seen for this base code, e.g. `P0299` and `P029900`. */
  rawVariants: string[];
  ftbs: string[];
  /** Share of this code's diagnostics that opened a follow-up chat. */
  chatRate: number;
  avgCauses: number;
  /** Share of this code's diagnostics that had no description text at all. */
  codeOnlyShare: number;
  firstSeen: string | null;
  lastSeen: string | null;
  examples: DtcExample[];
};

export type DtcPairRow = {
  a: string;
  b: string;
  aName: string | null;
  bName: string | null;
  /** Diagnostics containing both codes. */
  together: number;
  aTotal: number;
  bTotal: number;
  /**
   * How much more often the two appear together than independent chance would
   * predict. 1.0 means no association; 10 means ten times more often.
   */
  lift: number;
  /** When the rarer of the two appears, how often the other is present too. */
  confidence: number;
  sameFamily: boolean;
};

export type DtcSetRow = {
  codes: string[];
  count: number;
  familyLabels: string[];
  topMake: string | null;
};

export type DtcGroupRow = {
  key: string;
  label: string;
  hint: string;
  /** Distinct diagnostics with at least one code in this group. */
  entries: number;
  /** Code instances in this group. */
  occurrences: number;
  share: number;
  distinctCodes: number;
  topCode: string | null;
  topCodeName: string | null;
  topCodeEntries: number;
};

export type DtcFtbRow = {
  ftb: string;
  name: string | null;
  familyKey: string;
  familyLabel: string;
  occurrences: number;
  share: number;
  topCode: string | null;
};

export type DtcMakeRow = {
  make: string;
  entries: number;
  codeOccurrences: number;
  avgCodesPerEntry: number;
  /** Share of this make's codes that arrived with a failure type byte attached. */
  ftbShare: number;
  topCode: string | null;
  topCodeName: string | null;
  topCodeEntries: number;
  topFamilyLabel: string | null;
};

export type DtcCountBand = {
  key: string;
  label: string;
  hint: string;
  entries: number;
  share: number;
  /** Share of the band that also wrote description text. */
  withTextShare: number;
  chatRate: number;
  avgCauses: number;
};

export type DtcMonthlyPoint = {
  month: string;
  diagnostics: number;
  withCodes: number;
  coverage: number;
  codeOccurrences: number;
  avgCodesPerCodedEntry: number;
};

export type DtcTrendRow = {
  base: string;
  name: string | null;
  familyLabel: string;
  recent: number;
  prior: number;
  delta: number;
  isNew: boolean;
};

export type DtcSpreadRow = {
  base: string;
  name: string | null;
  entries: number;
  distinctWorkshops: number;
  /** Share of this code's entries that came from its single busiest workshop. */
  topWorkshopShare: number;
  topWorkshopName: string | null;
};

export type DtcDefectRow = {
  defect: DtcDefect;
  label: string;
  hint: string;
  occurrences: number;
  examples: { raw: string; normalized: string }[];
};

export type DtcOddityRow = {
  raw: string;
  count: number;
  makes: string[];
};

export type DtcCountryRow = {
  country: string;
  entries: number;
  codeOccurrences: number;
  topCode: string | null;
  topCodeName: string | null;
  topFamilyLabel: string | null;
};

export type DtcAnalysis = {
  totals: {
    diagnostics: number;
    withCodes: number;
    coverage: number;
    /** Code instances after de-duplicating repeats inside one session. */
    codeOccurrences: number;
    /** Raw array entries before de-duplication, including unreadable ones. */
    rawEntries: number;
    distinctBaseCodes: number;
    avgCodesPerEntry: number;
    multiCodeEntries: number;
    multiCodeShare: number;
    codeOnlyEntries: number;
    codeOnlyShare: number;
    withFtb: number;
    ftbShare: number;
    genericShare: number;
    namedShare: number;
    dictionarySize: number;
    /**
     * Diagnostics that typed something into the code field but where nothing
     * resolved to an SAE code — either a typo, or manufacturer-native hex that
     * has no SAE equivalent. These have codes as far as the user is concerned
     * but contribute nothing to any code aggregate on the page.
     */
    noSaeCodeEntries: number;
    /** Individual strings that could not be read as a fault code at all. */
    unparseableOccurrences: number;
    /** Individual strings that are valid manufacturer-native codes, not SAE. */
    manufacturerCodeOccurrences: number;
    latestDiagnosticAt: string | null;
    earliestDiagnosticAt: string | null;
  };
  topCodes: DtcCodeRow[];
  hardestCodes: DtcCodeRow[];
  pairs: DtcPairRow[];
  sets: DtcSetRow[];
  families: DtcGroupRow[];
  systems: DtcGroupRow[];
  subsystems: DtcGroupRow[];
  /** Generic (standardised) versus manufacturer-specific code split. */
  scopes: DtcGroupRow[];
  ftbs: DtcFtbRow[];
  ftbFamilies: DtcGroupRow[];
  makes: DtcMakeRow[];
  countries: DtcCountryRow[];
  countBands: DtcCountBand[];
  monthly: DtcMonthlyPoint[];
  rising: DtcTrendRow[];
  fading: DtcTrendRow[];
  trendWindowDays: number;
  widestSpread: DtcSpreadRow[];
  mostConcentrated: DtcSpreadRow[];
  defects: DtcDefectRow[];
  unparseable: DtcOddityRow[];
  manufacturerHex: DtcOddityRow[];
  unclassified: DtcCodeRow[];
};

/* --------------------------------------------------------------- utilities */

/**
 * Make names arrive in whatever case the app captured — prod has `VOLVO`,
 * `Volvo`, `MERCEDES-BENZ`, `Mercedes-Benz` and `MERCEDES` as five separate
 * strings for three manufacturers. Without collapsing them the per-make table
 * splits one brand across several rows and understates all of them.
 */
const MAKE_ALIASES: Record<string, string> = {
  MERCEDES: "Mercedes-Benz",
  "MERCEDES BENZ": "Mercedes-Benz",
  "MERCEDES-BENZ": "Mercedes-Benz",
  MB: "Mercedes-Benz",
  VW: "Volkswagen",
  LANDROVER: "Land Rover",
  "LAND ROVER": "Land Rover",
  "RANGE ROVER": "Land Rover",
  CHEVY: "Chevrolet",
  "ALFA ROMEO": "Alfa Romeo",
  VAG: "Volkswagen",
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) =>
      /^[a-zà-ÿ]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part,
    )
    .join("");
}

function normalizeMake(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (upper.length === 0) return null;
  const aliased = MAKE_ALIASES[upper];
  if (aliased) return aliased;
  // Brands that are genuinely acronyms stay upper-case; everything else reads
  // better title-cased than shouted.
  if (upper.length <= 3) return upper;
  return titleCase(upper);
}

function carLabel(item: DiagnosticListItem) {
  const parts = [normalizeMake(item.carMake), item.carModel, item.carYear]
    .filter(Boolean)
    .map((part) => String(part));
  return parts.length > 0 ? parts.join(" ") : null;
}

function topOf(counts: Map<string, number>): { key: string; n: number } | null {
  let best: { key: string; n: number } | null = null;
  for (const [key, n] of counts) {
    if (!best || n > best.n || (n === best.n && key < best.key)) {
      best = { key, n };
    }
  }
  return best;
}

function bump<K>(map: Map<K, number>, key: K, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function safeDiv(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

const DEFECT_LABELS: Record<DtcDefect, { label: string; hint: string }> = {
  "letter-o-for-zero": {
    label: "Letter O typed instead of zero",
    hint: "`POO12` for `P0012`. Hex has no letter O, so this is unambiguous and safe to repair automatically — but the app could reject it at the keyboard instead and save the round trip.",
  },
  "truncated-failure-type": {
    label: "Failure type byte cut short",
    hint: "Six characters: a valid code plus one stray hex digit, so half a failure type byte went missing between the scan tool and the text field. The base code is still trustworthy and is what gets counted.",
  },
  "not-a-code": {
    label: "Starts like a code but is not one",
    hint: "A P/B/C/U prefix followed by something unreadable — usually a wrong-length paste, or a second character outside the 0-3 the standard allows.",
  },
  separators: {
    label: "Contained separators",
    hint: "Spaces, dashes or dots inside the code. Stripped before matching, so these still count correctly.",
  },
  lowercase: {
    label: "Typed in lower case",
    hint: "Upper-cased before matching. Harmless, tracked only for completeness.",
  },
};

/* ------------------------------------------------------------- preparation */

type PreparedEntry = {
  item: DiagnosticListItem;
  parsed: ParsedDtc[];
  /** Distinct base codes in this diagnostic, so one session never double-counts. */
  bases: string[];
  make: string | null;
  car: string | null;
  hasText: boolean;
  month: string | null;
  time: number | null;
};

function prepare(items: DiagnosticListItem[]): PreparedEntry[] {
  return items.map((item) => {
    const parsed = parseDtcList(item.dtcs);
    const bases = Array.from(
      new Set(
        parsed
          .map((entry) => entry.base)
          .filter((base): base is string => Boolean(base)),
      ),
    ).sort();
    const time = item.createdAt ? new Date(item.createdAt).getTime() : null;
    return {
      item,
      parsed,
      bases,
      make: normalizeMake(item.carMake),
      car: carLabel(item),
      hasText: Boolean((item.description ?? "").trim()),
      month: item.createdAt ? item.createdAt.slice(0, 7) : null,
      time: time !== null && Number.isFinite(time) ? time : null,
    };
  });
}

/* ------------------------------------------------------------ code rollups */

type CodeAccumulator = {
  base: string;
  entries: number;
  workshops: Set<string>;
  makes: Map<string, number>;
  rawVariants: Set<string>;
  ftbs: Set<string>;
  chats: number;
  causeTotal: number;
  codeOnly: number;
  first: string | null;
  last: string | null;
  examples: DtcExample[];
};

function buildCodeRows(prepared: PreparedEntry[]): Map<string, DtcCodeRow> {
  const accumulators = new Map<string, CodeAccumulator>();

  for (const entry of prepared) {
    for (const base of entry.bases) {
      let acc = accumulators.get(base);
      if (!acc) {
        acc = {
          base,
          entries: 0,
          workshops: new Set(),
          makes: new Map(),
          rawVariants: new Set(),
          ftbs: new Set(),
          chats: 0,
          causeTotal: 0,
          codeOnly: 0,
          first: null,
          last: null,
          examples: [],
        };
        accumulators.set(base, acc);
      }
      acc.entries += 1;
      if (entry.item.workshopId) acc.workshops.add(entry.item.workshopId);
      if (entry.make) bump(acc.makes, entry.make);
      if (entry.item.hasChat) acc.chats += 1;
      acc.causeTotal += entry.item.numCauses;
      if (!entry.hasText) acc.codeOnly += 1;

      for (const parsed of entry.parsed) {
        if (parsed.base !== base) continue;
        acc.rawVariants.add(parsed.raw);
        if (parsed.ftb) acc.ftbs.add(parsed.ftb);
      }

      const at = entry.item.createdAt;
      if (at) {
        if (!acc.first || at < acc.first) acc.first = at;
        if (!acc.last || at > acc.last) acc.last = at;
      }

      if (acc.examples.length < 4 && entry.hasText) {
        acc.examples.push({
          diagnosticId: entry.item.diagnosticId,
          car: entry.car,
          country: entry.item.country,
          description: entry.item.description,
          createdAt: entry.item.createdAt,
        });
      }
    }
  }

  const codedEntries = prepared.filter((entry) => entry.bases.length > 0).length;
  const rows = new Map<string, DtcCodeRow>();

  for (const acc of accumulators.values()) {
    const family = classifyFamily(acc.base);
    const topMake = topOf(acc.makes);
    rows.set(acc.base, {
      base: acc.base,
      name: codeName(acc.base),
      scope: baseCodeScope(acc.base),
      familyKey: family.key,
      familyLabel: family.label,
      entries: acc.entries,
      share: safeDiv(acc.entries, codedEntries),
      distinctWorkshops: acc.workshops.size,
      topMake: topMake?.key ?? null,
      topMakeEntries: topMake?.n ?? 0,
      rawVariants: Array.from(acc.rawVariants).sort(),
      ftbs: Array.from(acc.ftbs).sort(),
      chatRate: safeDiv(acc.chats, acc.entries),
      avgCauses: safeDiv(acc.causeTotal, acc.entries),
      codeOnlyShare: safeDiv(acc.codeOnly, acc.entries),
      firstSeen: acc.first,
      lastSeen: acc.last,
      examples: acc.examples,
    });
  }

  return rows;
}

function sortCodeRows(rows: DtcCodeRow[]) {
  return [...rows].sort(
    (left, right) =>
      right.entries - left.entries || left.base.localeCompare(right.base),
  );
}

/* ------------------------------------------------------------ combinations */

function buildPairs(
  prepared: PreparedEntry[],
  codeRows: Map<string, DtcCodeRow>,
  minSupport: number,
): DtcPairRow[] {
  const together = new Map<string, number>();
  let codedEntries = 0;

  for (const entry of prepared) {
    if (entry.bases.length === 0) continue;
    codedEntries += 1;
    if (entry.bases.length < 2) continue;
    for (let i = 0; i < entry.bases.length; i += 1) {
      for (let j = i + 1; j < entry.bases.length; j += 1) {
        bump(together, `${entry.bases[i]}|${entry.bases[j]}`);
      }
    }
  }

  const pairs: DtcPairRow[] = [];
  for (const [key, count] of together) {
    if (count < minSupport) continue;
    const [a, b] = key.split("|");
    const rowA = codeRows.get(a);
    const rowB = codeRows.get(b);
    if (!rowA || !rowB) continue;
    // lift = P(A and B) / (P(A) * P(B)). Above 1 means the two arrive together
    // more often than independent chance would predict.
    const lift = safeDiv(count * codedEntries, rowA.entries * rowB.entries);
    pairs.push({
      a,
      b,
      aName: rowA.name,
      bName: rowB.name,
      together: count,
      aTotal: rowA.entries,
      bTotal: rowB.entries,
      lift,
      confidence: safeDiv(count, Math.min(rowA.entries, rowB.entries)),
      sameFamily: rowA.familyKey === rowB.familyKey,
    });
  }

  return pairs.sort(
    (left, right) =>
      right.together - left.together ||
      right.lift - left.lift ||
      left.a.localeCompare(right.a),
  );
}

function buildSets(
  prepared: PreparedEntry[],
  codeRows: Map<string, DtcCodeRow>,
): DtcSetRow[] {
  const sets = new Map<string, { count: number; makes: Map<string, number> }>();

  for (const entry of prepared) {
    if (entry.bases.length < 2) continue;
    const key = entry.bases.join(" ");
    let bucket = sets.get(key);
    if (!bucket) {
      bucket = { count: 0, makes: new Map() };
      sets.set(key, bucket);
    }
    bucket.count += 1;
    if (entry.make) bump(bucket.makes, entry.make);
  }

  return Array.from(sets.entries())
    .filter(([, bucket]) => bucket.count > 1)
    .map(([key, bucket]) => {
      const codes = key.split(" ");
      const familyLabels = Array.from(
        new Set(
          codes.map(
            (code) => codeRows.get(code)?.familyLabel ?? UNCLASSIFIED_FAMILY.label,
          ),
        ),
      );
      return {
        codes,
        count: bucket.count,
        familyLabels,
        topMake: topOf(bucket.makes)?.key ?? null,
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.codes.length - left.codes.length ||
        left.codes[0].localeCompare(right.codes[0]),
    );
}

/* ----------------------------------------------------------------- groups */

type GroupSpec = {
  key: string;
  label: string;
  hint: string;
};

function buildGroups(
  prepared: PreparedEntry[],
  codeRows: Map<string, DtcCodeRow>,
  specs: GroupSpec[],
  groupOf: (base: string) => string | null,
): DtcGroupRow[] {
  const entryCounts = new Map<string, number>();
  const occurrenceCounts = new Map<string, number>();
  const distinctCodes = new Map<string, Set<string>>();
  const codeCounts = new Map<string, Map<string, number>>();
  let codedEntries = 0;

  for (const entry of prepared) {
    if (entry.bases.length === 0) continue;
    codedEntries += 1;
    const seen = new Set<string>();
    for (const base of entry.bases) {
      const group = groupOf(base);
      if (!group) continue;
      bump(occurrenceCounts, group);
      if (!distinctCodes.has(group)) distinctCodes.set(group, new Set());
      distinctCodes.get(group)!.add(base);
      if (!codeCounts.has(group)) codeCounts.set(group, new Map());
      bump(codeCounts.get(group)!, base);
      seen.add(group);
    }
    for (const group of seen) bump(entryCounts, group);
  }

  return specs
    .map((spec) => {
      const top = topOf(codeCounts.get(spec.key) ?? new Map());
      return {
        key: spec.key,
        label: spec.label,
        hint: spec.hint,
        entries: entryCounts.get(spec.key) ?? 0,
        occurrences: occurrenceCounts.get(spec.key) ?? 0,
        share: safeDiv(entryCounts.get(spec.key) ?? 0, codedEntries),
        distinctCodes: distinctCodes.get(spec.key)?.size ?? 0,
        topCode: top?.key ?? null,
        topCodeName: top ? codeRows.get(top.key)?.name ?? null : null,
        topCodeEntries: top?.n ?? 0,
      };
    })
    .filter((row) => row.occurrences > 0)
    .sort(
      (left, right) =>
        right.entries - left.entries || left.label.localeCompare(right.label),
    );
}

/* -------------------------------------------------------------------- FTBs */

function buildFtbs(prepared: PreparedEntry[]): {
  rows: DtcFtbRow[];
  families: DtcGroupRow[];
  withFtb: number;
} {
  const counts = new Map<string, number>();
  const codeByFtb = new Map<string, Map<string, number>>();
  const familyCounts = new Map<string, number>();
  const familyCodes = new Map<string, Set<string>>();
  const familyTopCode = new Map<string, Map<string, number>>();
  let withFtb = 0;

  for (const entry of prepared) {
    for (const parsed of entry.parsed) {
      if (!parsed.ftb || !parsed.base) continue;
      withFtb += 1;
      bump(counts, parsed.ftb);
      if (!codeByFtb.has(parsed.ftb)) codeByFtb.set(parsed.ftb, new Map());
      bump(codeByFtb.get(parsed.ftb)!, parsed.base);

      const family = ftbFamily(parsed.ftb);
      bump(familyCounts, family.key);
      if (!familyCodes.has(family.key)) familyCodes.set(family.key, new Set());
      familyCodes.get(family.key)!.add(parsed.ftb);
      if (!familyTopCode.has(family.key))
        familyTopCode.set(family.key, new Map());
      bump(familyTopCode.get(family.key)!, parsed.base);
    }
  }

  const rows: DtcFtbRow[] = Array.from(counts.entries())
    .map(([ftb, occurrences]) => {
      const family = ftbFamily(ftb);
      return {
        ftb,
        name: ftbName(ftb),
        familyKey: family.key,
        familyLabel: family.label,
        occurrences,
        share: safeDiv(occurrences, withFtb),
        topCode: topOf(codeByFtb.get(ftb) ?? new Map())?.key ?? null,
      };
    })
    .sort(
      (left, right) =>
        right.occurrences - left.occurrences || left.ftb.localeCompare(right.ftb),
    );

  const seenFamilies = new Map<string, { label: string; hint: string }>();
  for (const ftb of counts.keys()) {
    const family = ftbFamily(ftb);
    if (!seenFamilies.has(family.key)) {
      seenFamilies.set(family.key, { label: family.label, hint: family.hint });
    }
  }

  const families: DtcGroupRow[] = Array.from(seenFamilies.entries())
    .map(([key, meta]) => ({
      key,
      label: meta.label,
      hint: meta.hint,
      entries: familyCounts.get(key) ?? 0,
      occurrences: familyCounts.get(key) ?? 0,
      share: safeDiv(familyCounts.get(key) ?? 0, withFtb),
      distinctCodes: familyCodes.get(key)?.size ?? 0,
      topCode: topOf(familyTopCode.get(key) ?? new Map())?.key ?? null,
      topCodeName: null,
      topCodeEntries: 0,
    }))
    .sort(
      (left, right) =>
        right.occurrences - left.occurrences ||
        left.label.localeCompare(right.label),
    );

  return { rows, families, withFtb };
}

/* ------------------------------------------------------------------- makes */

function buildMakes(
  prepared: PreparedEntry[],
  codeRows: Map<string, DtcCodeRow>,
  minEntries: number,
): DtcMakeRow[] {
  type MakeAcc = {
    entries: number;
    occurrences: number;
    ftbCount: number;
    codes: Map<string, number>;
    families: Map<string, number>;
  };
  const makes = new Map<string, MakeAcc>();

  for (const entry of prepared) {
    if (!entry.make || entry.bases.length === 0) continue;
    let acc = makes.get(entry.make);
    if (!acc) {
      acc = {
        entries: 0,
        occurrences: 0,
        ftbCount: 0,
        codes: new Map(),
        families: new Map(),
      };
      makes.set(entry.make, acc);
    }
    acc.entries += 1;
    acc.occurrences += entry.bases.length;
    for (const base of entry.bases) {
      bump(acc.codes, base);
      const label = codeRows.get(base)?.familyLabel;
      if (label) bump(acc.families, label);
    }
    for (const parsed of entry.parsed) {
      if (parsed.ftb) acc.ftbCount += 1;
    }
  }

  return Array.from(makes.entries())
    .filter(([, acc]) => acc.entries >= minEntries)
    .map(([make, acc]) => {
      const topCode = topOf(acc.codes);
      return {
        make,
        entries: acc.entries,
        codeOccurrences: acc.occurrences,
        avgCodesPerEntry: safeDiv(acc.occurrences, acc.entries),
        ftbShare: safeDiv(acc.ftbCount, acc.occurrences),
        topCode: topCode?.key ?? null,
        topCodeName: topCode ? codeRows.get(topCode.key)?.name ?? null : null,
        topCodeEntries: topCode?.n ?? 0,
        topFamilyLabel: topOf(acc.families)?.key ?? null,
      };
    })
    .sort(
      (left, right) =>
        right.entries - left.entries || left.make.localeCompare(right.make),
    );
}

function buildCountries(
  prepared: PreparedEntry[],
  codeRows: Map<string, DtcCodeRow>,
): DtcCountryRow[] {
  type Acc = {
    entries: number;
    occurrences: number;
    codes: Map<string, number>;
    families: Map<string, number>;
  };
  const countries = new Map<string, Acc>();

  for (const entry of prepared) {
    const country = (entry.item.country ?? "").trim().toUpperCase();
    if (!country || entry.bases.length === 0) continue;
    let acc = countries.get(country);
    if (!acc) {
      acc = { entries: 0, occurrences: 0, codes: new Map(), families: new Map() };
      countries.set(country, acc);
    }
    acc.entries += 1;
    acc.occurrences += entry.bases.length;
    for (const base of entry.bases) {
      bump(acc.codes, base);
      const label = codeRows.get(base)?.familyLabel;
      if (label) bump(acc.families, label);
    }
  }

  return Array.from(countries.entries())
    .map(([country, acc]) => {
      const topCode = topOf(acc.codes);
      return {
        country,
        entries: acc.entries,
        codeOccurrences: acc.occurrences,
        topCode: topCode?.key ?? null,
        topCodeName: topCode ? codeRows.get(topCode.key)?.name ?? null : null,
        topFamilyLabel: topOf(acc.families)?.key ?? null,
      };
    })
    .sort(
      (left, right) =>
        right.entries - left.entries ||
        left.country.localeCompare(right.country),
    );
}

/* -------------------------------------------------------------- count bands */

const COUNT_BANDS: { key: string; label: string; hint: string; test: (n: number) => boolean }[] =
  [
    {
      key: "0",
      label: "No codes",
      hint: "Description only. Either the fault throws no code, or the workshop has not read the car yet and is asking the AI from symptoms alone.",
      test: (n) => n === 0,
    },
    {
      key: "1",
      label: "One code",
      hint: "The common case. Also where the description is most often left blank, so the AI gets a bare code and nothing else.",
      test: (n) => n === 1,
    },
    {
      key: "2",
      label: "Two codes",
      test: (n) => n === 2,
      hint: "Two codes together is usually a cause and its consequence, which is exactly where reading the pair correctly beats looking each one up.",
    },
    {
      key: "3",
      label: "Three codes",
      hint: "",
      test: (n) => n === 3,
    },
    {
      key: "4-5",
      label: "Four to five codes",
      hint: "",
      test: (n) => n >= 4 && n <= 5,
    },
    {
      key: "6+",
      label: "Six or more codes",
      hint: "A full memory dump rather than a considered selection. These sessions also open follow-up chat most often, which suggests the answer needs more work to be useful.",
      test: (n) => n >= 6,
    },
  ];

function buildCountBands(prepared: PreparedEntry[]): DtcCountBand[] {
  return COUNT_BANDS.map((band) => {
    const matching = prepared.filter((entry) => band.test(entry.bases.length));
    const withText = matching.filter((entry) => entry.hasText).length;
    const chats = matching.filter((entry) => entry.item.hasChat).length;
    const causeTotal = matching.reduce(
      (sum, entry) => sum + entry.item.numCauses,
      0,
    );
    return {
      key: band.key,
      label: band.label,
      hint: band.hint,
      entries: matching.length,
      share: safeDiv(matching.length, prepared.length),
      withTextShare: safeDiv(withText, matching.length),
      chatRate: safeDiv(chats, matching.length),
      avgCauses: safeDiv(causeTotal, matching.length),
    };
  }).filter((band) => band.entries > 0);
}

/* ------------------------------------------------------------------ trends */

function buildMonthly(prepared: PreparedEntry[]): DtcMonthlyPoint[] {
  const months = new Map<
    string,
    { diagnostics: number; withCodes: number; occurrences: number }
  >();

  for (const entry of prepared) {
    if (!entry.month) continue;
    let bucket = months.get(entry.month);
    if (!bucket) {
      bucket = { diagnostics: 0, withCodes: 0, occurrences: 0 };
      months.set(entry.month, bucket);
    }
    bucket.diagnostics += 1;
    if (entry.bases.length > 0) {
      bucket.withCodes += 1;
      bucket.occurrences += entry.bases.length;
    }
  }

  return Array.from(months.entries())
    .map(([month, bucket]) => ({
      month,
      diagnostics: bucket.diagnostics,
      withCodes: bucket.withCodes,
      coverage: safeDiv(bucket.withCodes, bucket.diagnostics),
      codeOccurrences: bucket.occurrences,
      avgCodesPerCodedEntry: safeDiv(bucket.occurrences, bucket.withCodes),
    }))
    .sort((left, right) => left.month.localeCompare(right.month));
}

const TREND_WINDOW_DAYS = 60;

/**
 * Compares the most recent window against the window before it.
 *
 * The reference point is the newest diagnostic in the data rather than the wall
 * clock, so a lagging sync shows as a shifted window instead of silently
 * reporting a collapse in volume.
 */
function buildTrends(
  prepared: PreparedEntry[],
  codeRows: Map<string, DtcCodeRow>,
): { rising: DtcTrendRow[]; fading: DtcTrendRow[] } {
  const times = prepared
    .map((entry) => entry.time)
    .filter((time): time is number => time !== null);
  if (times.length === 0) return { rising: [], fading: [] };

  const latest = Math.max(...times);
  const windowMs = TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentStart = latest - windowMs;
  const priorStart = recentStart - windowMs;

  const recent = new Map<string, number>();
  const prior = new Map<string, number>();
  const everBefore = new Map<string, number>();

  for (const entry of prepared) {
    if (entry.time === null) continue;
    const inRecent = entry.time > recentStart;
    const inPrior = entry.time > priorStart && entry.time <= recentStart;
    for (const base of entry.bases) {
      if (inRecent) bump(recent, base);
      else bump(everBefore, base);
      if (inPrior) bump(prior, base);
    }
  }

  const rows: DtcTrendRow[] = Array.from(
    new Set([...recent.keys(), ...prior.keys()]),
  ).map((base) => {
    const recentCount = recent.get(base) ?? 0;
    const priorCount = prior.get(base) ?? 0;
    return {
      base,
      name: codeRows.get(base)?.name ?? null,
      familyLabel: codeRows.get(base)?.familyLabel ?? UNCLASSIFIED_FAMILY.label,
      recent: recentCount,
      prior: priorCount,
      delta: recentCount - priorCount,
      isNew: recentCount > 0 && (everBefore.get(base) ?? 0) === 0,
    };
  });

  const rising = rows
    .filter((row) => row.delta > 0 && row.recent >= 3)
    .sort(
      (left, right) =>
        right.delta - left.delta ||
        right.recent - left.recent ||
        left.base.localeCompare(right.base),
    );

  const fading = rows
    .filter((row) => row.delta < 0 && row.prior >= 3)
    .sort(
      (left, right) =>
        left.delta - right.delta ||
        right.prior - left.prior ||
        left.base.localeCompare(right.base),
    );

  return { rising, fading };
}

/* ------------------------------------------------------------------ spread */

function buildSpread(
  prepared: PreparedEntry[],
  codeRows: Map<string, DtcCodeRow>,
  minEntries: number,
): { widest: DtcSpreadRow[]; concentrated: DtcSpreadRow[] } {
  const perCode = new Map<string, Map<string, number>>();
  const workshopNames = new Map<string, string>();

  for (const entry of prepared) {
    const workshopId = entry.item.workshopId;
    if (!workshopId) continue;
    if (entry.item.workshopName) {
      workshopNames.set(workshopId, entry.item.workshopName);
    }
    for (const base of entry.bases) {
      if (!perCode.has(base)) perCode.set(base, new Map());
      bump(perCode.get(base)!, workshopId);
    }
  }

  const rows: DtcSpreadRow[] = [];
  for (const [base, workshops] of perCode) {
    const row = codeRows.get(base);
    if (!row || row.entries < minEntries) continue;
    const total = Array.from(workshops.values()).reduce(
      (sum, value) => sum + value,
      0,
    );
    const top = topOf(workshops);
    rows.push({
      base,
      name: row.name,
      entries: row.entries,
      distinctWorkshops: workshops.size,
      topWorkshopShare: safeDiv(top?.n ?? 0, total),
      topWorkshopName: top
        ? workshopNames.get(top.key) ?? top.key
        : null,
    });
  }

  const widest = [...rows].sort(
    (left, right) =>
      right.distinctWorkshops - left.distinctWorkshops ||
      right.entries - left.entries ||
      left.base.localeCompare(right.base),
  );

  const concentrated = rows
    .filter((row) => row.distinctWorkshops === 1 || row.topWorkshopShare >= 0.75)
    .sort(
      (left, right) =>
        right.entries - left.entries ||
        right.topWorkshopShare - left.topWorkshopShare ||
        left.base.localeCompare(right.base),
    );

  return { widest, concentrated };
}

/* ----------------------------------------------------------- data quality */

function buildQuality(prepared: PreparedEntry[]): {
  defects: DtcDefectRow[];
  unparseable: DtcOddityRow[];
  manufacturerHex: DtcOddityRow[];
  unparseableOccurrences: number;
  manufacturerCodeOccurrences: number;
  noSaeCodeEntries: number;
} {
  const defectCounts = new Map<DtcDefect, number>();
  const defectExamples = new Map<DtcDefect, { raw: string; normalized: string }[]>();
  const unparseable = new Map<string, { count: number; makes: Set<string> }>();
  const hex = new Map<string, { count: number; makes: Set<string> }>();
  let unparseableOccurrences = 0;
  let manufacturerCodeOccurrences = 0;
  let noSaeCodeEntries = 0;

  for (const entry of prepared) {
    let entryHadReadable = false;
    let entryHadAny = false;

    for (const parsed of entry.parsed) {
      entryHadAny = true;
      for (const defect of parsed.defects) {
        bump(defectCounts, defect);
        const examples = defectExamples.get(defect) ?? [];
        if (
          examples.length < 8 &&
          !examples.some((example) => example.raw === parsed.raw)
        ) {
          examples.push({ raw: parsed.raw, normalized: parsed.normalized });
          defectExamples.set(defect, examples);
        }
      }

      if (parsed.kind === "unparseable") {
        unparseableOccurrences += 1;
        const bucket = unparseable.get(parsed.raw) ?? {
          count: 0,
          makes: new Set<string>(),
        };
        bucket.count += 1;
        if (entry.make) bucket.makes.add(entry.make);
        unparseable.set(parsed.raw, bucket);
      } else if (
        parsed.kind === "manufacturer-hex" ||
        parsed.kind === "manufacturer-native"
      ) {
        manufacturerCodeOccurrences += 1;
        const bucket = hex.get(parsed.raw) ?? {
          count: 0,
          makes: new Set<string>(),
        };
        bucket.count += 1;
        if (entry.make) bucket.makes.add(entry.make);
        hex.set(parsed.raw, bucket);
      } else {
        entryHadReadable = true;
      }
    }

    if (entryHadAny && !entryHadReadable) noSaeCodeEntries += 1;
  }

  const defects: DtcDefectRow[] = Array.from(defectCounts.entries())
    .map(([defect, occurrences]) => ({
      defect,
      label: DEFECT_LABELS[defect].label,
      hint: DEFECT_LABELS[defect].hint,
      occurrences,
      examples: defectExamples.get(defect) ?? [],
    }))
    .sort(
      (left, right) =>
        right.occurrences - left.occurrences ||
        left.label.localeCompare(right.label),
    );

  const toOddities = (map: Map<string, { count: number; makes: Set<string> }>) =>
    Array.from(map.entries())
      .map(([raw, bucket]) => ({
        raw,
        count: bucket.count,
        makes: Array.from(bucket.makes).sort(),
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.raw.localeCompare(right.raw),
      );

  return {
    defects,
    unparseable: toOddities(unparseable),
    manufacturerHex: toOddities(hex),
    unparseableOccurrences,
    manufacturerCodeOccurrences,
    noSaeCodeEntries,
  };
}

/* ------------------------------------------------------------------- entry */

export type AnalyseDtcOptions = {
  /** Minimum diagnostics a pair must share before it is shown. */
  minPairSupport?: number;
  /** Minimum coded diagnostics a make needs before it gets its own row. */
  minMakeEntries?: number;
  /** Minimum entries a code needs before its workshop spread is meaningful. */
  minSpreadEntries?: number;
};

export function analyseDtcCodes(
  items: DiagnosticListItem[],
  options: AnalyseDtcOptions = {},
): DtcAnalysis {
  const {
    minPairSupport = 3,
    minMakeEntries = 8,
    minSpreadEntries = 4,
  } = options;

  const prepared = prepare(items);
  const codeRows = buildCodeRows(prepared);
  const allRows = sortCodeRows(Array.from(codeRows.values()));

  const coded = prepared.filter((entry) => entry.bases.length > 0);
  const codeOccurrences = coded.reduce(
    (sum, entry) => sum + entry.bases.length,
    0,
  );
  const rawEntries = prepared.reduce(
    (sum, entry) => sum + entry.parsed.length,
    0,
  );
  const multiCode = coded.filter((entry) => entry.bases.length > 1).length;
  const codeOnly = coded.filter((entry) => !entry.hasText).length;
  const genericCodes = allRows.filter((row) => row.scope === "generic");
  const namedOccurrences = allRows
    .filter((row) => row.name)
    .reduce((sum, row) => sum + row.entries, 0);

  const { rows: ftbs, families: ftbFamilies, withFtb } = buildFtbs(prepared);
  const quality = buildQuality(prepared);
  const trends = buildTrends(prepared, codeRows);
  const spread = buildSpread(prepared, codeRows, minSpreadEntries);

  const times = prepared
    .map((entry) => entry.item.createdAt)
    .filter((at): at is string => Boolean(at))
    .sort();

  const familySpecs = [...DTC_FAMILY_ORDER, UNCLASSIFIED_FAMILY].map(
    (family) => ({
      key: family.key,
      label: family.label,
      hint: family.hint,
    }),
  );

  const systemSpecs = (Object.keys(DTC_SYSTEMS) as DtcSystemKey[]).map((key) => ({
    key,
    label: DTC_SYSTEMS[key].label,
    hint: DTC_SYSTEMS[key].hint,
  }));

  const subsystemSpecs = Array.from(
    new Map(
      allRows
        .map((row) => powertrainSubsystem(row.base))
        .filter((entry): entry is { key: string; label: string } => Boolean(entry))
        .map((entry) => [entry.key, entry]),
    ).values(),
  ).map((entry) => ({
    key: entry.key,
    label: entry.label,
    hint: "SAE J2012 assigns the third character of a powertrain code to a subsystem. Shown as a cross-check on the functional families above.",
  }));

  const scopeSpecs = [
    {
      key: "generic",
      label: "Generic, defined by the standard",
      hint: "Second character 0 or 2. These mean the same thing on every vehicle, so they can carry a portable description and be compared across makes.",
    },
    {
      key: "manufacturer",
      label: "Manufacturer-specific",
      hint: "Second character 1 or 3. The number is only meaningful together with the make — the same code means different things on different vehicles, which is why this page never puts a name on them.",
    },
  ];

  return {
    totals: {
      diagnostics: prepared.length,
      withCodes: coded.length,
      coverage: safeDiv(coded.length, prepared.length),
      codeOccurrences,
      rawEntries,
      distinctBaseCodes: allRows.length,
      avgCodesPerEntry: safeDiv(codeOccurrences, coded.length),
      multiCodeEntries: multiCode,
      multiCodeShare: safeDiv(multiCode, coded.length),
      codeOnlyEntries: codeOnly,
      codeOnlyShare: safeDiv(codeOnly, coded.length),
      withFtb,
      ftbShare: safeDiv(withFtb, codeOccurrences),
      genericShare: safeDiv(genericCodes.length, allRows.length),
      namedShare: safeDiv(namedOccurrences, codeOccurrences),
      dictionarySize: dictionarySize(),
      noSaeCodeEntries: quality.noSaeCodeEntries,
      unparseableOccurrences: quality.unparseableOccurrences,
      manufacturerCodeOccurrences: quality.manufacturerCodeOccurrences,
      earliestDiagnosticAt: times[0] ?? null,
      latestDiagnosticAt: times[times.length - 1] ?? null,
    },
    topCodes: allRows,
    hardestCodes: allRows
      .filter((row) => row.entries >= 5)
      .sort(
        (left, right) =>
          right.chatRate - left.chatRate ||
          right.entries - left.entries ||
          left.base.localeCompare(right.base),
      ),
    pairs: buildPairs(prepared, codeRows, minPairSupport),
    sets: buildSets(prepared, codeRows),
    families: buildGroups(
      prepared,
      codeRows,
      familySpecs,
      (base) => classifyFamily(base).key,
    ),
    systems: buildGroups(prepared, codeRows, systemSpecs, (base) => base[0]),
    subsystems: buildGroups(
      prepared,
      codeRows,
      subsystemSpecs,
      (base) => powertrainSubsystem(base)?.key ?? null,
    ),
    scopes: buildGroups(prepared, codeRows, scopeSpecs, (base) =>
      baseCodeScope(base),
    ),
    ftbs,
    ftbFamilies,
    makes: buildMakes(prepared, codeRows, minMakeEntries),
    countries: buildCountries(prepared, codeRows),
    countBands: buildCountBands(prepared),
    monthly: buildMonthly(prepared),
    rising: trends.rising,
    fading: trends.fading,
    trendWindowDays: TREND_WINDOW_DAYS,
    widestSpread: spread.widest,
    mostConcentrated: spread.concentrated,
    defects: quality.defects,
    unparseable: quality.unparseable,
    manufacturerHex: quality.manufacturerHex,
    unclassified: allRows.filter(
      (row) => row.familyKey === UNCLASSIFIED_FAMILY.key,
    ),
  };
}
