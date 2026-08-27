/**
 * Turning the build queue into page payloads.
 *
 * The queue in plan.ts decides which pages exist and in what order. This
 * decides what is actually on each one.
 *
 * WHY THE CONTENT IS DATA AND NOT PROSE
 *
 * The obvious way to fill four hundred pages is to ask a model to write four
 * hundred articles about four hundred codes. That produces four hundred pages
 * of plausible text, most of it reconstructed from the same public sources
 * everyone else already published, and any of it can be wrong in ways nobody
 * will notice until a technician acts on it.
 *
 * The thing we have that nobody else has is the evidence: how often this code
 * appeared in real diagnostics, which codes it travelled with and how strongly,
 * which makes sent it, how many separate workshops met it, how often it arrived
 * with no description at all. That is both the honest content and the
 * differentiated content, and it is the same answer to two different problems.
 * So a page is a rendering of measured facts plus a short factual gloss, not an
 * essay.
 *
 * It also means every page changes when the data changes, which is what stops
 * the cluster going stale the moment it ships.
 */

import type { DtcAnalysis, DtcCodeRow } from "@/lib/ceo/dtc/analyse";
import { normalizeMake } from "@/lib/ceo/dtc/analyse";
import type { DiagnosticListItem } from "@/lib/ceo/data/diagnostics";
import { parseDtcList } from "@/lib/ceo/dtc/parse";
import { DTC_SYSTEMS, classifyFamily, ftbName } from "@/lib/ceo/dtc/taxonomy";
import type { LandingCandidate, LandingTier } from "./types";
import type { LandingPlan } from "./plan";
import { baseCodeScope } from "@/lib/ceo/dtc/parse";
import { codeSlug, faultCodePath, textSlug } from "./slugs";

export type CompanionFact = {
  code: string;
  name: string | null;
  /** Diagnostics containing both codes. */
  together: number;
  /** How much more often than chance. 1.0 means no association. */
  lift: number;
  sameFamily: boolean;
  /**
   * Whether this companion has a page of its own.
   *
   * Co-occurrence is computed over every code we have seen, which includes the
   * manufacturer-specific ones we deliberately never give a page and the
   * one-sighting codes that sit below the floor. The association is real and
   * worth showing either way, so the fact stays; only the link is conditional.
   * Without this the exclusion rule leaks straight back out as a few dozen
   * links to pages that were deliberately not built.
   */
  hasPage: boolean;
  /** Manufacturer-specific companions get a note instead of a link. */
  scope: "generic" | "manufacturer";
};

