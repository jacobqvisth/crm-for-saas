import { describe, expect, it } from "vitest";
import {
  buildBaselines,
  rankBy,
  scoreAssets,
  CTR_PRIOR_IMPRESSIONS,
} from "./ranking";
import type { AssetRollupRow } from "./types";

function row(overrides: Partial<AssetRollupRow> & { assetId: string }): AssetRollupRow {
  return {
    assetType: "TEXT",
    kind: "text",
    name: null,
    text: overrides.assetId,
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    youtubeVideoId: null,
    youtubeVideoTitle: null,
    fieldType: "HEADLINE",
    surface: "ad_group_ad",
    impressions: 0,
    clicks: 0,
    costMicros: 0,
    conversions: 0,
    conversionsValue: 0,
    campaignNames: [],
    channelTypes: [],
    firstDay: null,
    lastDay: null,
    ...overrides,
  };
}

describe("buildBaselines", () => {
  it("keeps field types apart so formats are never compared to each other", () => {
    const baselines = buildBaselines([
      row({ assetId: "h1", fieldType: "HEADLINE", impressions: 1000, clicks: 50 }),
      row({ assetId: "v1", fieldType: "YOUTUBE_VIDEO", impressions: 1000, clicks: 10 }),
    ]);

    expect(baselines.get("ad_group_ad:HEADLINE")?.ctr).toBeCloseTo(0.05);
    expect(baselines.get("ad_group_ad:YOUTUBE_VIDEO")?.ctr).toBeCloseTo(0.01);
  });

  it("keeps the two report surfaces apart", () => {
    // campaign_asset clicks belong to the asset; ad_group_ad clicks belong to
    // the ad. Pooling them would compare a sitelink to a headline.
    const baselines = buildBaselines([
      row({ assetId: "a", fieldType: "SITELINK", surface: "campaign_asset", impressions: 100, clicks: 10 }),
      row({ assetId: "b", fieldType: "SITELINK", surface: "ad_group_ad", impressions: 100, clicks: 1 }),
    ]);

    expect(baselines.size).toBe(2);
    expect(baselines.get("campaign_asset:SITELINK")?.ctr).toBeCloseTo(0.1);
    expect(baselines.get("ad_group_ad:SITELINK")?.ctr).toBeCloseTo(0.01);
  });
});

