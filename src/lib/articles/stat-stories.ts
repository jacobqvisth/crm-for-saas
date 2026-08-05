// Stat stories: turning the CRM's aggregate diagnostics data into article-grade
// fact packs.
//
// WHY A CURATED CATALOGUE RATHER THAN "HAND THE MODEL THE STATS"
// analyseDtcCodes() returns roughly 25 collections and 20 scalar totals, and
// analyseSearchTerms() another dozen. Dumping all of that into a prompt produces
// mush: the model picks arbitrary numbers, mixes incompatible denominators, and
// writes "insights" that are really just table readings. So each story below is
// ONE angle, backed by ONE slice of the analysis, with the definition of every
// metric spelled out and the sample size attached. The model gets a tight fact
// pack and a stated point to argue, which is what makes the output publishable.
//
// EVERY NUMBER HERE IS REAL. Fact packs are the "data" provenance class in the
// claims panel, so nothing in them may be inferred or rounded into a claim the
// data does not support. Shares out of analyse.ts are 0-1 fractions (safeDiv),
// so they are multiplied here, once, on the way into the text.
//
// PRIVACY: workshop names and usernames never enter a fact pack. DtcSpreadRow
// carries topWorkshopName and it is deliberately dropped; only the shape of the
// concentration (share, distinct workshop count) survives.

import { stripLongDashes } from "@/lib/ai/no-long-dash";
import type { DtcAnalysis } from "@/lib/ceo/dtc/analyse";
import type { SearchTermsAnalysis } from "@/lib/ceo/search-terms";

export type StatStoryKey =
  | "code_pairs"
  | "hardest_codes"
  | "rising_codes"
  | "multi_code_reality"
  | "code_only_habit"
  | "by_make"
  | "by_country"
  | "system_mix"
  | "ftb_signal"
  | "spread_vs_concentrated"
  | "tech_language"
  | "data_quality"
  | "platform_scale";

/** Which analyses a story needs loaded. */
export type StatStoryNeeds = "dtc" | "terms" | "both";

export interface StatStoryDefinition {
  key: StatStoryKey;
  label: string;
  /** One line shown in the picker: what the reader learns. */
  blurb: string;
  needs: StatStoryNeeds;
  /**
   * The point the article should argue. Handed to the model as the thesis so it
   * writes an argument rather than narrating a table.
   */
  thesis: string;
  /** Minimum sample before the story is offered at all. */
  minSample: number;
  /** What minSample counts, for the "needs N more" message. */
  sampleLabel: string;
}

export interface StatFactPack {
  key: StatStoryKey;
  label: string;
  thesis: string;
  /** Labelled, unit-carrying fact lines. Plain text, one fact per line. */
  lines: string[];
  /** Sample size + window, so the model can hedge honestly. */
  sampleNote: string;
}

export interface StatStoryAvailability {
  key: StatStoryKey;
  label: string;
  blurb: string;
  available: boolean;
  sample: number;
  minSample: number;
  sampleLabel: string;
}

/* ------------------------------------------------------------- definitions */

