import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_CATALOG,
  findCatalogEntry,
  normalizeCampaignName,
} from "./campaigns-shared";

describe("normalizeCampaignName", () => {
  it("keeps real campaign names", () => {
    expect(normalizeCampaignName("Pmax eng may 2026")).toBe("Pmax eng may 2026");
    expect(normalizeCampaignName("  us-generic  ")).toBe("us-generic");
  });

  it("drops GA4 placeholder dimensions", () => {
    expect(normalizeCampaignName("(not set)")).toBeNull();
    expect(normalizeCampaignName("(organic)")).toBeNull();
    expect(normalizeCampaignName("")).toBeNull();
    expect(normalizeCampaignName("   ")).toBeNull();
  });

  it("drops bare numeric campaign ids", () => {
    // Real case: GA4 reported "23856272781" for two days alongside the named
    // "Pmax eng may 2026" rows for the same campaign. Treating it as its own
    // campaign would invent a phantom row.
    expect(normalizeCampaignName("23856272781")).toBeNull();
  });

  it("ignores non-strings", () => {
    expect(normalizeCampaignName(undefined)).toBeNull();
    expect(normalizeCampaignName(null)).toBeNull();
    expect(normalizeCampaignName(42)).toBeNull();
  });
});

describe("findCatalogEntry", () => {
  it("matches the live campaigns exactly as GA4 reports them", () => {
    // These two strings must stay byte-identical to the names in
    // dashboard_metric_snapshots.dimensions->>'campaign', including the EN
    // DASH (U+2013) in the Demand Gen name. If they drift, the page silently
    // shows zero users acquired for a campaign that is working fine.
    expect(findCatalogEntry("Pmax eng may 2026")?.type).toBe("performance_max");
    expect(findCatalogEntry("Demand Gen – 2026-06-16")?.type).toBe(
      "demand_gen",
    );
  });

  it("falls back to aliases for the hyphen spelling", () => {
    expect(findCatalogEntry("Demand Gen - 2026-06-16")?.type).toBe("demand_gen");
    expect(findCatalogEntry("Demand Gen")?.type).toBe("demand_gen");
  });

  it("is case-insensitive", () => {
    expect(findCatalogEntry("PMAX ENG MAY 2026")?.status).toBe("live");
  });

  it("returns null for campaigns we have not described", () => {
    expect(findCatalogEntry("some-new-campaign")).toBeNull();
  });
});

describe("CAMPAIGN_CATALOG integrity", () => {
  it("has no duplicate names", () => {
    const names = CAMPAIGN_CATALOG.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every campaign a rationale, so the page can explain itself", () => {
    for (const campaign of CAMPAIGN_CATALOG) {
      expect(campaign.rationale.length).toBeGreaterThan(20);
      expect(campaign.audience.length).toBeGreaterThan(10);
    }
  });

  it("points every plan-targeted campaign at a real landing page", () => {
    const planCampaigns = CAMPAIGN_CATALOG.filter((c) =>
      c.name.startsWith("WL Plan"),
    );
    expect(planCampaigns.length).toBeGreaterThan(0);
    for (const campaign of planCampaigns) {
      expect(campaign.landingPage).toMatch(/^wrenchlane\.com\/en\//);
      expect(campaign.type).toBe("search");
    }
  });
});
