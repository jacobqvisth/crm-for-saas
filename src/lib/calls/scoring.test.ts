import { describe, expect, it } from "vitest";
import { scoreContact, isFreshToCall, type ScoreableContact } from "./scoring";

// Fixed "now" so day-deltas are deterministic.
const NOW = Date.parse("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const base: ScoreableContact = {
  user_plan_type: "free",
  user_subscription_status: null,
  signed_up_at: daysAgo(60),
  diagnostics_total: 0,
  diagnostics_last_30d: 0,
  login_count: 0,
  last_active_at: null,
  credits_remaining: null,
  last_contacted_at: null,
};

describe("scoreContact", () => {
  it("ranks a bounced payment as high priority", () => {
    const r = scoreContact({ ...base, user_plan_type: "small_monthly", user_subscription_status: "active", paymentIssue: true }, NOW);
    expect(r.priority).toBe("high");
    expect(r.reasons[0].label).toMatch(/payment failed/i);
    expect(r.reasons[0].tone).toBe("danger");
  });

  it("flags a paid trial in progress", () => {
    const r = scoreContact({ ...base, user_subscription_status: "trialing", user_plan_type: null }, NOW);
    expect(r.reasons.some((x) => /paid trial/i.test(x.label))).toBe(true);
    expect(r.priority).toBe("high");
  });

  it("detects a just-closed trial (free, ~14d, has used it)", () => {
    const r = scoreContact({ ...base, signed_up_at: daysAgo(15), diagnostics_total: 4, diagnostics_last_30d: 1 }, NOW);
    expect(r.reasons.some((x) => /trial window just closed/i.test(x.label))).toBe(true);
  });

  it("surfaces engaged-free upsell", () => {
    const r = scoreContact({ ...base, diagnostics_total: 6, diagnostics_last_30d: 2 }, NOW);
    expect(r.reasons.some((x) => /upsell/i.test(x.label))).toBe(true);
  });

  it("flags gone-quiet for a previously engaged free user", () => {
    const r = scoreContact({ ...base, diagnostics_total: 5, login_count: 4, last_active_at: daysAgo(30) }, NOW);
    expect(r.reasons.some((x) => /gone quiet/i.test(x.label))).toBe(true);
  });

  it("flags never-activated", () => {
    const r = scoreContact({ ...base, signed_up_at: daysAgo(10), diagnostics_total: 0 }, NOW);
    expect(r.reasons.some((x) => /never ran a diagnosis/i.test(x.label))).toBe(true);
  });

  it("penalizes a recently-called contact", () => {
    const hot = scoreContact({ ...base, diagnostics_total: 6, diagnostics_last_30d: 3 }, NOW);
    const called = scoreContact({ ...base, diagnostics_total: 6, diagnostics_last_30d: 3, last_contacted_at: daysAgo(10) }, NOW);
    expect(called.score).toBeLessThan(hot.score);
    expect(called.reasons.some((x) => /called 10d ago/i.test(x.label))).toBe(true);
  });

  it("an inert old free user scores low", () => {
    const r = scoreContact(base, NOW);
    expect(r.priority).toBe("low");
  });
});

describe("isFreshToCall", () => {
  it("is fresh when never contacted", () => {
    expect(isFreshToCall({ last_contacted_at: null }, NOW)).toBe(true);
  });
  it("is not fresh within the 7d cutoff", () => {
    expect(isFreshToCall({ last_contacted_at: daysAgo(3) }, NOW)).toBe(false);
  });
  it("is fresh again after the cutoff", () => {
    expect(isFreshToCall({ last_contacted_at: daysAgo(10) }, NOW)).toBe(true);
  });
});