export const STAT_STORIES: StatStoryDefinition[] = [
  {
    key: "code_pairs",
    label: "Codes that travel together",
    blurb:
      "Which fault codes co-occur far more often than chance, and what that means for chasing one code at a time.",
    needs: "dtc",
    thesis:
      "Fault codes are not independent events. Certain pairs appear together many times more often than chance would predict, which means a technician who reads codes one at a time is looking at fragments of a single failure. This is the argument for analysing a whole code set at once.",
    minSample: 40,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "hardest_codes",
    label: "The codes that take the most ruling out",
    blurb:
      "Codes with the widest set of plausible causes, ranked by how much has to be eliminated before you reach the real one.",
    needs: "dtc",
    thesis:
      "Difficulty is not about how rare a code is, it is about how many plausible causes have to be eliminated. The codes with the most candidate causes are the ones that stall a bay and get escalated to the senior technician.",
    minSample: 40,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "rising_codes",
    label: "Fault codes on the rise",
    blurb: "Codes appearing faster now than in the preceding window, including ones that are brand new.",
    needs: "dtc",
    thesis:
      "The code mix is not static. Some codes are climbing quickly and some are fading, so what a shop should be ready for this quarter is not what it was last quarter.",
    minSample: 60,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "multi_code_reality",
    label: "Real jobs are rarely one code",
    blurb: "How often diagnostics arrive with several codes at once, and how those jobs behave differently.",
    needs: "dtc",
    thesis:
      "The textbook model of one code leading to one fix does not match what actually rolls into a workshop. A large share of real diagnostics carry several codes simultaneously, and those jobs behave measurably differently from single-code jobs.",
    minSample: 40,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "code_only_habit",
    label: "When a code arrives with no story",
    blurb:
      "The share of diagnostics submitted as a bare code with no description, and what that costs in accuracy.",
    needs: "dtc",
    thesis:
      "Under time pressure a lot of diagnostics get submitted as a bare code with no symptom description attached. That habit is understandable and it measurably narrows what any diagnostic process, human or software, has to work with.",
    minSample: 40,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "by_make",
    label: "What each brand throws at you",
    blurb: "Per-manufacturer code volume, the signature code for each brand, and how many codes arrive per job.",
    needs: "dtc",
    thesis:
      "Different manufacturers present differently. The signature code, the number of codes per job, and how often extended failure-type information is attached all vary by brand, which is why brand experience is real and hard to transfer.",
    minSample: 60,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "by_country",
    label: "Same cars, different countries",
    blurb: "How the code mix differs across the markets we operate in.",
    needs: "dtc",
    thesis:
      "The fault-code mix is not uniform across markets. Fleet age, climate, and inspection regimes leave a visible fingerprint on which codes dominate in each country.",
    minSample: 80,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "system_mix",
    label: "Which vehicle systems actually fail",
    blurb: "The share of fault codes landing in each vehicle system, from powertrain down.",
    needs: "dtc",
    thesis:
      "Aggregated across thousands of diagnostics, failures concentrate in a small number of vehicle systems. Knowing that distribution is how a shop decides what to train for and what to stock.",
    minSample: 40,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "ftb_signal",
    label: "The failure-type byte nobody reads",
    blurb:
      "How often codes carry extended failure-type information, and why most tools throw that detail away.",
    needs: "dtc",
    thesis:
      "Many fault codes arrive with a failure-type byte appended that specifies how the circuit failed, not just what failed. Most lookup tools discard it. That discarded byte is often the difference between a guess and a diagnosis.",
    minSample: 60,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "spread_vs_concentrated",
    label: "Universal codes and local ones",
    blurb:
      "Codes that show up in nearly every workshop, versus codes that one workshop sees constantly and others never do.",
    needs: "dtc",
    thesis:
      "Some codes are universal and some are highly local. A code that dominates one workshop's month may be nearly absent everywhere else, which is why a shop's own gut feel for what is common can be badly calibrated.",
    minSample: 80,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "tech_language",
    label: "How technicians actually describe faults",
    blurb:
      "The real vocabulary of submitted complaints, the most common phrasings, and the language split.",
    needs: "terms",
    thesis:
      "Technicians do not describe faults the way service literature does. They write short, concrete, symptom-first descriptions in their own language, and any tool that expects textbook phrasing fails at the first input box.",
    minSample: 40,
    sampleLabel: "diagnostics with a written description",
  },
  {
    key: "data_quality",
    label: "What unreadable fault codes taught us",
    blurb:
      "Typos, letter-O-for-zero, manufacturer-native hex: what real code entry looks like before any cleanup.",
    needs: "dtc",
    thesis:
      "Real fault-code input is messy. Typos, letter O typed for zero, and manufacturer-native codes with no standard equivalent all arrive routinely. Any system that assumes clean input silently drops a meaningful slice of real work.",
    minSample: 40,
    sampleLabel: "diagnostics with fault codes",
  },
  {
    key: "platform_scale",
    label: "The dataset behind the product",
    blurb: "Diagnostics run, distinct codes seen, coverage, and the trend by month.",
    needs: "dtc",
    thesis:
      "Aggregate scale is what makes pattern-level diagnosis possible in the first place. This is a milestone and transparency post about the dataset the product reasons over.",
    minSample: 40,
    sampleLabel: "diagnostics with fault codes",
  },
];

export function getStatStory(key: string): StatStoryDefinition | undefined {
  return STAT_STORIES.find((s) => s.key === key);
}

/* ---------------------------------------------------------------- helpers */

/** analyse.ts shares are 0-1 fractions. Convert once, here. */
function pct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

