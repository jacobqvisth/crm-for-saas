import { describe, expect, it } from "vitest";
import type { DtcAnalysis, DtcCodeRow } from "@/lib/ceo/dtc/analyse";
import { dictionaryCodes } from "@/lib/ceo/dtc/dictionary";
import { AD_SURFACE_MAP, buildGaps, routingFixes } from "./kinds";
import {
  buildLandingPlan,
  FLAGSHIP_MIN_SESSIONS,
  LONG_TAIL_MIN_SESSIONS,
  priorityScore,
} from "./plan";
import { codeSlug, faultCodePath, slugToCode, textSlug } from "./slugs";
import { faultCodeSignupUrl, signupUrl, TRACKING_PARAMS } from "./tracking";
import { BUILDABLE_TIERS } from "./types";

function codeRow(over: Partial<DtcCodeRow> & { base: string }): DtcCodeRow {
  return {
    name: null,
    scope: "generic",
    familyKey: "misc",
    familyLabel: "Other",
    entries: 1,
    share: 0,
    distinctWorkshops: 1,
    topMake: null,
    topMakeEntries: 0,
    rawVariants: [],
    ftbs: [],
    chatRate: 0,
    avgCauses: 0,
    codeOnlyShare: 0,
    firstSeen: null,
    lastSeen: null,
    examples: [],
    ...over,
  };
}

function analysisWith(rows: DtcCodeRow[]): DtcAnalysis {
  // Only the fields buildLandingPlan reads need to be real; the rest of
  // DtcAnalysis is irrelevant here and is cast in rather than hand-built.
  return {
    topCodes: rows,
    pairs: [],
    makes: [],
  } as unknown as DtcAnalysis;
}

describe("slugs", () => {
  it("lowercases codes in URLs and round-trips", () => {
    expect(codeSlug("P0420")).toBe("p0420");
    expect(slugToCode("p0420")).toBe("P0420");
    expect(faultCodePath("P0420")).toBe("/en/fault-code/p0420");
    expect(faultCodePath("P0420", "sv")).toBe("/sv/fault-code/p0420");
  });

  it("folds Swedish characters rather than percent-encoding them", () => {
    expect(textSlug("Bränsle och avgaser")).toBe("bransle-och-avgaser");
    expect(textSlug("Citroën / DS")).toBe("citroen-ds");
    expect(textSlug("  trailing  ")).toBe("trailing");
  });
});

describe("tier rules", () => {
  it("never gives a manufacturer-specific code its own page", () => {
    // The whole honesty argument rests on this: P1525 means different things on
    // different marques, so no amount of volume should promote it.
    const plan = buildLandingPlan(
      analysisWith([
        codeRow({ base: "P1525", scope: "manufacturer", entries: 500 }),
      ]),
    );
    const row = plan.candidates.find((c) => c.code === "P1525");
    expect(row?.tier).toBe("excluded");
    expect(BUILDABLE_TIERS).not.toContain(row?.tier);
  });

  it("promotes a high-volume code to flagship even without a dictionary name", () => {
    const plan = buildLandingPlan(
      analysisWith([
        codeRow({ base: "P2XXX", entries: FLAGSHIP_MIN_SESSIONS }),
      ]),
    );
    expect(plan.candidates.find((c) => c.code === "P2XXX")?.tier).toBe(
      "flagship",
    );
  });

  it("puts a named code in core regardless of local volume", () => {
    // A named code we have never seen is still worth a page: the dictionary is
    // what makes the page honest, not our own traffic.
    const plan = buildLandingPlan(analysisWith([]));
    const named = plan.candidates.find((c) => c.code === "P0420");
    expect(named?.tier).toBe("core");
    expect(named?.sessions).toBe(0);
  });

  it("drops an unnamed single sighting below the floor", () => {
    const plan = buildLandingPlan(
      analysisWith([codeRow({ base: "P2ZZZ", entries: 1 })]),
    );
    expect(plan.candidates.find((c) => c.code === "P2ZZZ")?.tier).toBe(
      "below_floor",
    );
  });

  it("builds an unnamed code once it clears the long-tail floor", () => {
    const plan = buildLandingPlan(
      analysisWith([
        codeRow({ base: "P2ZZZ", entries: LONG_TAIL_MIN_SESSIONS }),
      ]),
    );
    expect(plan.candidates.find((c) => c.code === "P2ZZZ")?.tier).toBe(
      "long_tail",
    );
  });
});

