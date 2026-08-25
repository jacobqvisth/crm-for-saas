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

export type FaultCodeBundle = {
  generatedFor: string;
  pages: FaultCodePage[];
  families: FamilyHubPage[];
  totals: { pages: number; families: number };
};

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
/** How many manufacturer-specific codes a family hub lists before it stops. */
export const MANUFACTURER_LIST_CAP = 40;

const TITLE_LIMIT = 88;
const BRAND_SUFFIX = " | Wrenchlane";

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

export function buildFaultCodeBundle(
  plan: LandingPlan,
  analysis: DtcAnalysis,
  generatedFor: string,
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

  return {
    generatedFor,
    pages,
    families,
    totals: { pages: pages.length, families: families.length },
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
