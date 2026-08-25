import { describe, expect, it } from "vitest";
import {
  BROAD_THEN_NARROW,
  FUNNEL_MAP,
  FUNNEL_MECHANICS,
  IMPROVEMENT_PLAN,
  PLAN_FACTS,
  WHY_TARGETING_IS_IMPRECISE,
  WHY_THIS_WORKS,
} from "./campaigns-info";
import { CAMPAIGN_CATALOG } from "./campaigns-shared";

describe("plan facts line up with the campaign catalog", () => {
  it("covers all four plans", () => {
    expect(PLAN_FACTS.map((p) => p.plan)).toEqual([
      "Free",
      "One",
      "Small",
      "Large",
    ]);
  });

  it("points at the same landing pages the campaigns use", () => {
    // If a plan page is ever renamed, the Info tab must not keep quoting the
    // old path while the campaigns quote the new one.
    const catalogPages = CAMPAIGN_CATALOG.filter((c) =>
      c.name.startsWith("WL Plan"),
    )
      .map((c) => c.landingPage)
      .filter((p): p is string => Boolean(p));

    for (const fact of PLAN_FACTS) {
      if (fact.plan === "Free") continue; // Free has no campaign of its own yet
      const path = fact.landingPage;
      const referenced = catalogPages.some((p) => p.endsWith(path));
      expect(referenced, `${fact.plan} page ${path}`).toBe(true);
    }
  });
});

describe("info content is actually populated", () => {
  const sections = {
    FUNNEL_MECHANICS,
    WHY_THIS_WORKS,
    WHY_TARGETING_IS_IMPRECISE,
    BROAD_THEN_NARROW,
  };

  for (const [name, points] of Object.entries(sections)) {
    it(`${name} has substantive points`, () => {
      expect(points.length).toBeGreaterThan(2);
      for (const point of points) {
        expect(point.heading.length, point.heading).toBeGreaterThan(8);
        // A one-line platitude is worse than nothing on a page a CEO reads.
        expect(point.body.length, point.heading).toBeGreaterThan(80);
      }
    });
  }
});

describe("the improvement plan is actionable", () => {
  it("is ordered and starts at phase 0", () => {
    expect(IMPROVEMENT_PLAN[0].phase).toBe("Phase 0");
    const phases = IMPROVEMENT_PLAN.map((p) => p.phase);
    expect(new Set(phases).size).toBe(phases.length);
  });

  it("gives every phase a reason and concrete actions", () => {
    for (const phase of IMPROVEMENT_PLAN) {
      expect(phase.why.length, phase.title).toBeGreaterThan(60);
      expect(phase.actions.length, phase.title).toBeGreaterThan(1);
      for (const action of phase.actions) {
        expect(action.length, `${phase.title}: "${action}"`).toBeGreaterThan(30);
      }
    }
  });

  it("uses only the three effort levels", () => {
    for (const phase of IMPROVEMENT_PLAN) {
      expect(["Low", "Medium", "High"]).toContain(phase.effort);
    }
  });
});

describe("funnel map", () => {
  it("covers every stage from awareness to expansion", () => {
    expect(FUNNEL_MAP.map((f) => f.stage)).toEqual([
      "Awareness",
      "Problem",
      "Evaluation",
      "Decision",
      "Expansion",
    ]);
  });

  it("names a page for every stage", () => {
    for (const stage of FUNNEL_MAP) {
      expect(stage.page.length, stage.stage).toBeGreaterThan(5);
      expect(stage.campaignType.length, stage.stage).toBeGreaterThan(5);
    }
  });
});