function num(value: number, digits = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function named(code: string, name: string | null): string {
  return name ? `${code} (${name})` : code;
}

/**
 * Verbatim complaints are useful as illustration but some run to 900+
 * characters of a shop's full case history. Quoting one of those in a published
 * article effectively republishes someone's work order, so they are clipped to a
 * snippet here. The full text stays in the dashboard, which is internal.
 */
const VERBATIM_MAX = 160;

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= VERBATIM_MAX ? clean : `${clean.slice(0, VERBATIM_MAX).trimEnd()}…`;
}

function monthLabel(month: string): string {
  return month;
}

/* ------------------------------------------------------------ fact packs */

export interface StatSources {
  dtc: DtcAnalysis | null;
  terms: SearchTermsAnalysis | null;
}

/**
 * The sample a story is judged on. DTC stories use coded diagnostics; the
 * language story uses described ones.
 */
export function statStorySample(def: StatStoryDefinition, sources: StatSources): number {
  if (def.needs === "terms") return sources.terms?.totals.described ?? 0;
  return sources.dtc?.totals.withCodes ?? 0;
}

export function statStoryAvailability(sources: StatSources): StatStoryAvailability[] {
  return STAT_STORIES.map((def) => {
    const sample = statStorySample(def, sources);
    return {
      key: def.key,
      label: def.label,
      blurb: def.blurb,
      sample,
      minSample: def.minSample,
      sampleLabel: def.sampleLabel,
      available: sample >= def.minSample,
    };
  });
}

/**
 * Build the fact pack for one story. Returns null when the underlying slice is
 * empty, so a story can never produce an article with no facts in it.
 */
export function buildStatFactPack(
  key: StatStoryKey,
  sources: StatSources,
): StatFactPack | null {
  const def = getStatStory(key);
  if (!def) return null;
  const { dtc, terms } = sources;
  if ((def.needs === "dtc" || def.needs === "both") && !dtc) return null;
  if ((def.needs === "terms" || def.needs === "both") && !terms) return null;

  // The hint strings come from the existing DTC / Search Terms dashboards, which
  // are full of em dashes ("Barely a prompt - motorlampa, airbag"). Those are
  // internal-only there, but here they land in a prompt and the model mirrors the
  // punctuation it is shown, so strip them on the way in as well as on the way out.
  const lines = BUILDERS[key]({ dtc, terms }).map(stripLongDashes);
  if (!lines.length) return null;

  return {
    key,
    label: def.label,
    thesis: stripLongDashes(def.thesis),
    lines,
    sampleNote: stripLongDashes(sampleNote(def, sources)),
  };
}

function sampleNote(def: StatStoryDefinition, sources: StatSources): string {
  const { dtc, terms } = sources;
  const parts: string[] = [];
  if (def.needs === "terms" && terms) {
    parts.push(
      `Based on ${terms.totals.described} diagnostics that included a written description, out of ${terms.totals.diagnostics} total.`,
    );
  } else if (dtc) {
    parts.push(
      `Based on ${dtc.totals.withCodes} diagnostics that included at least one readable fault code, out of ${dtc.totals.diagnostics} total.`,
    );
    if (dtc.totals.earliestDiagnosticAt && dtc.totals.latestDiagnosticAt) {
      parts.push(
        `Data window: ${dtc.totals.earliestDiagnosticAt.slice(0, 10)} to ${dtc.totals.latestDiagnosticAt.slice(0, 10)}.`,
      );
    }
  }
  parts.push(
    "This is Wrenchlane's own platform data, not an industry survey. Describe it as such and never present it as market-wide.",
  );
  return parts.join(" ");
}

type Builder = (s: { dtc: DtcAnalysis | null; terms: SearchTermsAnalysis | null }) => string[];

