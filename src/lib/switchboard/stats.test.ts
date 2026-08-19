import { describe, it, expect } from "vitest";
import { computeStats, formatDuration, formatPercent, type CallRow } from "./stats";

const NOW = new Date("2026-08-19T12:00:00Z");

function call(over: Partial<CallRow> = {}): CallRow {
  return {
    created_at: "2026-08-19T10:00:00Z",
    status: "ended",
    outcome: "handled_by_agent",
    duration_seconds: 60,
    requested_label: null,
    caller_number: "+46700000001",
    contact_id: null,
    message_body: null,
    unanswered: null,
    ...over,
  };
}

describe("computeStats", () => {
  it("returns empty-safe values with no calls", () => {
    const s = computeStats([], NOW);
    expect(s.total).toBe(0);
    expect(s.selfServeRate).toBeNull();
    expect(s.avgDurationSeconds).toBeNull();
    expect(s.daily).toHaveLength(14);
    expect(s.daily.every((d) => d.count === 0)).toBe(true);
  });

  it("counts recency windows", () => {
    const s = computeStats(
      [
        call({ created_at: "2026-08-19T09:00:00Z" }),
        call({ created_at: "2026-08-15T09:00:00Z" }), // 4 days
        call({ created_at: "2026-08-05T09:00:00Z" }), // 14 days
        call({ created_at: "2026-06-01T09:00:00Z" }), // way outside
      ],
      NOW,
    );
    expect(s.total).toBe(4);
    expect(s.last7).toBe(2);
    expect(s.last30).toBe(3);
    expect(s.today).toBe(1);
  });

  it("treats an unknown duration as unknown, not zero", () => {
    // Averaging nulls as zero would understate every call, which is the kind of
    // quiet wrongness that makes a stats page untrustworthy.
    const s = computeStats(
      [call({ duration_seconds: 60 }), call({ duration_seconds: null }), call({ duration_seconds: 0 })],
      NOW,
    );
    expect(s.avgDurationSeconds).toBe(60);
    expect(s.longestSeconds).toBe(60);
  });

  it("computes self-serve share from conclusive calls only", () => {
    const s = computeStats(
      [
        call({ outcome: "handled_by_agent" }),
        call({ outcome: "handled_by_agent" }),
        call({ outcome: "forwarded" }),
        call({ outcome: "abandoned" }), // says nothing either way
        call({ outcome: null }), // ditto
      ],
      NOW,
    );
    // 2 handled of 3 conclusive.
    expect(s.selfServeRate).toBeCloseTo(2 / 3, 5);
    expect(s.transferRequestRate).toBeCloseTo(1 / 3, 5);
    expect(s.handledAlone).toBe(2);
    expect(s.transferred).toBe(1);
  });

  it("counts a missed transfer as someone asking for a human", () => {
    const s = computeStats([call({ outcome: "no_answer" }), call({ outcome: "handled_by_agent" })], NOW);
    expect(s.missed).toBe(1);
    expect(s.transferRequestRate).toBeCloseTo(0.5, 5);
  });

  it("ranks who callers ask for", () => {
    const s = computeStats(
      [
        call({ requested_label: "Hans" }),
        call({ requested_label: "Hans" }),
        call({ requested_label: "Jacob" }),
        call({ requested_label: null }),
      ],
      NOW,
    );
    expect(s.topRequested[0]).toEqual({ label: "Hans", count: 2 });
    expect(s.topRequested).toHaveLength(2);
  });

  it("counts unique callers rather than calls", () => {
    const s = computeStats(
      [
        call({ caller_number: "+46700000001" }),
        call({ caller_number: "+46700000001" }),
        call({ caller_number: "+46700000002" }),
        call({ caller_number: null }),
      ],
      NOW,
    );
    expect(s.total).toBe(4);
    expect(s.uniqueCallers).toBe(2);
  });

  it("keeps quiet days in the daily series", () => {
    const s = computeStats([call({ created_at: "2026-08-19T09:00:00Z" })], NOW);
    expect(s.daily).toHaveLength(14);
    expect(s.daily[s.daily.length - 1]).toEqual({ day: "2026-08-19", count: 1 });
    expect(s.daily.slice(0, 13).every((d) => d.count === 0)).toBe(true);
  });
});

describe("formatDuration", () => {
  it("renders minutes and seconds", () => {
    expect(formatDuration(200)).toBe("3 m 20 s");
    expect(formatDuration(45)).toBe("45 s");
  });

  it("shows a dash for nothing recorded", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("rounds to whole percent", () => {
    expect(formatPercent(2 / 3)).toBe("67%");
  });
  it("shows a dash when there is nothing to divide", () => {
    expect(formatPercent(null)).toBe("—");
  });
});
