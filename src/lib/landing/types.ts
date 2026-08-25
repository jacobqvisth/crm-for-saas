/**
 * Leaf types for the landing-page programme.
 *
 * No imports from sibling landing modules, so kinds.ts / plan.ts / slugs.ts can
 * all pull from here without a cycle (same arrangement as src/lib/articles and
 * src/lib/forums).
 */

/**
 * What job a page does. The distinction that matters is not the layout, it is
 * which query the page is allowed to claim, because that is what decides which
 * ad group is permitted to point at it.
 */
export type LandingPageKind =
  | "fault_code" // one standardised code, e.g. P0420
  | "fault_code_family" // a functional group, e.g. catalyst and emissions
  | "fault_code_system" // P / B / C / U
  | "make_hub" // manufacturer-specific codes, scoped to one make
  | "symptom" // plain-language complaint, no code in hand
  | "competitor" // us against one named rival
  | "plan" // one pricing tier
  | "qualifier" // asks which tier fits, then hands off
  | "brand"; // our own name

/**
 * Where a page stands today. `exists_unrouted` is the expensive one: the page is
 * built and indexed, and the ads that should feed it point somewhere else. It
 * costs nothing to fix and is worth naming separately for that reason.
 */
export type LandingPageState =
  | "live_and_routed"
  | "exists_unrouted"
  | "not_built"
  | "deliberately_not_built";

export const STATE_LABELS: Record<LandingPageState, string> = {
  live_and_routed: "Live and routed",
  exists_unrouted: "Built, ads point elsewhere",
  not_built: "Not built",
  deliberately_not_built: "Deliberately not built",
};

/**
 * How much page a code earns.
 *
 * The gate is honesty, not volume: a page is only buildable if we can say
 * something true and specific about the code. Volume then orders the queue.
 *
 *  flagship    enough measured demand to justify individual review and a full
 *              diagnostic walkthrough
 *  core        the dictionary names the fault, so the page can lead with what
 *              the code actually means
 *  long_tail   generic shape, unnamed, but taxonomy gives a system, a family, a
 *              subsystem and a failure-mode decode, and the code has been seen
 *              often enough that its co-occurrence data is not noise
 *  below_floor buildable in principle, not worth a page: one sighting, no name,
 *              nothing to say that the family hub does not say better
 *  excluded    manufacturer-specific. One description cannot serve P1525 on a
 *              Volvo and a Peugeot, so these never get a standalone page
 */
export type LandingTier =
  | "flagship"
  | "core"
  | "long_tail"
  | "below_floor"
  | "excluded";

export const TIER_LABELS: Record<LandingTier, string> = {
  flagship: "Flagship",
  core: "Core",
  long_tail: "Long tail",
  below_floor: "Below the floor",
  excluded: "Never standalone",
};

/** Tiers that actually become pages, in build order. */
export const BUILDABLE_TIERS: readonly LandingTier[] = [
  "flagship",
  "core",
  "long_tail",
];

/** One code, scored and placed in the build queue. */
export type LandingCandidate = {
  /** Five-character base code, failure-type byte already collapsed. */
  code: string;
  /** Dictionary name, or null when only the structural decode is available. */
  name: string | null;
  scope: "generic" | "manufacturer";
  familyKey: string;
  familyLabel: string;
  subsystemLabel: string | null;
  /** Diagnostics in our own product that carried this code. */
  sessions: number;
  /** Distinct workshops that submitted it. Breadth, not just volume. */
  workshops: number;
  /** Make that sends this code most often, when one dominates. */
  topMake: string | null;
  /** Codes this one travels with, strongest association first. */
  companions: string[];
  /** Share of this code's sessions that arrived with no description text. */
  codeOnlyShare: number;
  tier: LandingTier;
  /** Ranking score. Higher builds first. */
  priority: number;
  /** Why this tier, in one line, for the reviewer. */
  rationale: string;
  slug: string;
  path: string;
};

/** A group of candidate pages that share a template and a review pass. */
export type LandingBatch = {
  tier: LandingTier;
  label: string;
  pages: number;
  /** What the page leads with, and what it is honest about not knowing. */
  template: string;
  reviewRule: string;
};