describe("scoreAssets", () => {
  it("does not let a tiny sample outrank a proven asset", () => {
    // The exact failure this shrinkage exists to prevent: 1 click on 8
    // impressions is a 12.5% CTR, more than double the proven asset's 5%, and
    // any raw sort puts it first.
    const { scored } = scoreAssets([
      row({ assetId: "fluke", impressions: 8, clicks: 1 }),
      row({ assetId: "proven", impressions: 300_000, clicks: 15_000 }),
      row({ assetId: "filler", impressions: 200_000, clicks: 6_000 }),
    ]);

    const fluke = scored.find((a) => a.assetId === "fluke")!;
    const proven = scored.find((a) => a.assetId === "proven")!;

    expect(fluke.ctr).toBeGreaterThan(proven.ctr);
    expect(proven.ctrLift).toBeGreaterThan(fluke.ctrLift);
  });

  it("scores a no-evidence asset as exactly average", () => {
    const { scored } = scoreAssets([
      row({ assetId: "empty", impressions: 0, clicks: 0 }),
      row({ assetId: "big", impressions: 100_000, clicks: 4_000 }),
    ]);

    expect(scored.find((a) => a.assetId === "empty")!.ctrLift).toBeCloseTo(1, 5);
  });

  it("pulls an asset halfway to the baseline at exactly the prior weight", () => {
    // A direct check of the shrinkage arithmetic: with evidence equal to the
    // prior, the estimate should sit midway between observed and baseline.
    const { scored } = scoreAssets([
      row({
        assetId: "half",
        impressions: CTR_PRIOR_IMPRESSIONS,
        clicks: CTR_PRIOR_IMPRESSIONS * 0.1,
      }),
      row({ assetId: "bulk", impressions: 1_000_000, clicks: 50_000 }),
    ]);

    const half = scored.find((a) => a.assetId === "half")!;
    const baseline =
      (CTR_PRIOR_IMPRESSIONS * 0.1 + 50_000) / (CTR_PRIOR_IMPRESSIONS + 1_000_000);
    const expected = (0.1 + baseline) / 2 / baseline;

    expect(half.ctrLift).toBeCloseTo(expected, 5);
  });

  it("does not reward clicks that never converted", () => {
    // The account's real lesson: us-codes+make bought 13,505 clicks and zero
    // signups. A CTR-only ranking would have promoted exactly that copy.
    const { scored } = scoreAssets([
      row({ assetId: "clickbait", impressions: 100_000, clicks: 8_000, conversions: 0 }),
      row({ assetId: "seller", impressions: 100_000, clicks: 4_000, conversions: 200 }),
    ]);

    const clickbait = scored.find((a) => a.assetId === "clickbait")!;
    const seller = scored.find((a) => a.assetId === "seller")!;

    expect(clickbait.ctrLift).toBeGreaterThan(seller.ctrLift);
    expect(seller.score).toBeGreaterThan(clickbait.score);
    expect(clickbait.clicksWithoutConversions).toBe(true);
    expect(seller.clicksWithoutConversions).toBe(false);
  });

  it("reports a lift of 1 rather than 0 when nothing of a type ever converted", () => {
    const { scored } = scoreAssets([
      row({ assetId: "a", impressions: 10_000, clicks: 500, conversions: 0 }),
      row({ assetId: "b", impressions: 10_000, clicks: 200, conversions: 0 }),
    ]);

    for (const asset of scored) {
      expect(asset.cvrLift).toBe(1);
      expect(asset.score).toBeGreaterThan(0);
    }
  });

  it("converts micros to currency units and derives cost per conversion", () => {
    const { scored } = scoreAssets([
      row({ assetId: "a", impressions: 1000, clicks: 100, costMicros: 5_000_000_000, conversions: 20 }),
    ]);

    expect(scored[0].costSek).toBe(5000);
    expect(scored[0].costPerConversionSek).toBe(250);
  });

  it("leaves cost per conversion null rather than dividing by zero", () => {
    const { scored } = scoreAssets([
      row({ assetId: "a", impressions: 1000, clicks: 100, costMicros: 1_000_000 }),
    ]);

    expect(scored[0].costPerConversionSek).toBeNull();
  });

  it("flags the display threshold without excluding the row", () => {
    const { scored } = scoreAssets([
      row({ assetId: "small", impressions: 100, clicks: 5 }),
      row({ assetId: "big", impressions: 5_000, clicks: 250 }),
    ]);

    expect(scored.find((a) => a.assetId === "small")!.hasEnoughVolume).toBe(false);
    expect(scored.find((a) => a.assetId === "big")!.hasEnoughVolume).toBe(true);
    expect(scored).toHaveLength(2);
  });
});

describe("rankBy", () => {
  const { scored } = scoreAssets([
    row({ assetId: "clicky", impressions: 50_000, clicks: 5_000, conversions: 5 }),
    row({ assetId: "converty", impressions: 50_000, clicks: 1_500, conversions: 150 }),
    row({ assetId: "huge", impressions: 900_000, clicks: 27_000, conversions: 100 }),
  ]);

  it("puts the click winner first on ctr", () => {
    expect(rankBy(scored, "ctr")[0].assetId).toBe("clicky");
  });

  it("puts the signup winner first on conversions", () => {
    expect(rankBy(scored, "conversions")[0].assetId).toBe("converty");
  });

  it("puts the most-served asset first on volume", () => {
    expect(rankBy(scored, "volume")[0].assetId).toBe("huge");
  });

  it("breaks ties on impressions so the better-evidenced asset leads", () => {
    const { scored: tied } = scoreAssets([
      row({ assetId: "thin", impressions: 1_000, clicks: 50 }),
      row({ assetId: "thick", impressions: 80_000, clicks: 4_000 }),
    ]);
    // Identical rates, so score ties and only the tiebreak separates them.
    expect(rankBy(tied, "score")[0].assetId).toBe("thick");
  });

  it("does not mutate the array it was given", () => {
    const before = scored.map((a) => a.assetId);
    rankBy(scored, "volume");
    expect(scored.map((a) => a.assetId)).toEqual(before);
  });
});