export type FaultCodePage = {
  code: string;
  slug: string;
  path: string;
  tier: LandingTier;
  name: string | null;
  scope: "generic" | "manufacturer";
  systemLabel: string;
  systemHint: string;
  familyKey: string;
  familyLabel: string;
  familyPath: string;
  subsystemLabel: string | null;
  /** Failure-type bytes seen with this code, decoded where possible. */
  failureModes: { ftb: string; label: string | null }[];
  evidence: {
    sessions: number;
    workshops: number;
    codeOnlyShare: number;
    topMake: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  companions: CompanionFact[];
  /** Other codes in the same family that also have a page. */
  related: { code: string; name: string | null; path: string }[];
  meta: { title: string; description: string };
};

export type FamilyHubPage = {
  key: string;
  label: string;
  hint: string;
  path: string;
  pages: number;
  sessions: number;
  codes: { code: string; name: string | null; sessions: number; path: string }[];
  /**
   * Manufacturer-specific codes in this family. Listed as codes with no
   * description, which is the honest treatment: they exist, we have seen them,
   * and what they mean depends on the marque.
   */
  manufacturerCodes: string[];
  /**
   * How many manufacturer-specific codes this family really has.
   *
   * The list above is capped so the hub does not turn into a wall of codes. A
   * cap that is not stated reads as a complete list, so the total travels with
   * it and the page says how many it is not showing.
   */
  manufacturerCodesTotal: number;
  meta: { title: string; description: string };
};

export type MakeHubPage = {
  make: string;
  slug: string;
  path: string;
  /** Coded diagnostics we have seen on this marque. */
  diagnostics: number;
  distinctCodes: number;
  /**
   * Manufacturer-specific codes seen on this marque.
   *
   * This is the entire reason make hubs exist. These codes get no standalone
   * page anywhere on the site, because the same code means different things on
   * different marques. Scoped to one marque the question becomes answerable,
   * so this hub is their only honest home.
   */
  manufacturerCodes: { code: string; diagnostics: number }[];
  /** Standardised codes that skew to this marque, each with a page. */
  genericCodes: {
    code: string;
    name: string | null;
    diagnostics: number;
    path: string;
  }[];
  topFamilies: { label: string; diagnostics: number }[];
  meta: { title: string; description: string };
};

export type SystemHubPage = {
  key: string;
  label: string;
  hint: string;
  slug: string;
  path: string;
  pages: number;
  diagnostics: number;
  families: { key: string; label: string; pages: number; path: string }[];
  topCodes: { code: string; name: string | null; path: string }[];
  meta: { title: string; description: string };
};

export type FaultCodeBundle = {
  generatedFor: string;
  pages: FaultCodePage[];
  families: FamilyHubPage[];
  makes: MakeHubPage[];
  systems: SystemHubPage[];
  totals: {
    pages: number;
    families: number;
    makes: number;
    systems: number;
    /** Every URL the cluster produces, per locale. */
    urls: number;
  };
};

/** How many manufacturer-specific codes a family hub lists before it stops. */
export const MANUFACTURER_LIST_CAP = 40;

const TITLE_LIMIT = 88;
const BRAND_SUFFIX = " | Wrenchlane";

/**
 * Fit a title into the space a search result actually gives it.
 *
 * Google shows roughly 60 characters and truncates the rest with an ellipsis,
 * so anything past that is invisible to the person deciding whether to click.
 * Some standard code descriptions are genuinely long ("Turbocharger boost
 * control position sensor circuit range/performance"), which pushes the full
 * form well past 90.
 *
 * Two things give way, in order of how little they cost. The brand suffix goes
 * first, because someone searching a code is not searching for us and the
 * domain is shown separately anyway. Only if it still does not fit does the
 * description get trimmed, and then on a word boundary rather than mid-word.
 * The code itself is never touched: it is the entire reason the page ranks.
 */
function fitTitle(headline: string): string {
  const full = `${headline}${BRAND_SUFFIX}`;
  if (full.length <= TITLE_LIMIT) return full;
  if (headline.length <= TITLE_LIMIT) return headline;

  const trimmed = headline.slice(0, TITLE_LIMIT);
  const lastSpace = trimmed.lastIndexOf(" ");
  return (lastSpace > 20 ? trimmed.slice(0, lastSpace) : trimmed).replace(
    /[,\s/]+$/,
    "",
  );
}

/**
 * Title and description.
 *
 * Leads with the code, because that is the query. The description carries one
 * piece of evidence, because that is the only part of a search result that
 * distinguishes this page from the twenty other pages about the same code.
 *
 * No em or en dashes anywhere: they are stripped from generated text across
 * this codebase and a title is generated text like any other.
 */
function metaFor(row: LandingCandidate, seen: DtcCodeRow | undefined) {
  const system = DTC_SYSTEMS[row.code.charAt(0) as keyof typeof DTC_SYSTEMS];
  const headline = row.name
    ? `${row.code}: ${row.name}`
    : `${row.code}: ${system?.label ?? "Fault code"}, ${row.familyLabel.toLowerCase()}`;

  const evidence =
    seen && seen.entries > 0
      ? `Seen in ${seen.entries} real diagnostic${seen.entries === 1 ? "" : "s"} across ${seen.distinctWorkshops} workshop${seen.distinctWorkshops === 1 ? "" : "s"}.`
      : "";

  const gloss = row.name
    ? `What ${row.code} means, what it usually appears alongside, and where to start.`
    : `${row.code} is not individually documented in the standard. Here is what its structure does tell you, and what it appears alongside.`;

  return {
    title: fitTitle(headline),
    description: [gloss, evidence].filter(Boolean).join(" ").slice(0, 320),
  };
}

function companionsFor(
  analysis: DtcAnalysis,
  code: string,
  built: Set<string>,
): CompanionFact[] {
  return analysis.pairs
    .filter((pair) => pair.a === code || pair.b === code)
    .sort((left, right) => right.lift - left.lift)
    .slice(0, 6)
    .map((pair) => {
      const isA = pair.a === code;
      const other = isA ? pair.b : pair.a;
      return {
        code: other,
        name: isA ? pair.bName : pair.aName,
        together: pair.together,
        lift: Math.round(pair.lift * 10) / 10,
        sameFamily: pair.sameFamily,
        hasPage: built.has(other),
        scope: baseCodeScope(other),
      };
    });
}


/**
 * How many coded diagnostics a marque needs before it gets a hub.
 *
 * Below this a "make hub" is one shop's week rather than anything about the
 * marque, and the codes on it would be indistinguishable from noise. The same
 * floor the DTC dashboard uses for its make table, for the same reason.
 */
export const MAKE_HUB_MIN_DIAGNOSTICS = 8;

/** Manufacturer-specific codes a make hub lists before it stops. */
export const MAKE_CODE_LIST_CAP = 60;

/**
 * Make hubs, built from the raw diagnostics rather than the analysis.
 *
 * The analysis rolls makes up to one row each, which is enough for a dashboard
 * table and not enough for a page: a hub needs the actual codes seen on that
 * marque, and specifically the manufacturer-specific ones, which exist nowhere
 * else on the site by design.
 *
 * Marque strings are normalised with the same function the analysis uses.
 * Normalising differently here would silently split "VW" and "Volkswagen" into
 * two hubs that each look half-empty.
 */
export function buildMakeHubs(
  items: DiagnosticListItem[],
  plan: LandingPlan,
): MakeHubPage[] {
  const pageByCode = new Map(
    plan.candidates
      .filter((row) => row.tier !== "excluded" && row.tier !== "below_floor")
      .map((row) => [row.code, row]),
  );

  type Acc = {
    make: string;
    diagnostics: number;
    codes: Map<string, number>;
    families: Map<string, number>;
  };
  const byMake = new Map<string, Acc>();

  for (const item of items) {
    const make = normalizeMake(item.carMake);
    if (!make) continue;
    const bases = Array.from(
      new Set(
        parseDtcList(item.dtcs)
          .map((entry) => entry.base)
          .filter((base): base is string => Boolean(base)),
      ),
    );
    if (bases.length === 0) continue;

    let acc = byMake.get(make);
    if (!acc) {
      acc = { make, diagnostics: 0, codes: new Map(), families: new Map() };
      byMake.set(make, acc);
    }
    acc.diagnostics += 1;
    for (const base of bases) {
      acc.codes.set(base, (acc.codes.get(base) ?? 0) + 1);
      const family = classifyFamily(base);
      acc.families.set(
        family.label,
        (acc.families.get(family.label) ?? 0) + 1,
      );
    }
  }

  return Array.from(byMake.values())
    .filter((acc) => acc.diagnostics >= MAKE_HUB_MIN_DIAGNOSTICS)
    .map((acc) => {
      const ranked = Array.from(acc.codes.entries()).sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      );

      const manufacturerCodes = ranked
        .filter(([code]) => baseCodeScope(code) === "manufacturer")
        .slice(0, MAKE_CODE_LIST_CAP)
        .map(([code, diagnostics]) => ({ code, diagnostics }));

      const genericCodes = ranked
        .filter(([code]) => pageByCode.has(code))
        .slice(0, 40)
        .map(([code, diagnostics]) => {
          const row = pageByCode.get(code)!;
          return {
            code,
            name: row.name,
            diagnostics,
            path: row.path,
          };
        });

      const topFamilies = Array.from(acc.families.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 6)
        .map(([label, diagnostics]) => ({ label, diagnostics }));

      const slug = textSlug(acc.make);
      return {
        make: acc.make,
        slug,
        path: `/en/fault-code/make/${slug}`,
        diagnostics: acc.diagnostics,
        distinctCodes: acc.codes.size,
        manufacturerCodes,
        genericCodes,
        topFamilies,
        meta: {
          title: fitTitle(`${acc.make} fault codes`),
          description:
            `Fault codes we have seen on ${acc.make} across ${acc.diagnostics} real diagnostics, including the ${acc.make}-specific codes that no generic code list can decode.`.slice(
              0,
              320,
            ),
        },
      };
    })
    .sort((left, right) => right.diagnostics - left.diagnostics);
}


