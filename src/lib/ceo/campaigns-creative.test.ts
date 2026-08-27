import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_CREATIVE,
  SCAN_TOOL_NEGATIVES,
  creativeFor,
  keywordCount,
  keywordText,
  matchTypeOf,
} from "./campaigns-creative";
import { CAMPAIGN_CATALOG, isTabbed } from "./campaigns-shared";

describe("keyword parsing", () => {
  it("reads Google's match-type notation", () => {
    expect(matchTypeOf("[alldata alternative]")).toBe("Exact");
    expect(matchTypeOf('"garage diagnostic software"')).toBe("Phrase");
    expect(matchTypeOf("car repair")).toBe("Broad");
  });

  it("strips the notation for display", () => {
    expect(keywordText("[alldata alternative]")).toBe("alldata alternative");
    expect(keywordText('"garage diagnostic software"')).toBe(
      "garage diagnostic software",
    );
    expect(keywordText("car repair")).toBe("car repair");
  });
});

describe("creative mirrors what Google will accept", () => {
  // These limits are Google's, not ours. Copy that violates them would be
  // rejected at upload, so a mirror showing it would be lying about what runs.
  it("keeps every headline within 30 characters", () => {
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        for (const headline of group.headlines) {
          expect(
            headline.length,
            `${campaign} / ${group.name}: "${headline}"`,
          ).toBeLessThanOrEqual(30);
        }
      }
    }
  });

  it("keeps every description within 90 characters", () => {
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        for (const description of group.descriptions) {
          expect(
            description.length,
            `${campaign} / ${group.name}`,
          ).toBeLessThanOrEqual(90);
        }
      }
    }
  });

  it("respects Google's 3-15 headline and 2-4 description counts", () => {
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        expect(group.headlines.length, campaign).toBeGreaterThanOrEqual(3);
        expect(group.headlines.length, campaign).toBeLessThanOrEqual(15);
        expect(group.descriptions.length, campaign).toBeGreaterThanOrEqual(2);
        expect(group.descriptions.length, campaign).toBeLessThanOrEqual(4);
      }
    }
  });

  it("has no duplicate headlines inside an ad group", () => {
    // Reusing proven PMax headlines makes an accidental duplicate easy, and
    // Google rejects the whole ad when it happens.
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        const unique = new Set(group.headlines);
        expect(unique.size, `${campaign} / ${group.name}`).toBe(
          group.headlines.length,
        );
      }
    }
  });

  it("has no duplicate descriptions inside an ad group", () => {
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        const unique = new Set(group.descriptions);
        expect(unique.size, `${campaign} / ${group.name}`).toBe(
          group.descriptions.length,
        );
      }
    }
  });

  it("gives every ad group at least one keyword", () => {
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        expect(group.keywords.length, `${campaign} / ${group.name}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("creative lines up with the catalog", () => {
  it("has creative for every WL Plan campaign", () => {
    const planCampaigns = CAMPAIGN_CATALOG.filter((c) =>
      c.name.startsWith("WL Plan"),
    );
    expect(planCampaigns.length).toBe(4);
    for (const campaign of planCampaigns) {
      expect(creativeFor(campaign.name).length, campaign.name).toBeGreaterThan(0);
    }
  });

  it("returns nothing for campaigns we do not own the creative for", () => {
    // PMax and Demand Gen assets live in Google, not here.
    expect(creativeFor("Pmax eng may 2026")).toEqual([]);
    expect(creativeFor("nonsense")).toEqual([]);
  });

  it("counts keywords across ad groups", () => {
    // Small has two ad groups: five on the plan terms, twenty on the competitor
    // terms. The alternatives group grew twice: once when keywords live in the
    // account but absent from this mirror were added back, and again on
    // 2026-08-27 when nine price-intent terms were added because the search
    // terms report showed that intent already arriving.
    expect(keywordCount("WL Plan | Small")).toBe(25);
    expect(keywordCount("WL Plan | One")).toBe(5);
    // Large buys five plan phrases plus four rival names.
    expect(keywordCount("WL Plan | Large")).toBe(9);
  });
});

/**
 * These are the tests that would have caught the 2026-08-27 findings weeks
 * earlier. Every one encodes a fact about the live pricing pages, so ad copy
 * that drifts away from what the page promises fails here instead of running.
 */
describe("creative does not contradict the pricing pages", () => {
  // Read off wrenchlane.com/en/pricing on 2026-08-27. Update these when the
  // page changes, and the copy assertions below will point at whatever needs
  // rewriting.
  const PLAN_FACTS = {
    "WL Plan | One": { price: "$19", yearly: "$5", vehicles: null },
    "WL Plan | Small": { price: "$79", yearly: "$58", vehicles: "50" },
    "WL Plan | Large": { price: "$249", yearly: "$183", vehicles: "200" },
  } as const;

  const linesOf = (campaign: string) =>
    creativeFor(campaign).flatMap((g) => [...g.headlines, ...g.descriptions]);

  it("quotes no dollar figure that is not one of the plan's real prices", () => {
    // The bug this catches for real: Large ran "AI Diagnostics, $195/Month"
    // against a page saying $249. A wrong price in a live ad is the most
    // expensive kind of stale copy.
    for (const [campaign, facts] of Object.entries(PLAN_FACTS)) {
      const allowed = new Set(
        [facts.price, facts.yearly].filter(Boolean) as string[],
      );
      for (const line of linesOf(campaign)) {
        for (const found of line.match(/\$\d[\d,]*/g) ?? []) {
          expect(
            allowed.has(found),
            `${campaign} quotes ${found}, page says ${[...allowed].join(" or ")}: "${line}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("quotes the right monthly vehicle allowance, or none", () => {
    // Large also ran "80 Premium Vehicles/Month" against a page saying 200.
    for (const [campaign, facts] of Object.entries(PLAN_FACTS)) {
      if (!facts.vehicles) continue;
      for (const line of linesOf(campaign)) {
        // Only the number attached to the word "vehicles" counts. Matching
        // every digit in the line would flag the price in "200 vehicles a
        // month, unlimited mechanics. $249/month."
        for (const m of line.matchAll(/(\d[\d,]*)\s+(?:premium\s+)?vehicles/gi)) {
          expect(
            m[1] === facts.vehicles,
            `${campaign} says ${m[1]} vehicles, page says ${facts.vehicles}: "${line}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("promises money-back only on ONE, the only tier that carries it", () => {
    // Paid plans bill from day one. Small and Large both promised a 14-day
    // money-back guarantee their landing pages no longer offer, which is a
    // policy risk rather than merely stale copy.
    for (const campaign of ["WL Plan | Small", "WL Plan | Large"]) {
      for (const line of linesOf(campaign)) {
        expect(
          /money.?back/i.test(line),
          `${campaign} promises money-back: "${line}"`,
        ).toBe(false);
      }
    }
    expect(
      linesOf("WL Plan | One").some((l) => /money.?back/i.test(l)),
      "ONE should still advertise its guarantee",
    ).toBe(true);
  });

  it("never sells a seat or mechanic count on the workshop plans", () => {
    // Every paid tier says "Unlimited users". Copy that counts mechanics prices
    // honesty rather than usage, and it contradicts the page outright.
    // See the wrenchlane-never-price-per-seat rule.
    for (const campaign of ["WL Plan | Small", "WL Plan | Large"]) {
      for (const line of linesOf(campaign)) {
        expect(
          /\b\d+\s*(-|to|and)?\s*\d*\s*(mechanics?|technicians?|users?|seats?)\b/i.test(
            line,
          ),
          `${campaign} counts seats: "${line}"`,
        ).toBe(false);
      }
    }
  });
});

describe("keyword routing", () => {
  it("routes only keywords the ad group actually buys", () => {
    // A route pointing at a keyword that is not in the group is dead config:
    // it looks like the competitor traffic is handled when it is not.
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        for (const keyword of Object.keys(group.keywordRoutes ?? {})) {
          expect(
            group.keywords,
            `${campaign} / ${group.name} routes "${keyword}" but does not buy it`,
          ).toContain(keyword);
        }
      }
    }
  });

  it("routes every competitor term to a comparison page, not a plan page", () => {
    // The whole point of the 2026-08-27 change. Six rival names were bought
    // across two ad groups and every one landed on the generic /en/small,
    // while fifteen comparison pages sat published and indexed.
    const rivals = [
      "alldata",
      "autodata",
      "mitchell 1",
      "prodemand",
      "identifix",
      "haynespro",
    ];
    for (const [campaign, groups] of Object.entries(CAMPAIGN_CREATIVE)) {
      for (const group of groups) {
        for (const keyword of group.keywords) {
          const text = keywordText(keyword).toLowerCase();
          if (!rivals.some((r) => text.includes(r))) continue;
          const route = group.keywordRoutes?.[keyword];
          expect(
            route,
            `${campaign} / ${group.name}: "${keyword}" has no comparison-page route`,
          ).toBeTruthy();
          expect(route, `${keyword} should point at a /vs/ page`).toContain(
            "/en/vs/",
          );
        }
      }
    }
  });

  it("keeps compared-against brands out of the negative list", () => {
    // Autel, Bosch and Snap-on look like scan-tool hardware terms but each has
    // a published comparison page, so blocking them would throw away real
    // competitor intent. This is the trap the negative list has to avoid.
    for (const brand of ["autel", "bosch", "snap-on", "snap on"]) {
      expect(
        SCAN_TOOL_NEGATIVES.some((n) => n.includes(brand)),
        `${brand} has a comparison page and must stay biddable`,
      ).toBe(false);
    }
  });

  it("blocks the hardware terms the search terms report actually showed", () => {
    for (const term of ["topdon", "carly", "icarsoft", "vcds", "forscan"]) {
      expect(SCAN_TOOL_NEGATIVES, term).toContain(term);
    }
  });
});

describe("tab selection", () => {
  it("excludes retired campaigns from tabs", () => {
    const tabbed = CAMPAIGN_CATALOG.filter(isTabbed);
    expect(tabbed.every((c) => c.status !== "retired")).toBe(true);
    expect(tabbed.length).toBeLessThan(CAMPAIGN_CATALOG.length);
  });

  it("keeps every live, paused and planned campaign", () => {
    for (const campaign of CAMPAIGN_CATALOG) {
      if (campaign.status === "retired") continue;
      expect(isTabbed(campaign), campaign.name).toBe(true);
    }
  });
});
