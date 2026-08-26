import { describe, expect, it } from "vitest";
import {
  COMPETITOR_TARGETS,
  competitorAdGroupName,
  competitorKeywords,
  UNMATCHED_COMPETITOR_TERMS,
  unfedCompetitors,
} from "./ad-targets";
import { planCompetitorSync, type ObservedAdGroup } from "./ads-sync";

function group(over: Partial<ObservedAdGroup> & { name: string }): ObservedAdGroup {
  return {
    resourceName: `customers/1/adGroups/${over.name}`,
    id: over.name,
    campaignName: "WL Plan | Small",
    status: "ENABLED",
    finalUrls: ["https://wrenchlane.com/small"],
    keywords: [],
    ...over,
  };
}

describe("competitor registry", () => {
  it("covers all fifteen live comparison pages", () => {
    expect(COMPETITOR_TARGETS).toHaveLength(15);
  });

  it("uses verified paths, not names turned into slugs", () => {
    // These three are exactly the cases where guessing from the rival's name
    // would have produced a 404, which is worse than the generic page.
    const byKey = new Map(COMPETITOR_TARGETS.map((t) => [t.key, t.path]));
    expect(byKey.get("mitchell1-prodemand")).toBe("/en/vs/mitchell1-prodemand");
    expect(byKey.get("jayda-ai")).toBe("/en/vs/jayda-ai");
    expect(byKey.get("autel-maxisys")).toBe("/en/vs/autel-maxisys");
  });

  it("has a unique key and path per rival", () => {
    const keys = COMPETITOR_TARGETS.map((t) => t.key);
    const paths = COMPETITOR_TARGETS.map((t) => t.path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("counts ten pages with no ads pointing at them", () => {
    // Five rivals are bought by the Small plan alternatives ad group and all
    // five land on the generic plan page. Read from the account, not from the
    // hand-maintained ad-copy mirror, which lists only four.
    expect(unfedCompetitors()).toHaveLength(10);
    expect(COMPETITOR_TARGETS.filter((t) => t.currentlyBid)).toHaveLength(5);
  });

  it("records competitor keywords that have no page to send them to", () => {
    // A reconciler that only reports what it can fix hides what it cannot.
    expect(UNMATCHED_COMPETITOR_TERMS).toContain("shopkey");
    const paths = COMPETITOR_TARGETS.map((t) => t.path).join(" ");
    for (const term of UNMATCHED_COMPETITOR_TERMS) {
      expect(paths).not.toContain(term);
    }
  });

  it("bids the rival name exact and the intent variants phrase", () => {
    const keywords = competitorKeywords(COMPETITOR_TARGETS[0]);
    expect(keywords[0].matchType).toBe("EXACT");
    expect(keywords.slice(1).every((k) => k.matchType === "PHRASE")).toBe(true);
  });
});

describe("the reconciler", () => {
  it("splits an ad group that buys several rivals, rather than retargeting it", () => {
    // The bug this guards: an ad group has ONE final URL. Emitting a retarget
    // per rival would apply them in sequence, leave the group pointing at
    // whichever ran last, and report success while the rest stayed misrouted.
    // Observed on the live account, where Small | alternatives buys five.
    const plan = planCompetitorSync([
      group({
        name: "Small | alternatives",
        keywords: ["[alldata alternative]", "[haynespro alternative]"],
        finalUrls: ["https://wrenchlane.com/en/small"],
      }),
    ]);

    expect(plan.actions.filter((a) => a.kind === "retarget")).toHaveLength(0);
    const splits = plan.actions.filter((a) => a.kind === "split");
    expect(splits).toHaveLength(1);
    const split = splits[0];
    if (split.kind !== "split") throw new Error("expected a split");
    expect(split.rivals.map((r) => r.to).sort()).toEqual([
      "https://wrenchlane.com/en/vs/alldata",
      "https://wrenchlane.com/en/vs/haynespro",
    ]);
    // A split is still a violation: that traffic is landing wrong right now.
    expect(plan.violations).toBe(1);
  });

  it("retargets an ad group that buys exactly one rival", () => {
    const plan = planCompetitorSync([
      group({
        name: "Small | alternatives",
        keywords: ["[alldata alternative]"],
        finalUrls: ["https://wrenchlane.com/en/small"],
      }),
    ]);
    const retargets = plan.actions.filter((a) => a.kind === "retarget");
    expect(retargets).toHaveLength(1);
    const only = retargets[0];
    if (only.kind !== "retarget") throw new Error("expected a retarget");
    expect(only.to).toBe("https://wrenchlane.com/en/vs/alldata");
  });

  it("does not also propose creating an ad group for a rival already bought", () => {
    // Otherwise a split would be reported alongside "nothing points at this",
    // which contradicts itself.
    const plan = planCompetitorSync([
      group({
        name: "Small | alternatives",
        keywords: ["[alldata alternative]", "[haynespro alternative]"],
      }),
    ]);
    const created = plan.actions
      .filter((a) => a.kind === "create_ad_group")
      .map((a) => (a.kind === "create_ad_group" ? a.adGroupName : ""));
    expect(created).not.toContain("Competitor | ALLDATA");
    expect(created).not.toContain("Competitor | HaynesPro");
    expect(plan.creates).toBe(13);
  });

  it("matches on what a group buys, not on what it is called", () => {
    // The account names ad groups by plan, and the plan axis is the thing that
    // is wrong, so the keyword text has to be the ground truth.
    const plan = planCompetitorSync([
      group({
        name: "Something Unrelated",
        keywords: ["[identifix alternative]"],
        finalUrls: ["https://wrenchlane.com/large"],
      }),
    ]);
    expect(
      plan.actions.some(
        (a) => a.kind === "retarget" && a.to.endsWith("/en/vs/identifix"),
      ),
    ).toBe(true);
  });

  it("leaves a correctly routed group alone", () => {
    const plan = planCompetitorSync([
      group({
        name: "Competitor | ALLDATA",
        keywords: ["[alldata]"],
        finalUrls: ["https://wrenchlane.com/en/vs/alldata"],
      }),
    ]);
    expect(plan.actions.some((a) => a.kind === "ok")).toBe(true);
    expect(
      plan.actions.some(
        (a) => a.kind === "retarget" && a.to.endsWith("/en/vs/alldata"),
      ),
    ).toBe(false);
  });

  it("tolerates a trailing slash on the current URL", () => {
    const plan = planCompetitorSync([
      group({
        name: "Competitor | Qira",
        keywords: ["[qira]"],
        finalUrls: ["https://wrenchlane.com/en/vs/qira/"],
      }),
    ]);
    const qira = plan.actions.filter(
      (a) => a.kind !== "create_ad_group" && a.adGroupName === "Competitor | Qira",
    );
    expect(qira.every((a) => a.kind === "ok")).toBe(true);
  });

  it("proposes an ad group for every rival nobody bids on", () => {
    const plan = planCompetitorSync([]);
    expect(plan.creates).toBe(COMPETITOR_TARGETS.length);
    const names = plan.actions
      .filter((a) => a.kind === "create_ad_group")
      .map((a) => a.adGroupName);
    expect(names).toContain(competitorAdGroupName(COMPETITOR_TARGETS[0]));
  });

  it("reports ad groups the programme says nothing about rather than touching them", () => {
    const plan = planCompetitorSync([
      group({ name: "Brand | exact", keywords: ["[wrenchlane]"] }),
    ]);
    expect(plan.unmanaged).toContain("Brand | exact");
    expect(
      plan.actions.some(
        (a) => a.kind === "retarget" && a.adGroupName === "Brand | exact",
      ),
    ).toBe(false);
  });
});
