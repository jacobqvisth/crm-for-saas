/**
 * Turning the fault-code analysis into a build queue.
 *
 * The input is the same `DtcAnalysis` that /dashboard/dtc-codes already
 * computes, so this module adds no queries, no tables and no migration. It is
 * pure: hand it an analysis, get back a ranked list of pages to build.
 *
 * THE TWO DECISIONS THIS FILE ENCODES
 *
 * 1. Eligibility is about honesty, not volume. A code earns a page when we can
 *    say something true and specific about it. That is why manufacturer-specific
 *    codes are excluded outright rather than ranked low: P1525 genuinely means
 *    different things on a Volvo and a Peugeot, so any single page about it
 *    would be a confident wrong answer at scale. This is the same doctrine
 *    dictionary.ts already applies on the dashboard, carried through to the
 *    public site where the cost of being wrong is higher.
 *
 * 2. Volume orders the queue, it does not open the gate. Our own diagnostics are
 *    a better demand signal than a keyword tool, because they come from exactly
 *    the population we sell to rather than from everyone who owns a car. But a
 *    code we have seen once is still searched constantly by people who are not
 *    our users yet, so a low count is a reason to build later, not never.
 *
 * WHY THERE IS A FLOOR AT ALL
 *
 * A few hundred pages that each say something real is a content cluster. A few
 * hundred pages that each restate a template with one variable swapped is a
 * doorway-page set, and Google has been explicit about what happens to those.
 * The floor is where the honest thing to publish stops being a page and starts
 * being a row on the family hub.
 */

import type { DtcAnalysis, DtcCodeRow } from "@/lib/ceo/dtc/analyse";
import { codeName, dictionaryCodes } from "@/lib/ceo/dtc/dictionary";
import { classifyFamily, powertrainSubsystem } from "@/lib/ceo/dtc/taxonomy";
import { baseCodeScope } from "@/lib/ceo/dtc/parse";
import { codeSlug, faultCodePath } from "./slugs";
import {
  BUILDABLE_TIERS,
  type LandingBatch,
  type LandingCandidate,
  type LandingTier,
} from "./types";

/**
 * Sessions at which a code stops sharing a template and gets individual review.
 *
 * Nine codes clear this today. That is deliberately a small number: the point of
 * the tier is that a human reads every page in it before it ships, and a tier
 * nobody has time to review is the same as no tier.
 */
export const FLAGSHIP_MIN_SESSIONS = 20;

/**
 * Sessions an unnamed code needs before its own data is worth a page.
 *
 * Below two sightings there is no co-occurrence pattern, no workshop spread and
 * no make skew: everything the page could say would come from the taxonomy,
 * which is to say from the family it belongs to, which already has a page.
 */
export const LONG_TAIL_MIN_SESSIONS = 2;

export type LandingPlanTotals = {
  /** Distinct base codes considered: seen in our data, or nameable, or both. */
  universe: number;
  seenLocally: number;
  namedOnly: number;
  generic: number;
  manufacturer: number;
  flagship: number;
  core: number;
  longTail: number;
  belowFloor: number;
  excluded: number;
  /** Pages the queue would actually produce. */
  buildable: number;
  /** Hub pages on top of the per-code set. */
  hubs: number;
  totalPages: number;
  /**
   * Share of all code sightings that land on a page we would build. The number
   * that matters: it says how much real demand the floor throws away.
   */
  sightingsCovered: number;
};

export type FamilyPlanRow = {
  key: string;
  label: string;
  pages: number;
  sessions: number;
  topCode: string | null;
};

export type MakePlanRow = {
  make: string;
  codes: number;
  sessions: number;
  manufacturerCodes: number;
};

export type LandingPlan = {
  candidates: LandingCandidate[];
  batches: LandingBatch[];
  totals: LandingPlanTotals;
  families: FamilyPlanRow[];
  makes: MakePlanRow[];
};

