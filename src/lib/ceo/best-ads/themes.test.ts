import { describe, expect, it } from "vitest";
import { COPY_THEMES, summariseThemes, textBaseline } from "./themes";
import type { AssetRollupRow } from "./types";

function copy(
  text: string,
  impressions: number,
  clicks: number,
  conversions = 0,
): AssetRollupRow {
  return {
    assetId: text.slice(0, 12),
    assetType: "TEXT",
    kind: "text",
    name: null,
    text,
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    youtubeVideoId: null,
    youtubeVideoTitle: null,
    fieldType: "HEADLINE",
    surface: "ad_group_ad",
    impressions,
    clicks,
    costMicros: 0,
    conversions,
    conversionsValue: 0,
    campaignNames: [],
    channelTypes: [],
    firstDay: null,
    lastDay: null,
  };
}

describe("COPY_THEMES", () => {
  it("has unique keys", () => {
    const keys = COPY_THEMES.map((theme) => theme.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches on whole words, not fragments", () => {
    const ai = COPY_THEMES.find((theme) => theme.key === "ai")!;
    // "said", "aid", "chain" all contain the letters; none is an AI claim.
    expect(ai.pattern.test("Repairs made easy, said the chain")).toBe(false);
    expect(ai.pattern.test("AI for Car Mechanics")).toBe(true);
  });
});

describe("summariseThemes", () => {
  it("indexes a theme against all copy, not against itself", () => {
    const rows = [
      copy("AI for Car Mechanics", 10_000, 1_000),
      copy("Repair data for every vehicle", 10_000, 200),
    ];

    const themes = summariseThemes(rows);
    const ai = themes.find((theme) => theme.key === "ai")!;

    // Pool CTR is 1200/20000 = 6%; the AI line is 10%.
    expect(ai.ctr).toBeCloseTo(0.1);
    expect(ai.ctrIndex).toBeCloseTo(0.1 / 0.06, 5);
  });

  it("lets one asset belong to several angles", () => {
    const rows = [copy("Ask our AI Mechanic and get it right in seconds", 5_000, 300)];
    const keys = summariseThemes(rows).map((theme) => theme.key);

    expect(keys).toEqual(expect.arrayContaining(["ai", "audience", "speed", "accuracy"]));
  });

  it("only quotes examples that actually ran", () => {
    const rows = [
      copy("AI for Car Mechanics", 40, 20), // 50% CTR on 40 impressions
      copy("AI Driven Diagnostics Tool", 20_000, 800),
    ];

    const ai = summariseThemes(rows).find((theme) => theme.key === "ai")!;

    expect(ai.assets).toBe(2);
    expect(ai.examples).toHaveLength(1);
    expect(ai.examples[0].text).toBe("AI Driven Diagnostics Tool");
  });

  it("ranks an angle that converts above one that only clicks", () => {
    const rows = [
      // Clicks hard, never converts — the fault-code pattern in this account.
      copy("Instant Answers to DTC Codes", 100_000, 8_000, 5),
      copy("Fault code lookup for OBD2", 100_000, 7_000, 5),
      // Fewer clicks, far better signups.
      copy("Built for mechanics and workshops", 100_000, 3_000, 300),
      copy("For the technician in your garage", 100_000, 3_000, 300),
    ];

    const themes = summariseThemes(rows);
    const audience = themes.findIndex((theme) => theme.key === "audience");
    const faultcode = themes.findIndex((theme) => theme.key === "faultcode");

    expect(audience).toBeGreaterThanOrEqual(0);
    expect(faultcode).toBeGreaterThanOrEqual(0);
    expect(audience).toBeLessThan(faultcode);
  });

  it("ignores sitelink text, which carries the whole campaign's numbers", () => {
    // A sitelink is text, but a campaign-level asset is reported with the
    // campaign's impressions and clicks. Letting "Demo" into the pool would
    // credit an angle with traffic the copy never earned.
    const sitelink: AssetRollupRow = {
      ...copy("Demo", 58_712, 6_437, 0),
      surface: "campaign_asset",
      fieldType: "SITELINK",
    };
    const headline = copy("AI for Car Mechanics", 10_000, 500, 20);

    const withSitelink = summariseThemes([headline, sitelink]);
    const withoutSitelink = summariseThemes([headline]);

    expect(withSitelink).toEqual(withoutSitelink);
    expect(textBaseline([headline, sitelink]).impressions).toBe(10_000);
  });

  it("ignores images and video, which carry no copy to group", () => {
    const image: AssetRollupRow = {
      ...copy("unused", 50_000, 2_000),
      kind: "image",
      assetType: "IMAGE",
      text: null,
    };
    expect(summariseThemes([image])).toEqual([]);
  });

  it("returns nothing rather than dividing by zero on an empty window", () => {
    expect(summariseThemes([])).toEqual([]);
  });
});

describe("textBaseline", () => {
  it("pools only text assets", () => {
    const rows: AssetRollupRow[] = [
      copy("AI for Car Mechanics", 1_000, 50, 5),
      { ...copy("x", 9_000, 900, 90), kind: "image", assetType: "IMAGE", text: null },
    ];

    const baseline = textBaseline(rows);

    expect(baseline.assets).toBe(1);
    expect(baseline.impressions).toBe(1_000);
    expect(baseline.ctr).toBeCloseTo(0.05);
    expect(baseline.cvr).toBeCloseTo(0.1);
  });

  it("reports zero rates rather than NaN when nothing served", () => {
    const baseline = textBaseline([]);
    expect(baseline.ctr).toBe(0);
    expect(baseline.cvr).toBe(0);
  });
});