describe("the candidate universe", () => {
  it("is the union of what we have seen and what we can name", () => {
    const plan = buildLandingPlan(
      analysisWith([codeRow({ base: "P2ZZZ", entries: 4 })]),
    );
    const codes = new Set(plan.candidates.map((c) => c.code));
    expect(codes.has("P2ZZZ")).toBe(true); // seen, not nameable
    expect(codes.has("P0420")).toBe(true); // nameable, not seen
    expect(plan.totals.universe).toBe(dictionaryCodes().length + 1);
  });

  it("counts every candidate into exactly one tier", () => {
    const plan = buildLandingPlan(
      analysisWith([
        codeRow({ base: "P0420", name: "Catalyst efficiency", entries: 46 }),
        codeRow({ base: "P1525", scope: "manufacturer", entries: 9 }),
        codeRow({ base: "P2ZZZ", entries: 1 }),
      ]),
    );
    const { flagship, core, longTail, belowFloor, excluded, universe } =
      plan.totals;
    expect(flagship + core + longTail + belowFloor + excluded).toBe(universe);
    expect(plan.totals.buildable).toBe(flagship + core + longTail);
  });

  it("orders the queue by priority, highest first", () => {
    const plan = buildLandingPlan(
      analysisWith([
        codeRow({ base: "P0300", entries: 86, distinctWorkshops: 40 }),
        codeRow({ base: "P0299", entries: 82, distinctWorkshops: 30 }),
      ]),
    );
    const priorities = plan.candidates.map((c) => c.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
    expect(plan.candidates[0]?.code).toBe("P0300");
  });
});

describe("priority score", () => {
  it("rewards breadth as well as volume", () => {
    const narrow = priorityScore({
      sessions: 10,
      workshops: 1,
      name: null,
      codeOnlyShare: 0,
    });
    const broad = priorityScore({
      sessions: 10,
      workshops: 9,
      name: null,
      codeOnlyShare: 0,
    });
    expect(broad).toBeGreaterThan(narrow);
  });

  it("rewards codes that arrive with no description", () => {
    // Nothing but a code in hand is the strongest proxy we have for someone who
    // would type that code into a search box.
    const withText = priorityScore({
      sessions: 5,
      workshops: 2,
      name: null,
      codeOnlyShare: 0,
    });
    const codeOnly = priorityScore({
      sessions: 5,
      workshops: 2,
      name: null,
      codeOnlyShare: 1,
    });
    expect(codeOnly).toBeGreaterThan(withText);
  });
});

describe("signup handoff", () => {
  it("carries the page identity and drops empty values", () => {
    const url = new URL(
      signupUrl({ landingPage: "p0420", pageKind: "fault_code" }),
    );
    expect(url.searchParams.get(TRACKING_PARAMS.landingPage)).toBe("p0420");
    expect(url.searchParams.get(TRACKING_PARAMS.pageKind)).toBe("fault_code");
    // An empty gclid is indistinguishable from a captured empty one downstream.
    expect(url.searchParams.has(TRACKING_PARAMS.gclid)).toBe(false);
  });

  it("sends code traffic to Free, not to a paid tier", () => {
    const url = new URL(faultCodeSignupUrl("P0420", "abc123"));
    expect(url.searchParams.get(TRACKING_PARAMS.plan)).toBe("free");
    expect(url.searchParams.get(TRACKING_PARAMS.gclid)).toBe("abc123");
  });
});

describe("the ad-to-page map", () => {
  it("has a unique key per surface", () => {
    const keys = AD_SURFACE_MAP.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("separates routing fixes from builds", () => {
    // The distinction is the point of the table: one costs nothing.
    expect(routingFixes().length).toBeGreaterThan(0);
    expect(buildGaps().length).toBeGreaterThan(0);
    for (const row of routingFixes()) {
      expect(row.state).toBe("exists_unrouted");
    }
  });

  it("names the competitor pages as built and misrouted", () => {
    const competitor = AD_SURFACE_MAP.find((row) => row.key === "competitor");
    expect(competitor?.state).toBe("exists_unrouted");
  });
});
