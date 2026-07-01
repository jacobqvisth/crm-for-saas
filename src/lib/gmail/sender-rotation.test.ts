import { describe, it, expect } from "vitest";
import { selectSender } from "./sender-rotation";

type Acct = {
  id: string;
  user_id: string;
  daily_sends_count: number | null;
  max_daily_sends: number | null;
};

// Accounts are supplied ascending by daily_sends_count, matching the query.
const pool: Acct[] = [
  { id: "magnus", user_id: "u-magnus", daily_sends_count: 1, max_daily_sends: 20 },
  { id: "matteo", user_id: "u-matteo", daily_sends_count: 1, max_daily_sends: 80 },
  { id: "jacob", user_id: "u-jacob", daily_sends_count: 18, max_daily_sends: 60 },
  { id: "hans", user_id: "u-hans", daily_sends_count: 80, max_daily_sends: 80 }, // full
];

describe("selectSender", () => {
  it("without a preferred user, returns the lowest-count account with capacity", () => {
    expect(selectSender(pool)?.id).toBe("magnus");
  });

  it("prefers the acting user's own account even if it isn't the lowest count", () => {
    // The exact bug: Jacob calls, follow-up must come from Jacob (18 sends),
    // not from Magnus/matteo who merely have the lowest count.
    expect(selectSender(pool, "u-jacob")?.id).toBe("jacob");
  });

  it("skips the preferred user's account when it is at capacity, falling back to round-robin", () => {
    expect(selectSender(pool, "u-hans")?.id).toBe("magnus");
  });

  it("falls back to round-robin when the preferred user has no account in the pool", () => {
    expect(selectSender(pool, "u-nobody")?.id).toBe("magnus");
  });

  it("returns null when no account has remaining capacity", () => {
    const full: Acct[] = [
      { id: "a", user_id: "u-a", daily_sends_count: 5, max_daily_sends: 5 },
    ];
    expect(selectSender(full, "u-a")).toBeNull();
  });
});
