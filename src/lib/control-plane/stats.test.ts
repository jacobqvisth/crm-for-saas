import { describe, expect, it } from "vitest";
import { METRIC_KEYS, METRIC_LABEL, parseMetrics } from "./stats";

// The control plane's safety rests on it holding no customer data. A stats
// feature is the obvious way to lose that by accident, so these tests are about
// what CANNOT get in, not what can.

describe("the metric contract", () => {
  it("accepts the declared counts", () => {
    const res = parseMetrics({ users: 4, contacts: 41234, calls_7d: 0 });
    expect(res.ok).toBe(true);
    expect(res.metrics).toEqual({ users: 4, contacts: 41234, calls_7d: 0 });
  });

  it("accepts an empty report", () => {
    // A tenant whose every count failed still reports, so that "heard from" and
    // "reported nothing" stay distinguishable.
    expect(parseMetrics({})).toEqual({ ok: true, metrics: {} });
  });

  // The whole point. A free-form blob is an invitation to "just add" a list of
  // recent contacts, and then customer data lives in the control plane after all.
  it("REJECTS an unknown key rather than dropping it", () => {
    const res = parseMetrics({ users: 3, recent_contacts: 7 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown metric: recent_contacts/);
  });

  it("rejects a value that is not a number", () => {
    for (const bad of [
      { users: "4" },
      { users: null },
      { users: true },
      { users: { count: 4 } },
      { users: ["a@b.com", "c@d.com"] },
    ]) {
      expect(parseMetrics(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects negatives, fractions and non-finite numbers", () => {
    expect(parseMetrics({ users: -1 }).ok).toBe(false);
    expect(parseMetrics({ users: 1.5 }).ok).toBe(false);
    expect(parseMetrics({ users: Number.NaN }).ok).toBe(false);
    expect(parseMetrics({ users: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it("rejects an implausibly large count", () => {
    // More likely a bug or someone probing than a real number of rows.
    expect(parseMetrics({ contacts: 1_000_000_001 }).ok).toBe(false);
  });

  it("rejects anything that is not a plain object", () => {
    for (const bad of [null, undefined, 4, "users=4", [1, 2, 3]]) {
      expect(parseMetrics(bad).ok, String(bad)).toBe(false);
    }
  });

  it("labels every declared metric, so the console cannot render a bare key", () => {
    for (const k of METRIC_KEYS) {
      expect(METRIC_LABEL[k], k).toBeTruthy();
    }
  });

  it("has no duplicate keys", () => {
    expect(new Set(METRIC_KEYS).size).toBe(METRIC_KEYS.length);
  });

  it("uses plain snake_case keys", () => {
    for (const k of METRIC_KEYS) {
      expect(k, k).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  // The invariant that actually protects the control plane, stated over every
  // declared key rather than over a hand-picked one: whatever a metric is
  // CALLED, it cannot carry text. `emails_sent_7d` is a count of emails, not an
  // email, and this is what keeps it that way.
  it("lets no declared metric carry a string, whatever it is named", () => {
    for (const k of METRIC_KEYS) {
      expect(parseMetrics({ [k]: "jacob@example.com" }).ok, k).toBe(false);
      expect(parseMetrics({ [k]: ["a@b.com"] }).ok, k).toBe(false);
      expect(parseMetrics({ [k]: { nested: 1 } }).ok, k).toBe(false);
      // ...and the same key with a real count is fine.
      expect(parseMetrics({ [k]: 7 }).ok, k).toBe(true);
    }
  });
});