function tierFor(row: {
  scope: "generic" | "manufacturer";
  name: string | null;
  sessions: number;
}): { tier: LandingTier; rationale: string } {
  if (row.scope === "manufacturer") {
    return {
      tier: "excluded",
      rationale:
        "Manufacturer-specific. The same code means different things on different marques, so it belongs on a make-scoped hub, never on a page of its own.",
    };
  }
  if (row.sessions >= FLAGSHIP_MIN_SESSIONS) {
    return {
      tier: "flagship",
      rationale: `Seen in ${row.sessions} of our own diagnostics. Enough real cases to write a walkthrough from evidence rather than from a template.`,
    };
  }
  if (row.name) {
    return {
      tier: "core",
      rationale:
        "Standardised and named, so the page can open by answering what the code means before it sells anything.",
    };
  }
  if (row.sessions >= LONG_TAIL_MIN_SESSIONS) {
    return {
      tier: "long_tail",
      rationale: `Not individually documented, but ${row.sessions} sightings give it its own companions, makes and workshop spread. The page says what is known and hands the rest to the family hub.`,
    };
  }
  return {
    tier: "below_floor",
    rationale:
      "One sighting and no description. Everything a page could say comes from the family, so it goes on the family hub as a row instead.",
  };
}

/**
 * Ranking score.
 *
 * Volume dominates, but two other signals earn weight. Workshop spread
 * separates a code that fifteen shops meet from one that a single shop met
 * fifteen times. And `codeOnlyShare` is the closest thing we have to a search
 * intent signal: a diagnostic submitted with a code and no description at all
 * is someone who has nothing to go on but the code, which is exactly the person
 * who types it into a search box.
 */
export function priorityScore(row: {
  sessions: number;
  workshops: number;
  name: string | null;
  codeOnlyShare: number;
}): number {
  return Math.round(
    row.sessions * 10 +
      row.workshops * 4 +
      (row.name ? 30 : 0) +
      row.codeOnlyShare * 20,
  );
}

/** Codes that travel with this one, strongest association first. */
function companionsFor(analysis: DtcAnalysis, code: string): string[] {
  return analysis.pairs
    .filter((pair) => pair.a === code || pair.b === code)
    .sort((left, right) => right.lift - left.lift)
    .map((pair) => (pair.a === code ? pair.b : pair.a))
    .slice(0, 5);
}

function candidateFrom(
  analysis: DtcAnalysis,
  code: string,
  seen: DtcCodeRow | undefined,
): LandingCandidate {
  const name = seen?.name ?? codeName(code);
  const scope = seen?.scope ?? baseCodeScope(code);
  const family = classifyFamily(code);
  const subsystem = powertrainSubsystem(code);
  const sessions = seen?.entries ?? 0;
  const workshops = seen?.distinctWorkshops ?? 0;
  const codeOnlyShare = seen?.codeOnlyShare ?? 0;
  const { tier, rationale } = tierFor({ scope, name, sessions });

  return {
    code,
    name,
    scope,
    familyKey: seen?.familyKey ?? family.key,
    familyLabel: seen?.familyLabel ?? family.label,
    subsystemLabel: subsystem?.label ?? null,
    sessions,
    workshops,
    topMake: seen?.topMake ?? null,
    companions: companionsFor(analysis, code),
    codeOnlyShare,
    tier,
    priority: priorityScore({ sessions, workshops, name, codeOnlyShare }),
    rationale,
    slug: codeSlug(code),
    path: faultCodePath(code),
  };
}

