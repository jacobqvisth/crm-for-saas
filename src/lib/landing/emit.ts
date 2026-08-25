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
import { codeSlug, faultCodePath, textSlug } from "./slugs";

export type CompanionFact = {
  code: string;
  name: string | null;
  /** Diagnostics containing both codes. */
  together: number;
  /** How much more often than chance. 1.0 means no association. */
  lift: number;
  sameFamily: boolean;
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
  meta: { title: string; description: string };
};

export type FaultCodeBundle = {
  generatedFor: string;
  pages: FaultCodePage[];
  families: FamilyHubPage[];
  totals: { pages: number; families: number };
};

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
    title: `${headline} | Wrenchlane`,
    description: [gloss, evidence].filter(Boolean).join(" ").slice(0, 320),
  };
}

function companionsFor(
  analysis: DtcAnalysis,
  code: string,
): CompanionFact[] {
  return analysis.pairs
    .filter((pair) => pair.a === code || pair.b === code)
    .sort((left, right) => right.lift - left.lift)
    .slice(0, 6)
    .map((pair) => {
      const isA = pair.a === code;
      return {
        code: isA ? pair.b : pair.a,
        name: isA ? pair.bName : pair.aName,
        together: pair.together,
        lift: Math.round(pair.lift * 10) / 10,
        sameFamily: pair.sameFamily,
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
      companions: companionsFor(analysis, row.code),
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
    const manufacturerCodes = plan.candidates
      .filter(
        (row) => row.tier === "excluded" && row.familyKey === family.key,
      )
      .sort((left, right) => right.sessions - left.sessions)
      .slice(0, 40)
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
      meta: {
        title: `${family.label} fault codes | Wrenchlane`,
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
    if (page.meta.title.length > 90) {
      problems.push(`${page.code} title too long: ${page.meta.title.length}`);
    }
    if (/[—–]/.test(page.meta.title) || /[—–]/.test(page.meta.description)) {
      problems.push(`${page.code} meta contains a long dash`);
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
