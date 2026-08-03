import { describe, expect, it } from "vitest";
import {
  ACTIVATION_WINDOW_DAYS,
  RETENTION_MIN_DIAGNOSTICS,
  RETENTION_WINDOW_DAYS,
  evaluateUserWindows,
} from "./new-users";

const DAY = 86_400_000;
const SIGNUP = Date.UTC(2026, 6, 1, 12, 0, 0); // 2026-07-01T12:00Z
const LONG_AFTER = SIGNUP + 400 * DAY; // every window elapsed

describe("evaluateUserWindows", () => {
  it("counts a diagnosis inside the activation window", () => {
    const v = evaluateUserWindows(SIGNUP, [SIGNUP + 2 * DAY], LONG_AFTER);

    expect(v.activationEligible).toBe(true);
    expect(v.activated).toBe(true);
    expect(v.daysToActivate).toBeCloseTo(2, 6);
  });

  // The core of the bug this replaced: "ever activated" counted this user, so a
  // cohort's number kept climbing months later and young cohorts looked broken
  // by comparison.
  it("does NOT count a diagnosis after the activation window closes", () => {
    const late = SIGNUP + (ACTIVATION_WINDOW_DAYS + 1) * DAY;
    const v = evaluateUserWindows(SIGNUP, [late], LONG_AFTER);

    expect(v.activationEligible).toBe(true);
    expect(v.activated).toBe(false);
    expect(v.daysToActivate).toBeNull();
  });

  it("treats the window as half-open, excluding the exact boundary", () => {
    const boundary = SIGNUP + ACTIVATION_WINDOW_DAYS * DAY;
    expect(
      evaluateUserWindows(SIGNUP, [boundary], LONG_AFTER).activated,
    ).toBe(false);
    expect(
      evaluateUserWindows(SIGNUP, [boundary - 1], LONG_AFTER).activated,
    ).toBe(true);
  });

  // A user still inside their window must not be counted as a failure to
  // activate. Counting them is exactly what dragged recent cohorts down.
  it("marks a user still inside their window as not eligible", () => {
    const now = SIGNUP + 3 * DAY; // 3 of 7 days elapsed
    const v = evaluateUserWindows(SIGNUP, [], now);

    expect(v.activationEligible).toBe(false);
    expect(v.activated).toBe(false);
    expect(v.retentionEligible).toBe(false);
  });

  it("keeps a not-yet-eligible user out of the numerator too", () => {
    // Activated on day 1, but the window has not closed. Eligible=false means
    // the bucket reports them as neither activated nor a miss, which is what
    // keeps the denominator honest.
    const now = SIGNUP + 2 * DAY;
    const v = evaluateUserWindows(SIGNUP, [SIGNUP + DAY], now);

    expect(v.activationEligible).toBe(false);
    expect(v.activated).toBe(false);
  });

  it("ignores diagnoses that predate signup", () => {
    const v = evaluateUserWindows(SIGNUP, [SIGNUP - DAY], LONG_AFTER);

    expect(v.activated).toBe(false);
    expect(v.daysToActivate).toBeNull();
  });

  it("uses the earliest in-window diagnosis for days-to-activate", () => {
    const v = evaluateUserWindows(
      SIGNUP,
      [SIGNUP + 5 * DAY, SIGNUP + DAY, SIGNUP + 3 * DAY],
      LONG_AFTER,
    );

    expect(v.daysToActivate).toBeCloseTo(1, 6);
  });

  it("requires the minimum diagnosis count for retention", () => {
    const one = evaluateUserWindows(SIGNUP, [SIGNUP + DAY], LONG_AFTER);
    expect(one.activated).toBe(true);
    expect(one.retained).toBe(false);

    const enough = evaluateUserWindows(
      SIGNUP,
      Array.from(
        { length: RETENTION_MIN_DIAGNOSTICS },
        (_, i) => SIGNUP + (i + 1) * DAY,
      ),
      LONG_AFTER,
    );
    expect(enough.retained).toBe(true);
  });

  it("does not count a second diagnosis that lands after the retention window", () => {
    const v = evaluateUserWindows(
      SIGNUP,
      [SIGNUP + DAY, SIGNUP + (RETENTION_WINDOW_DAYS + 1) * DAY],
      LONG_AFTER,
    );

    expect(v.activated).toBe(true);
    expect(v.retained).toBe(false);
  });

  // Retention runs on a longer window, so there is a period where activation is
  // settled but retention is not. Both must report independently.
  it("can be activation-eligible while still retention-ineligible", () => {
    const now = SIGNUP + (ACTIVATION_WINDOW_DAYS + 1) * DAY;
    const v = evaluateUserWindows(SIGNUP, [SIGNUP + DAY], now);

    expect(v.activationEligible).toBe(true);
    expect(v.activated).toBe(true);
    expect(v.retentionEligible).toBe(false);
    expect(v.retained).toBe(false);
  });

  it("handles a user with no diagnoses at all", () => {
    const v = evaluateUserWindows(SIGNUP, [], LONG_AFTER);

    expect(v.activationEligible).toBe(true);
    expect(v.activated).toBe(false);
    expect(v.retentionEligible).toBe(true);
    expect(v.retained).toBe(false);
    expect(v.daysToActivate).toBeNull();
  });
});

describe("window constants", () => {
  it("keeps retention on a window at least as long as activation", () => {
    // A retention window shorter than the activation window would make it
    // possible to be retained but not activated, which is incoherent.
    expect(RETENTION_WINDOW_DAYS).toBeGreaterThanOrEqual(
      ACTIVATION_WINDOW_DAYS,
    );
    expect(RETENTION_MIN_DIAGNOSTICS).toBeGreaterThan(1);
  });
});