const BUILDERS: Record<StatStoryKey, Builder> = {
  code_pairs: ({ dtc }) => {
    if (!dtc) return [];
    const pairs = dtc.pairs.slice(0, 12);
    if (!pairs.length) return [];
    return [
      "Metric definition: lift is how many times more often two codes appear together than independent chance would predict. Lift 1.0 means no association at all. Confidence is: when the rarer of the two codes appears, how often the other one is present too.",
      `Distinct base codes seen in total: ${dtc.totals.distinctBaseCodes}.`,
      `Diagnostics carrying more than one code: ${dtc.totals.multiCodeEntries} (${pct(dtc.totals.multiCodeShare)} of coded diagnostics).`,
      "Strongest co-occurring pairs:",
      ...pairs.map(
        (p) =>
          `  - ${named(p.a, p.aName)} + ${named(p.b, p.bName)}: seen together in ${p.together} diagnostics, ${num(p.lift)}x more often than chance, confidence ${pct(p.confidence)}${p.sameFamily ? ", same code family" : ", different code families"}.`,
      ),
      "Note: pairs spanning different code families are the interesting ones, because those are the cases where a single root fault surfaces in two unrelated-looking systems.",
      "Caution on lift: lift is a ratio, so a pair seen in only a handful of diagnostics can show a huge multiple without meaning much. Lead with pairs that have real support behind them (the 'seen together in N diagnostics' figure), and if you quote a very high multiple, state the N in the same breath. Never present a pair seen fewer than about ten times as an established pattern.",
    ];
  },

  hardest_codes: ({ dtc }) => {
    if (!dtc) return [];
    const rows = dtc.hardestCodes.slice(0, 10);
    if (!rows.length) return [];
    return [
      "Metric definition: avg causes is the average number of distinct candidate causes our engine ranked for that code. Chat rate is the share of those diagnostics where the technician opened a follow-up conversation rather than acting on the first answer, which is a proxy for the code being genuinely hard.",
      "Codes with the widest candidate-cause spread:",
      ...rows.map(
        (r) =>
          `  - ${named(r.base, r.name)}: ${num(r.avgCauses)} candidate causes on average, seen in ${r.entries} diagnostics across ${r.distinctWorkshops} workshops, follow-up chat opened ${pct(r.chatRate)} of the time, family ${r.familyLabel}.`,
      ),
      `For contrast, the platform-wide average across all coded diagnostics is a smaller cause count, and only ${pct(dtc.totals.codeOnlyShare)} of coded diagnostics arrive with no description at all.`,
    ];
  },

  rising_codes: ({ dtc }) => {
    if (!dtc) return [];
    const rising = dtc.rising.slice(0, 10);
    const fading = dtc.fading.slice(0, 5);
    if (!rising.length) return [];
    return [
      `Comparison window: the most recent ${dtc.trendWindowDays} days against the ${dtc.trendWindowDays} days before that.`,
      "Codes rising fastest:",
      ...rising.map(
        (r) =>
          `  - ${named(r.base, r.name)}: ${r.recent} in the recent window versus ${r.prior} before${r.isNew ? " (did not appear at all in the prior window)" : ""}, family ${r.familyLabel}.`,
      ),
      ...(fading.length
        ? [
            "Codes fading:",
            ...fading.map(
              (r) => `  - ${named(r.base, r.name)}: ${r.recent} recent versus ${r.prior} prior, family ${r.familyLabel}.`,
            ),
          ]
        : []),
      "Caution: short-window movements on low counts are noisy. Only treat a movement as a trend if the absolute numbers are meaningful, and say so plainly if they are small.",
    ];
  },

  multi_code_reality: ({ dtc }) => {
    if (!dtc) return [];
    const bands = dtc.countBands.filter((b) => b.entries > 0);
    return [
      `Coded diagnostics: ${dtc.totals.withCodes}. Average readable codes per coded diagnostic: ${num(dtc.totals.avgCodesPerEntry, 2)}.`,
      `Diagnostics with more than one code: ${dtc.totals.multiCodeEntries} (${pct(dtc.totals.multiCodeShare)}).`,
      `Total code instances after de-duplicating repeats within a session: ${dtc.totals.codeOccurrences}.`,
      ...(bands.length
        ? [
            "How behaviour changes with the number of codes on the job:",
            ...bands.map(
              (b) =>
                `  - ${b.label} (${b.hint}): ${b.entries} diagnostics, ${pct(b.share)} of all diagnostics, wrote a description ${pct(b.withTextShare)} of the time, opened a follow-up chat ${pct(b.chatRate)} of the time, ${num(b.avgCauses)} candidate causes on average.`,
            ),
          ]
        : []),
      ...(dtc.sets.length
        ? [
            "Most common exact code sets:",
            ...dtc.sets
              .slice(0, 6)
              .map((s) => `  - ${s.codes.join(" + ")}: ${s.count} diagnostics${s.topMake ? `, most often on ${s.topMake}` : ""}.`),
          ]
        : []),
    ];
  },

  code_only_habit: ({ dtc }) => {
    if (!dtc) return [];
    return [
      `Diagnostics submitted as codes only, with no description text at all: ${dtc.totals.codeOnlyEntries} (${pct(dtc.totals.codeOnlyShare)} of coded diagnostics).`,
      `Overall description coverage across all diagnostics: ${pct(dtc.totals.coverage)} carried at least one readable code.`,
      ...(dtc.countBands.filter((b) => b.entries > 0).length
        ? [
            "Description rate by how many codes were on the job:",
            ...dtc.countBands
              .filter((b) => b.entries > 0)
              .map((b) => `  - ${b.label}: wrote a description ${pct(b.withTextShare)} of the time (${b.entries} diagnostics).`),
          ]
        : []),
      ...(dtc.topCodes.length
        ? [
            "Codes most often submitted bare, with no description:",
            ...dtc.topCodes
              .filter((c) => c.entries >= 5)
              .sort((a, b) => b.codeOnlyShare - a.codeOnlyShare)
              .slice(0, 8)
              .map((c) => `  - ${named(c.base, c.name)}: ${pct(c.codeOnlyShare)} of its ${c.entries} diagnostics had no description.`),
          ]
        : []),
      "Framing note: this is not a criticism of technicians. It reflects real time pressure at the bay. The useful point is what a diagnosis has to work with when the description is absent.",
    ];
  },

  by_make: ({ dtc }) => {
    if (!dtc) return [];
    const makes = dtc.makes.slice(0, 12);
    if (!makes.length) return [];
    return [
      "Metric definition: FTB share is how often that brand's codes arrive with a failure-type byte appended, which specifies how the circuit failed rather than only what failed.",
      "Per-manufacturer breakdown:",
      ...makes.map(
        (m) =>
          `  - ${m.make}: ${m.entries} coded diagnostics, ${num(m.avgCodesPerEntry, 2)} codes per job on average, failure-type byte present ${pct(m.ftbShare)} of the time, signature code ${m.topCode ? named(m.topCode, m.topCodeName) : "n/a"} (${m.topCodeEntries} times)${m.topFamilyLabel ? `, most common family ${m.topFamilyLabel}` : ""}.`,
      ),
      "Note: make names are normalised, so Mercedes, MERCEDES and Mercedes-Benz are counted as one brand. Volumes reflect our customer mix, not the market's parc.",
    ];
  },

  by_country: ({ dtc }) => {
    if (!dtc) return [];
    const rows = dtc.countries.filter((c) => c.entries > 0).slice(0, 10);
    if (!rows.length) return [];
    return [
      "Per-market breakdown:",
      ...rows.map(
        (c) =>
          `  - ${c.country}: ${c.entries} coded diagnostics, ${c.codeOccurrences} code instances, top code ${c.topCode ? named(c.topCode, c.topCodeName) : "n/a"}${c.topFamilyLabel ? `, most common family ${c.topFamilyLabel}` : ""}.`,
      ),
      "Note: country volumes track where our customers are, so do not read them as market size. The interesting comparison is the code mix within each market, not the totals.",
    ];
  },

  system_mix: ({ dtc }) => {
    if (!dtc) return [];
    const systems = dtc.systems.filter((g) => g.entries > 0).slice(0, 10);
    const families = dtc.families.filter((g) => g.entries > 0).slice(0, 10);
    if (!systems.length && !families.length) return [];
    return [
      ...(systems.length
        ? [
            "By vehicle system:",
            ...systems.map(
              (g) =>
                `  - ${g.label}: ${g.entries} diagnostics (${pct(g.share)} of coded diagnostics), ${g.distinctCodes} distinct codes, most common ${g.topCode ? named(g.topCode, g.topCodeName) : "n/a"} at ${g.topCodeEntries} occurrences. ${g.hint}`,
            ),
          ]
        : []),
      ...(families.length
        ? [
            "By code family:",
            ...families.map((g) => `  - ${g.label}: ${g.entries} diagnostics (${pct(g.share)}), ${g.distinctCodes} distinct codes.`),
          ]
        : []),
      `Generic (standardised) versus manufacturer-specific split: ${pct(dtc.totals.genericShare)} of code instances are generic SAE codes.`,
    ];
  },

  ftb_signal: ({ dtc }) => {
    if (!dtc) return [];
    if (!dtc.totals.withFtb) return [];
    return [
      `Diagnostics whose codes carried a failure-type byte: ${dtc.totals.withFtb} (${pct(dtc.totals.ftbShare)} of coded diagnostics).`,
      "What a failure-type byte is: an extra pair of characters appended to a fault code, for example P0299 versus P029900, specifying the nature of the failure (open circuit, short to ground, signal stuck high, implausible value) rather than only the affected component. Most code-lookup tools strip or ignore it, which is also why any analysis that does not collapse it double-counts the same underlying code.",
      ...(dtc.ftbs.length
        ? [
            "Most common failure types observed:",
            ...dtc.ftbs
              .slice(0, 10)
              .map((f) => `  - ${f.ftb}${f.name ? ` (${f.name})` : ""}: ${f.occurrences} occurrences, ${pct(f.share)} of codes carrying a byte, family ${f.familyLabel}${f.topCode ? `, most often on ${f.topCode}` : ""}.`),
          ]
        : []),
      ...(dtc.ftbFamilies.length
        ? [
            "Which code families most often carry one:",
            ...dtc.ftbFamilies.slice(0, 6).map((g) => `  - ${g.label}: ${pct(g.share)} of byte-carrying codes.`),
          ]
        : []),
    ];
  },

  spread_vs_concentrated: ({ dtc }) => {
    if (!dtc) return [];
    const wide = dtc.widestSpread.slice(0, 8);
    const narrow = dtc.mostConcentrated.slice(0, 8);
    if (!wide.length && !narrow.length) return [];
    // Workshop NAMES are deliberately omitted; only the shape of the
    // concentration is publishable.
    return [
      "Metric definition: distinct workshops is how many separate workshops entered that code. Concentration is the share of a code's total entries that came from its single busiest workshop, so a high concentration means one shop sees it constantly and others barely do.",
      ...(wide.length
        ? [
            "Most universal codes, seen across the widest set of workshops:",
            ...wide.map(
              (r) => `  - ${named(r.base, r.name)}: ${r.entries} entries spread across ${r.distinctWorkshops} workshops, busiest single workshop accounts for ${pct(r.topWorkshopShare)}.`,
            ),
          ]
        : []),
      ...(narrow.length
        ? [
            "Most concentrated codes, where one workshop dominates:",
            ...narrow.map(
              (r) => `  - ${named(r.base, r.name)}: ${r.entries} entries but only ${r.distinctWorkshops} workshops, busiest single workshop accounts for ${pct(r.topWorkshopShare)}.`,
            ),
          ]
        : []),
      "Privacy rule: never name or hint at which workshop. The point is the distribution, not the shop.",
    ];
  },

  tech_language: ({ terms }) => {
    if (!terms) return [];
    const t = terms.totals;
    return [
      `Diagnostics with a written description: ${t.described} of ${t.diagnostics} (${pct(t.coverage)}).`,
      `Typical description length: ${num(t.avgChars, 0)} characters on average, median ${t.medianChars}, 90th percentile ${t.p90Chars}, longest ${t.maxChars}. Average word count ${num(t.avgWords, 1)}.`,
      `Distinct description texts: ${t.distinctTexts}, of which ${t.repeatedTexts} were written more than once by different people.`,
      ...(terms.lengthBands.filter((b) => b.count > 0).length
        ? [
            "Length distribution:",
            ...terms.lengthBands
              .filter((b) => b.count > 0)
              .map((b) => `  - ${b.label}: ${b.count} (${pct(b.share)}). ${b.hint}`),
          ]
        : []),
      ...(terms.complaints.filter((b) => b.count > 0).length
        ? [
            "What the complaint actually is, in the technician's framing:",
            ...terms.complaints
              .filter((b) => b.count > 0)
              .slice(0, 12)
              .map((b) => `  - ${b.label}: ${b.count} descriptions (${pct(b.share)}). ${b.hint}`),
          ]
        : []),
      ...(terms.languages.filter((l) => l.entries > 0).length
        ? [
            "Language split:",
            ...terms.languages
              .filter((l) => l.entries > 0)
              .slice(0, 8)
              .map((l) => `  - ${l.language}: ${l.entries} descriptions (${pct(l.share)}), average ${num(l.avgChars, 0)} characters.`),
          ]
        : []),
      ...(terms.verbatims.length
        ? [
            "Most repeated descriptions, verbatim and clipped to a snippet (these may be quoted as illustration, but never attributed to a person, shop, or country, and never presented as a complete case):",
            ...terms.verbatims
              .slice(0, 12)
              .map((v) => `  - "${snippet(v.text)}" written ${v.count} times${v.languages.length ? ` (${v.languages.join(", ")})` : ""}.`),
          ]
        : []),
      ...(terms.bigrams.length
        ? [
            "Most common two-word phrases:",
            ...terms.bigrams.slice(0, 12).map((b) => `  - "${b.term}": ${b.entries} descriptions.`),
          ]
        : []),
      `Uncategorised descriptions (no recognised complaint pattern): ${terms.uncategorised.count}, of which ${terms.uncategorisedTooShort} were two words or fewer and so carried no complaint to recognise in the first place.`,
    ];
  },

  data_quality: ({ dtc }) => {
    if (!dtc) return [];
    const t = dtc.totals;
    const lines = [
      `Raw strings entered into the code field: ${t.rawEntries}. Readable code instances after parsing and de-duplication: ${t.codeOccurrences}.`,
      `Entries where something was typed but nothing resolved to a standard SAE code: ${t.noSaeCodeEntries}. These have codes as far as the technician is concerned and contribute nothing to any code aggregate.`,
      `Individual strings unreadable as a fault code at all: ${t.unparseableOccurrences}. Valid manufacturer-native codes with no SAE equivalent: ${t.manufacturerCodeOccurrences}.`,
      `Codes matched to a name in our dictionary: ${pct(t.namedShare)}. Dictionary size: ${t.dictionarySize} codes.`,
    ];
    if (dtc.defects.length) {
      lines.push("Recurring entry mistakes, with real examples:");
      for (const d of dtc.defects.slice(0, 8)) {
        const ex = d.examples.slice(0, 3).map((e) => `${e.raw} should be ${e.normalized}`).join("; ");
        lines.push(`  - ${d.label}: ${d.occurrences} occurrences. ${d.hint}${ex ? ` Examples: ${ex}.` : ""}`);
      }
    }
    if (dtc.manufacturerHex.length) {
      lines.push(
        `Manufacturer-native codes seen most often: ${dtc.manufacturerHex.slice(0, 8).map((o) => `${o.raw} (${o.count}x${o.makes.length ? `, ${o.makes.slice(0, 3).join("/")}` : ""})`).join(", ")}.`,
      );
    }
    lines.push(
      "Framing note: the point is that real input is messy and a tool has to cope, not that technicians type badly. Keep the tone on the engineering problem.",
    );
    return lines;
  },

  platform_scale: ({ dtc }) => {
    if (!dtc) return [];
    const t = dtc.totals;
    const monthly = dtc.monthly.filter((m) => m.diagnostics > 0).slice(-12);
    return [
      `Total diagnostics in the dataset: ${t.diagnostics}. Of those, ${t.withCodes} carried at least one readable fault code (${pct(t.coverage)} coverage).`,
      `Distinct base fault codes seen: ${t.distinctBaseCodes}. Total code instances: ${t.codeOccurrences}. Average codes per coded diagnostic: ${num(t.avgCodesPerEntry, 2)}.`,
      `Multi-code diagnostics: ${t.multiCodeEntries} (${pct(t.multiCodeShare)}). Code-only diagnostics with no description: ${t.codeOnlyEntries} (${pct(t.codeOnlyShare)}).`,
      ...(t.earliestDiagnosticAt && t.latestDiagnosticAt
        ? [`Data window: ${t.earliestDiagnosticAt.slice(0, 10)} to ${t.latestDiagnosticAt.slice(0, 10)}.`]
        : []),
      ...(monthly.length
        ? [
            "By month:",
            ...monthly.map(
              (m) =>
                `  - ${monthLabel(m.month)}: ${m.diagnostics} diagnostics, ${m.withCodes} with codes (${pct(m.coverage)}), ${m.codeOccurrences} code instances, ${num(m.avgCodesPerCodedEntry, 2)} codes per coded diagnostic.`,
            ),
          ]
        : []),
      "Honesty rule: these are absolute platform counts. Do not describe them as market share, industry totals, or growth rates unless the month series actually shows it.",
    ];
  },
};

/** Render a fact pack into the block handed to the model. */
export function renderFactPack(pack: StatFactPack): string {
  return [
    `STAT STORY: ${pack.label}`,
    ``,
    `The point to argue: ${pack.thesis}`,
    ``,
    `Sample and provenance: ${pack.sampleNote}`,
    ``,
    `The facts (every number below is real, measured from our own platform data; you may not add any number that is not here):`,
    ...pack.lines,
  ].join("\n");
}
