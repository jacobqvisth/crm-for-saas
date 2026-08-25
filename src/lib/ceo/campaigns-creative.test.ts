import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_CREATIVE,
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
    // Small has two ad groups of five.
    expect(keywordCount("WL Plan | Small")).toBe(10);
    expect(keywordCount("WL Plan | One")).toBe(5);
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