/**
 * One hub per code system: powertrain, body, chassis, network.
 *
 * The broadest honest grouping in the standard, and the top of the cluster's
 * link graph. Four pages, so this is cheap; its value is structural rather than
 * in the queries it catches, because it gives every family hub a parent and
 * gives a crawler an obvious route from the root to any code.
 */
export function buildSystemHubs(
  plan: LandingPlan,
  pages: FaultCodePage[],
  families: FamilyHubPage[],
): SystemHubPage[] {
  const systems = new Map<string, FaultCodePage[]>();
  for (const page of pages) {
    const key = page.code.charAt(0);
    const list = systems.get(key) ?? [];
    list.push(page);
    systems.set(key, list);
  }

  const familyByKey = new Map(families.map((family) => [family.key, family]));

  return Array.from(systems.entries())
    .map(([key, members]) => {
      const spec = DTC_SYSTEMS[key as keyof typeof DTC_SYSTEMS];
      const familyKeys = Array.from(
        new Set(members.map((page) => page.familyKey)),
      );
      const slug = key.toLowerCase();
      const diagnostics = members.reduce(
        (sum, page) => sum + page.evidence.sessions,
        0,
      );
      return {
        key,
        label: spec?.label ?? key,
        hint: spec?.hint ?? "",
        slug,
        path: `/en/fault-code/system/${slug}`,
        pages: members.length,
        diagnostics,
        families: familyKeys
          .map((familyKey) => familyByKey.get(familyKey))
          .filter((family): family is FamilyHubPage => Boolean(family))
          .map((family) => ({
            key: family.key,
            label: family.label,
            pages: family.pages,
            path: family.path,
          }))
          .sort((left, right) => right.pages - left.pages),
        topCodes: [...members]
          .sort((a, b) => b.evidence.sessions - a.evidence.sessions)
          .slice(0, 24)
          .map((page) => ({
            code: page.code,
            name: page.name,
            path: page.path,
          })),
        meta: {
          title: fitTitle(`${spec?.label ?? key} fault codes`),
          description:
            `Every standardised ${(spec?.label ?? key).toLowerCase()} fault code we have seen in real diagnostics, grouped by what part of the vehicle it concerns. ${members.length} documented.`.slice(
              0,
              320,
            ),
        },
      };
    })
    .sort((left, right) => right.pages - left.pages);
}