export function buildLandingPlan(analysis: DtcAnalysis): LandingPlan {
  const seenByCode = new Map<string, DtcCodeRow>();
  for (const row of analysis.topCodes) seenByCode.set(row.base, row);

  // The universe is the union of what we have seen and what we can name. A
  // named code with no local sightings is still a page worth building; a code
  // we have seen but cannot name still gets a structural page if it is common
  // enough. Neither list alone is the right answer.
  const universe = new Set<string>([
    ...seenByCode.keys(),
    ...dictionaryCodes(),
  ]);

  const candidates = Array.from(universe)
    .map((code) => candidateFrom(analysis, code, seenByCode.get(code)))
    .sort(
      (left, right) =>
        right.priority - left.priority || left.code.localeCompare(right.code),
    );

  const count = (tier: LandingTier) =>
    candidates.filter((row) => row.tier === tier).length;

  const buildable = candidates.filter((row) =>
    BUILDABLE_TIERS.includes(row.tier),
  );

  const totalSightings = candidates.reduce((sum, row) => sum + row.sessions, 0);
  const coveredSightings = buildable.reduce(
    (sum, row) => sum + row.sessions,
    0,
  );

  // Hubs: one per family that has at least one page under it, one per system
  // present, and one per make with enough coded volume to say anything.
  const familyMap = new Map<string, FamilyPlanRow>();
  for (const row of buildable) {
    const existing = familyMap.get(row.familyKey);
    if (existing) {
      existing.pages += 1;
      existing.sessions += row.sessions;
      continue;
    }
    familyMap.set(row.familyKey, {
      key: row.familyKey,
      label: row.familyLabel,
      pages: 1,
      sessions: row.sessions,
      topCode: null,
    });
  }
  // `candidates` is already priority-sorted, so the first buildable code seen
  // for a family is that family's strongest page.
  for (const row of buildable) {
    const family = familyMap.get(row.familyKey);
    if (family && !family.topCode) family.topCode = row.code;
  }
  const families = Array.from(familyMap.values()).sort(
    (left, right) => right.sessions - left.sessions || right.pages - left.pages,
  );

  const excludedByMake = candidates.filter((row) => row.tier === "excluded");
  const makes: MakePlanRow[] = analysis.makes.map((make) => ({
    make: make.make,
    codes: make.codeOccurrences,
    sessions: make.entries,
    // Manufacturer-specific codes are the reason make hubs exist, so the row
    // shows how much of the excluded set each make is carrying.
    manufacturerCodes: excludedByMake.filter(
      (row) => row.topMake === make.make,
    ).length,
  }));

  const systems = new Set(buildable.map((row) => row.code.charAt(0)));
  const hubs = families.length + systems.size + makes.length;

  const batches: LandingBatch[] = [
    {
      tier: "flagship",
      label: "Flagship code pages",
      pages: count("flagship"),
      template:
        "Full diagnostic walkthrough grounded in real cases: what the code means, what it travels with, which makes send it, what to check in order, and how often it arrives with nothing else to go on.",
      reviewRule: "Every page read by a human before it ships.",
    },
    {
      tier: "core",
      label: "Named code pages",
      pages: count("core"),
      template:
        "Opens with what the code means, then the structural decode, the companion codes and the family context. Converts second, after the question is answered.",
      reviewRule:
        "Reviewed in batches by family, so a wrong claim about a subsystem is caught once rather than three hundred times.",
    },
    {
      tier: "long_tail",
      label: "Structural code pages",
      pages: count("long_tail"),
      template:
        "States plainly that the code is not individually documented, gives the system, family, subsystem and failure-mode decode, shows its own companions and makes, and routes onward to the family hub.",
      reviewRule:
        "Spot-checked per family. Published only after the tier above has been indexed and measured.",
    },
  ];

  return {
    candidates,
    batches,
    families,
    makes,
    totals: {
      universe: universe.size,
      seenLocally: seenByCode.size,
      namedOnly: candidates.filter((row) => row.sessions === 0).length,
      generic: candidates.filter((row) => row.scope === "generic").length,
      manufacturer: candidates.filter((row) => row.scope === "manufacturer")
        .length,
      flagship: count("flagship"),
      core: count("core"),
      longTail: count("long_tail"),
      belowFloor: count("below_floor"),
      excluded: count("excluded"),
      buildable: buildable.length,
      hubs,
      totalPages: buildable.length + hubs,
      sightingsCovered:
        totalSightings === 0 ? 0 : coveredSightings / totalSightings,
    },
  };
}
