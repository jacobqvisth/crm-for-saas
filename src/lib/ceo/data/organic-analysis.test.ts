import { describe, expect, it, vi } from "vitest";
import { buildFindings, detectCliff } from "./organic-analysis";

function series(
  values: number[],
  start = new Date("2026-07-01T00:00:00.000Z"),
): { date: string; impressions: number }[] {
  return values.map((impressions, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    return { date: day.toISOString().slice(0, 10), impressions };
  });
}

describe("detectCliff", () => {
  // The real guides.wrenchlane.com collapse: the subdomain ramped through
  // July, peaked on the 22nd, then fell to near-zero and stayed there.
  const GUIDES = [
    6, 208, 1055, 967, 800, 1163, 1117, 1281, 1125, 1123, 1069, 1107, 1493,
    1518, 2045, 344, 25, 43, 44, 34, 24, 36, 17, 34, 16, 7, 1,
  ];

  it("finds a sustained collapse and reports the drop", () => {
    const cliff = detectCliff("guides.wrenchlane.com", series(GUIDES, new Date("2026-07-08T00:00:00.000Z")));

    expect(cliff).not.toBeNull();
    expect(cliff!.host).toBe("guides.wrenchlane.com");
    expect(cliff!.date).toBe("2026-07-24");
    expect(cliff!.dropPct).toBeGreaterThan(90);
    expect(cliff!.beforeRate).toBeGreaterThan(1000);
    expect(cliff!.afterRate).toBeLessThan(100);
  });

  it("ignores a flat but noisy series", () => {
    const flat = series(
      Array.from({ length: 30 }, (_, index) => 900 + ((index * 37) % 180)),
    );
    expect(detectCliff("wrenchlane.com", flat)).toBeNull();
  });

  it("ignores a gradual decline with no step change", () => {
    const gradual = series(
      Array.from({ length: 40 }, (_, index) => Math.round(1000 - index * 15)),
    );
    expect(detectCliff("wrenchlane.com", gradual)).toBeNull();
  });

  it("ignores hosts that were never material", () => {
    // Same 97% shape, but at a volume nobody should be paged about.
    const tiny = series([...Array(10).fill(20), ...Array(10).fill(0)]);
    expect(detectCliff("app.wrenchlane.com", tiny)).toBeNull();
  });

  it("returns null when the series is too short to judge", () => {
    expect(detectCliff("wrenchlane.com", series([5000, 5000, 0, 0]))).toBeNull();
  });

  it("picks the largest drop when a series steps down twice", () => {
    const twoSteps = series([
      ...Array(8).fill(1000),
      ...Array(8).fill(600),
      ...Array(8).fill(20),
    ]);
    const cliff = detectCliff("wrenchlane.com", twoSteps);

    expect(cliff).not.toBeNull();
    // 600 -> 20 is a steeper relative fall than 1000 -> 600.
    expect(cliff!.dropPct).toBeGreaterThan(90);
  });
});

const EMPTY_ARGS = {
  totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
  hosts: [],
  cliffs: [],
  buckets: [],
  branded: [],
  monthlyByHost: [],
  zeroClick: [],
  countries: [],
  pageTwo: [],
};

describe("buildFindings — partial trailing month", () => {
  // Reproduces the real shape: three complete months plus a few days of the
  // current one. Comparing against the stub month reads as a ~96% collapse.
  const branded = [
    { month: "2026-05-01", brandedClicks: 56, brandedImpressions: 183, nonbrandedClicks: 17, nonbrandedImpressions: 9864 },
    { month: "2026-06-01", brandedClicks: 64, brandedImpressions: 364, nonbrandedClicks: 16, nonbrandedImpressions: 9871 },
    { month: "2026-07-01", brandedClicks: 35, brandedImpressions: 268, nonbrandedClicks: 53, nonbrandedImpressions: 18049 },
    { month: "2026-08-01", brandedClicks: 2, brandedImpressions: 24, nonbrandedClicks: 3, nonbrandedImpressions: 1230 },
  ];

  it("does not read an in-progress month as a collapse", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T09:00:00.000Z"));

    const titles = buildFindings({ ...EMPTY_ARGS, branded }).map((f) => f.title);
    const brandFinding = titles.find((t) => t.startsWith("Branded clicks are down"));

    // May (56) vs July (35) is -38%, not -96% against August's 3-day stub.
    expect(brandFinding).toBe("Branded clicks are down 38%");

    vi.useRealTimers();
  });

  it("uses the final month once it is complete", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00.000Z"));

    const titles = buildFindings({ ...EMPTY_ARGS, branded }).map((f) => f.title);
    expect(titles).toContain("Branded clicks are down 96%");

    vi.useRealTimers();
  });

  it("applies the same guard to content velocity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T09:00:00.000Z"));

    const monthlyByHost = [
      { month: "2026-06-01", host: "wrenchlane.com", clicks: 10, impressions: 100, pages: 107 },
      { month: "2026-07-01", host: "wrenchlane.com", clicks: 10, impressions: 100, pages: 93 },
      { month: "2026-08-01", host: "wrenchlane.com", clicks: 1, impressions: 10, pages: 4 },
    ];

    const titles = buildFindings({ ...EMPTY_ARGS, monthlyByHost }).map((f) => f.title);
    // 107 -> 93 is -13%, under the 15% threshold, so nothing should fire.
    // Against August's stub (4 pages) it would have been -96%.
    expect(titles.filter((t) => t.includes("fewer pages"))).toEqual([]);

    vi.useRealTimers();
  });
});
