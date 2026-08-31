import { describe, expect, it } from "vitest";
import {
  buildChannelFunnel,
  maturityCutoff,
  median,
  pct,
  selectMatureCohort,
  worstStage,
  type WorkshopFacts,
} from "./funnel";
import { ADS_ERA_START } from "./shared";

function w(overrides: Partial<WorkshopFacts> & { workshopId: string }): WorkshopFacts {
  return {
    channel: "google_ads",
    signedUpAt: "2026-06-01T10:00:00Z",
    checkoutAt: null,
    firstPaidAt: null,
    activated: false,
    ...overrides,
  };
}

describe("maturityCutoff", () => {
  it("is the given number of days before now", () => {
    expect(maturityCutoff(new Date("2026-08-31T00:00:00Z"), 60)).toBe("2026-07-02");
  });
});

describe("selectMatureCohort", () => {
  const cutoff = "2026-07-02";

  it("drops signups from before the first ad ran", () => {
    const rows = [
      w({ workshopId: "old", signedUpAt: "2026-01-01T00:00:00Z" }),
      w({ workshopId: "new", signedUpAt: "2026-06-01T00:00:00Z" }),
    ];
    expect(selectMatureCohort(rows, ADS_ERA_START, cutoff).map((r) => r.workshopId)).toEqual([
      "new",
    ]);
  });

  it("drops signups too recent to have had a chance to convert", () => {
    const rows = [
      w({ workshopId: "mature", signedUpAt: "2026-06-01T00:00:00Z" }),
      w({ workshopId: "green", signedUpAt: "2026-08-20T00:00:00Z" }),
    ];
    expect(selectMatureCohort(rows, ADS_ERA_START, cutoff).map((r) => r.workshopId)).toEqual([
      "mature",
    ]);
  });

  it("keeps a recent signup that has ALREADY paid", () => {
    // Dropping it would remove a real conversion from the numerator while its
    // channel keeps its signups everywhere else, biasing against whichever
    // channel converts fastest.
    const rows = [
      w({
        workshopId: "fast",
        signedUpAt: "2026-08-20T00:00:00Z",
        firstPaidAt: "2026-08-25T00:00:00Z",
      }),
    ];
    expect(selectMatureCohort(rows, ADS_ERA_START, cutoff)).toHaveLength(1);
  });

  it("drops rows with no signup date rather than guessing one", () => {
    expect(selectMatureCohort([w({ workshopId: "x", signedUpAt: null })], ADS_ERA_START, cutoff))
      .toHaveLength(0);
  });
});

describe("buildChannelFunnel", () => {
  const rows = [
    w({ workshopId: "a", activated: true, checkoutAt: "2026-06-05", firstPaidAt: "2026-06-20" }),
    w({ workshopId: "b", activated: true, checkoutAt: "2026-06-06" }),
    w({ workshopId: "c", activated: true }),
    w({ workshopId: "d" }),
    w({ workshopId: "e", channel: "direct", activated: true, checkoutAt: "2026-06-01", firstPaidAt: "2026-06-10" }),
  ];

  it("counts only the requested channel", () => {
    const f = buildChannelFunnel(rows, "google_ads", "Google Ads");
    expect(f.workshops).toBe(4);
    expect(f.activated).toBe(3);
    expect(f.checkouts).toBe(2);
    expect(f.payers).toBe(1);
  });

  it("computes each stage against the right denominator", () => {
    const f = buildChannelFunnel(rows, "google_ads", "Google Ads");
    expect(f.activatedPct).toBeCloseTo(75);
    expect(f.checkoutPct).toBeCloseTo(50);
    expect(f.paidPct).toBeCloseTo(25);
    // Card-to-paid is out of CHECKOUTS, not out of signups.
    expect(f.checkoutToPaidPct).toBeCloseTo(50);
  });

  it("reports median days from signup to payment", () => {
    const f = buildChannelFunnel(rows, "google_ads", "Google Ads");
    expect(f.medianDaysToPaid).toBeCloseTo(19, 0);
  });

  it("returns nulls rather than NaN for a channel with no payers", () => {
    const f = buildChannelFunnel(rows, "email", "Email");
    expect(f.workshops).toBe(0);
    expect(f.paidPct).toBe(0);
    expect(f.checkoutToPaidPct).toBe(0);
    expect(f.medianDaysToPaid).toBeNull();
  });

  it("does not treat a paid workshop as unpaid when the date is missing", () => {
    // The loader stores "" for "charged, but Stripe never wrote the timestamp".
    const f = buildChannelFunnel(
      [w({ workshopId: "x", checkoutAt: "2026-06-01", firstPaidAt: "" })],
      "google_ads",
      "Google Ads",
    );
    expect(f.payers).toBe(1);
    expect(f.medianDaysToPaid).toBeNull();
  });
});

describe("worstStage", () => {
  it("finds checkout when that is the widest proportional gap", () => {
    // The real shape of this account: ads reach checkout at a fifth of direct's
    // rate, but close from there at a comparable rate.
    const ads = buildChannelFunnel(
      [
        ...Array.from({ length: 100 }, (_, i) => w({ workshopId: `a${i}`, activated: i < 29 })),
        ...Array.from({ length: 6 }, (_, i) =>
          w({ workshopId: `ac${i}`, activated: true, checkoutAt: "2026-06-01", firstPaidAt: i < 2 ? "2026-06-20" : null }),
        ),
      ],
      "google_ads",
      "Google Ads",
    );
    const direct = buildChannelFunnel(
      [
        ...Array.from({ length: 70 }, (_, i) => w({ workshopId: `d${i}`, channel: "direct", activated: i < 35 })),
        ...Array.from({ length: 30 }, (_, i) =>
          w({ workshopId: `dc${i}`, channel: "direct", activated: true, checkoutAt: "2026-06-01", firstPaidAt: i < 12 ? "2026-06-20" : null }),
        ),
      ],
      "direct",
      "Direct",
    );

    const result = worstStage(ads, direct);
    expect(result?.stage).toBe("checkout");
    expect(result?.ratio).toBeLessThan(1);
  });

  it("returns null when the reference channel has no rates to compare", () => {
    const empty = buildChannelFunnel([], "direct", "Direct");
    const ads = buildChannelFunnel([w({ workshopId: "a" })], "google_ads", "Google Ads");
    expect(worstStage(ads, empty)).toBeNull();
  });
});

describe("pct and median", () => {
  it("returns 0 rather than dividing by zero", () => {
    expect(pct(3, 0)).toBe(0);
  });

  it("averages the middle pair for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is null for an empty list", () => {
    expect(median([])).toBeNull();
  });
});