export function buildFaultCodeBundle(
  plan: LandingPlan,
  analysis: DtcAnalysis,
  generatedFor: string,
  /**
   * Required, not defaulted.
   *
   * This was `= []` for one commit and the emitter silently produced zero make
   * hubs, because a call site written before make hubs existed still
   * type-checked. A default that means "quietly build nothing" is worse than a
   * compile error.
   */
  items: DiagnosticListItem[],
): FaultCodeBundle {
  const seenByCode = new Map<string, DtcCodeRow>();
  for (const row of analysis.topCodes) seenByCode.set(row.base, row);

  const buildable = plan.candidates.filter(
    (row) =>
      row.tier === "flagship" || row.tier === "core" || row.tier === "long_tail",
  );

  // Family membership is needed before any page renders, because every page
  // links to its siblings and a page cannot know its siblings from its own row.
  const byFamily = new Map<string, LandingCandidate[]>();
  for (const row of buildable) {
    const list = byFamily.get(row.familyKey) ?? [];
    list.push(row);
    byFamily.set(row.familyKey, list);
  }

  // Which codes actually get a page. Needed before any page renders, because a
  // page cannot know from its own row whether the codes it co-occurs with were
  // built.
  const built = new Set(buildable.map((row) => row.code));

  const pages: FaultCodePage[] = buildable.map((row) => {
    const seen = seenByCode.get(row.code);
    const system = DTC_SYSTEMS[row.code.charAt(0) as keyof typeof DTC_SYSTEMS];
    const siblings = (byFamily.get(row.familyKey) ?? [])
      .filter((other) => other.code !== row.code)
      .slice(0, 8);

    return {
      code: row.code,
      slug: row.slug,
      path: row.path,
      tier: row.tier,
      name: row.name,
      scope: row.scope,
      systemLabel: system?.label ?? "Fault code",
      systemHint: system?.hint ?? "",
      familyKey: row.familyKey,
      familyLabel: row.familyLabel,
      familyPath: `/en/fault-code/family/${textSlug(row.familyKey)}`,
      subsystemLabel: row.subsystemLabel,
      failureModes: (seen?.ftbs ?? []).map((ftb) => ({
        ftb,
        label: ftbName(ftb),
      })),
      evidence: {
        sessions: seen?.entries ?? 0,
        workshops: seen?.distinctWorkshops ?? 0,
        codeOnlyShare: seen?.codeOnlyShare ?? 0,
        topMake: seen?.topMake ?? null,
        firstSeen: seen?.firstSeen ?? null,
        lastSeen: seen?.lastSeen ?? null,
      },
      companions: companionsFor(analysis, row.code, built),
      related: siblings.map((other) => ({
        code: other.code,
        name: other.name,
        path: other.path,
      })),
      meta: metaFor(row, seen),
    };
  });

  const families: FamilyHubPage[] = plan.families.map((family) => {
    const members = (byFamily.get(family.key) ?? []).slice();
    const spec = classifyFamily(members[0]?.code ?? "");
    const excludedInFamily = plan.candidates
      .filter((row) => row.tier === "excluded" && row.familyKey === family.key)
      .sort((left, right) => right.sessions - left.sessions);
    const manufacturerCodes = excludedInFamily
      .slice(0, MANUFACTURER_LIST_CAP)
      .map((row) => row.code);

    return {
      key: family.key,
      label: family.label,
      hint: spec.hint ?? "",
      path: `/en/fault-code/family/${textSlug(family.key)}`,
      pages: family.pages,
      sessions: family.sessions,
      codes: members.map((row) => ({
        code: row.code,
        name: row.name,
        sessions: row.sessions,
        path: row.path,
      })),
      manufacturerCodes,
      manufacturerCodesTotal: excludedInFamily.length,
      meta: {
        title: fitTitle(`${family.label} fault codes`),
        description: `Every ${family.label.toLowerCase()} code we have seen in real diagnostics, ranked by how often it turns up. ${family.pages} documented, plus the manufacturer-specific codes that belong to the same group.`.slice(
          0,
          320,
        ),
      },
    };
  });

  const makes = buildMakeHubs(items, plan);
  const systems = buildSystemHubs(plan, pages, families);

  return {
    generatedFor,
    pages,
    families,
    makes,
    systems,
    totals: {
      pages: pages.length,
      families: families.length,
      makes: makes.length,
      systems: systems.length,
      urls: pages.length + families.length + makes.length + systems.length + 1,
    },
  };
}

