import { afterEach, describe, expect, it } from "vitest";
import { stableDimensionKey } from "@/lib/ceo/metrics/dimensions";
import {
  insightMetricPoints,
  keywordMetricPoints,
  monthPeriod,
  resolveGeoTargets,
  searchTermMetricPoints,
} from "./google-ads-api";

const MONTH = {
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-01T00:00:00.000Z"),
};

function byKey<T extends { metricKey: string }>(points: T[], key: string) {
  return points.filter((point) => point.metricKey === key);
}

describe("monthPeriod", () => {
  it("stamps the month containing the last full day of the window", () => {
    // Half-open window: end is exclusive, so 2026-09-01 covers up to Aug 31.
    const period = monthPeriod({
      start: new Date("2026-08-02T00:00:00.000Z"),
      end: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(period.periodStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(period.periodEnd.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    const period = monthPeriod({
      start: new Date("2026-12-02T00:00:00.000Z"),
      end: new Date("2027-01-01T00:00:00.000Z"),
    });

    expect(period.periodStart.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(period.periodEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is stable across syncs within the same month, so rows upsert", () => {
    const early = monthPeriod({
      start: new Date("2026-07-05T00:00:00.000Z"),
      end: new Date("2026-08-04T00:00:00.000Z"),
    });
    const later = monthPeriod({
      start: new Date("2026-07-20T00:00:00.000Z"),
      end: new Date("2026-08-19T00:00:00.000Z"),
    });

    expect(early.periodStart.toISOString()).toBe(later.periodStart.toISOString());
    expect(early.periodEnd.toISOString()).toBe(later.periodEnd.toISOString());
  });
});

describe("keywordMetricPoints", () => {
  it("maps avg monthly searches, competition and both bid bounds", () => {
    const points = keywordMetricPoints(
      [
        {
          text: "misfire",
          keywordMetrics: {
            avgMonthlySearches: "18100",
            competitionIndex: "42",
            lowTopOfPageBidMicros: "310000",
            highTopOfPageBidMicros: "1250000",
          },
        },
      ],
      "DE",
      MONTH,
    );

    expect(byKey(points, "keyword_avg_monthly_searches")[0].value).toBe(18100);
    expect(byKey(points, "keyword_competition_index")[0].value).toBe(42);
    // Micros must become currency units, not stay as raw micros.
    expect(byKey(points, "keyword_top_of_page_bid_low")[0].value).toBeCloseTo(0.31);
    expect(byKey(points, "keyword_top_of_page_bid_high")[0].value).toBeCloseTo(1.25);
  });

  it("tags a seeded keyword with its cluster and a novel one as discovered", () => {
    const [seeded] = keywordMetricPoints(
      [{ text: "misfire", keywordMetrics: { avgMonthlySearches: "10" } }],
      "SE",
      MONTH,
    );
    const [novel] = keywordMetricPoints(
      [
        {
          text: "some term we never seeded",
          keywordMetrics: { avgMonthlySearches: "10" },
        },
      ],
      "SE",
      MONTH,
    );

    expect(seeded.dimensions?.cluster).toBe("generic_en");
    expect(novel.dimensions?.cluster).toBe("discovered");
  });

  it("lowercases and trims so the same term does not split into two rows", () => {
    const [point] = keywordMetricPoints(
      [{ text: "  MISFIRE  ", keywordMetrics: { avgMonthlySearches: "5" } }],
      "SE",
      MONTH,
    );

    expect(point.dimensions?.keyword).toBe("misfire");
    expect(point.dimensions?.cluster).toBe("generic_en");
  });

  it("keeps zero-volume keywords, since absent demand is a real finding", () => {
    const points = keywordMetricPoints(
      [{ text: "felkod", keywordMetrics: { avgMonthlySearches: "0" } }],
      "SE",
      MONTH,
    );

    expect(byKey(points, "keyword_avg_monthly_searches")).toHaveLength(1);
    expect(byKey(points, "keyword_avg_monthly_searches")[0].value).toBe(0);
  });

  it("skips results with no metrics or no text rather than writing zeros", () => {
    const points = keywordMetricPoints(
      [
        { text: "misfire", keywordMetrics: null },
        { text: "", keywordMetrics: { avgMonthlySearches: "99" } },
        { keywordMetrics: { avgMonthlySearches: "99" } },
      ],
      "SE",
      MONTH,
    );

    expect(points).toHaveLength(0);
  });

  it("omits optional metrics that Google did not return", () => {
    const points = keywordMetricPoints(
      [{ text: "misfire", keywordMetrics: { avgMonthlySearches: "10" } }],
      "SE",
      MONTH,
    );

    expect(byKey(points, "keyword_competition_index")).toHaveLength(0);
    expect(byKey(points, "keyword_top_of_page_bid_low")).toHaveLength(0);
  });

  it("gives the same keyword in two countries distinct dimension keys", () => {
    const [se] = keywordMetricPoints(
      [{ text: "misfire", keywordMetrics: { avgMonthlySearches: "1" } }],
      "SE",
      MONTH,
    );
    const [de] = keywordMetricPoints(
      [{ text: "misfire", keywordMetrics: { avgMonthlySearches: "2" } }],
      "DE",
      MONTH,
    );

    // Same (source, metric, period) means only dimension_key keeps them apart.
    expect(stableDimensionKey(se.dimensions)).not.toBe(
      stableDimensionKey(de.dimensions),
    );
  });
});

describe("searchTermMetricPoints", () => {
  it("emits one day-bounded row per metric with cost converted from micros", () => {
    const points = searchTermMetricPoints([
      {
        searchTermView: { searchTerm: "obd2 scanner" },
        segments: { date: "2026-08-03" },
        campaign: { name: "us-generic", id: "123" },
        metrics: {
          impressions: "420",
          clicks: "17",
          costMicros: "5500000",
          conversions: 2,
        },
      },
    ]);

    expect(byKey(points, "paid_search_term_impressions")[0].value).toBe(420);
    expect(byKey(points, "paid_search_term_clicks")[0].value).toBe(17);
    expect(byKey(points, "paid_search_term_cost")[0].value).toBeCloseTo(5.5);
    expect(byKey(points, "paid_search_term_conversions")[0].value).toBe(2);

    const [first] = points;
    expect(first.periodStart.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(first.periodEnd.toISOString()).toBe("2026-08-04T00:00:00.000Z");
    expect(first.dimensions?.campaign).toBe("us-generic");
  });

  it("skips rows missing a term or a date, which would collapse onto one key", () => {
    const points = searchTermMetricPoints([
      { segments: { date: "2026-08-03" }, metrics: { impressions: "5" } },
      { searchTermView: { searchTerm: "x" }, metrics: { impressions: "5" } },
    ]);

    expect(points).toHaveLength(0);
  });

  it("labels an unnamed campaign rather than dropping the row", () => {
    const points = searchTermMetricPoints([
      {
        searchTermView: { searchTerm: "p0300" },
        segments: { date: "2026-08-03" },
        metrics: { impressions: "3" },
      },
    ]);

    expect(points[0].dimensions?.campaign).toBe("unknown");
  });
});

describe("insightMetricPoints", () => {
  it("maps Pmax search categories onto the month", () => {
    const points = insightMetricPoints(
      [
        {
          campaignSearchTermInsight: { categoryLabel: "car diagnostics" },
          metrics: { impressions: "9000", clicks: "120", conversions: 4 },
        },
      ],
      "Pmax eng may 2026",
      MONTH,
    );

    expect(byKey(points, "pmax_search_category_impressions")[0].value).toBe(9000);
    expect(byKey(points, "pmax_search_category_clicks")[0].value).toBe(120);
    expect(byKey(points, "pmax_search_category_conversions")[0].value).toBe(4);
    expect(points[0].dimensions?.campaign).toBe("Pmax eng may 2026");
  });

  it("skips rows with no category label", () => {
    expect(
      insightMetricPoints(
        [{ campaignSearchTermInsight: {}, metrics: { impressions: "5" } }],
        "Pmax",
        MONTH,
      ),
    ).toHaveLength(0);
  });
});

describe("resolveGeoTargets", () => {
  afterEach(() => {
    delete process.env.GOOGLE_ADS_GEO_TARGETS;
  });

  it("defaults to the EU market list", () => {
    const targets = resolveGeoTargets();
    expect(targets.length).toBeGreaterThan(1);
    // 2000 + ISO 3166-1 numeric, so Sweden (752) is 2752.
    expect(targets.find((geo) => geo.country === "SE")?.id).toBe("2752");
    expect(targets.find((geo) => geo.country === "DE")?.id).toBe("2276");
  });

  it("honours an env override and keeps known country labels", () => {
    process.env.GOOGLE_ADS_GEO_TARGETS = "2752, 2276";
    const targets = resolveGeoTargets();

    expect(targets).toEqual([
      { id: "2752", country: "SE" },
      { id: "2276", country: "DE" },
    ]);
  });

  it("falls back to the raw id when the override is not a known market", () => {
    process.env.GOOGLE_ADS_GEO_TARGETS = "2840";
    expect(resolveGeoTargets()).toEqual([{ id: "2840", country: "2840" }]);
  });
});