/** Sanity checks the emitter runs before anything is written to disk. */
export function validateBundle(bundle: FaultCodeBundle): string[] {
  const problems: string[] = [];
  const seenSlugs = new Set<string>();

  for (const page of bundle.pages) {
    if (seenSlugs.has(page.slug)) {
      problems.push(`duplicate slug: ${page.slug}`);
    }
    seenSlugs.add(page.slug);

    if (page.scope === "manufacturer") {
      // The single most important invariant in the whole programme.
      problems.push(
        `${page.code} is manufacturer-specific and must never get a standalone page`,
      );
    }
    if (page.slug !== codeSlug(page.code)) {
      problems.push(`${page.code} slug mismatch: ${page.slug}`);
    }
    if (page.path !== faultCodePath(page.code)) {
      problems.push(`${page.code} path mismatch: ${page.path}`);
    }
    if (page.meta.title.length > TITLE_LIMIT) {
      problems.push(`${page.code} title too long: ${page.meta.title.length}`);
    }
    if (!page.meta.title.startsWith(`${page.code}:`)) {
      // The code is the query. If a trim ever ate it, the page is pointless.
      problems.push(`${page.code} title does not lead with the code`);
    }
    if (/[—–]/.test(page.meta.title) || /[—–]/.test(page.meta.description)) {
      problems.push(`${page.code} meta contains a long dash`);
    }
  }

  // A companion that claims a page must have one. This is the check that would
  // have caught the exclusion rule leaking back out as broken links.
  for (const page of bundle.pages) {
    for (const companion of page.companions) {
      if (companion.hasPage && !seenSlugs.has(codeSlug(companion.code))) {
        problems.push(
          `${page.code} links to companion ${companion.code}, which has no page`,
        );
      }
    }
  }

  // Same rule as companions: a make hub may only link a code that has a page.
  // Third time this class of bug has come up, so it is asserted rather than
  // assumed.
  for (const make of bundle.makes) {
    for (const row of make.genericCodes) {
      if (!seenSlugs.has(codeSlug(row.code))) {
        problems.push(
          `make hub ${make.make} links ${row.code}, which has no page`,
        );
      }
    }
    for (const row of make.manufacturerCodes) {
      if (baseCodeScope(row.code) !== "manufacturer") {
        problems.push(
          `make hub ${make.make} lists ${row.code} as manufacturer-specific but it is generic`,
        );
      }
    }
  }

  // Two marques that produce the same slug means one hub silently overwrites
  // the other at build time, and the loss is invisible in the data. This is
  // what "Citroen" and "Citroen" with an accent did before normalizeMake
  // folded diacritics.
  const makeSlugs = new Set<string>();
  for (const make of bundle.makes) {
    if (makeSlugs.has(make.slug)) {
      problems.push(
        `two marques share the slug ${make.slug}; one hub would overwrite the other`,
      );
    }
    makeSlugs.add(make.slug);
  }

  const familyPaths = new Set(bundle.families.map((family) => family.path));
  for (const page of bundle.pages) {
    if (!familyPaths.has(page.familyPath)) {
      problems.push(
        `${page.code} links to family ${page.familyPath}, which has no hub`,
      );
    }
  }

  return problems;
}
