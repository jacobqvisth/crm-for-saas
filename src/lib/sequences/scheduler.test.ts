import { describe, it, expect } from "vitest";
import { getNextSendTime, isWithinSendWindow } from "./scheduler";
import type { SequenceSettings } from "@/lib/database.types";

const sverige: SequenceSettings = {
  send_days: [1, 2, 3, 4, 5],
  send_start_hour: 6,
  send_end_hour: 18,
  timezone: "Europe/Stockholm",
  daily_limit_per_sender: 80,
  stop_on_reply: true,
  stop_on_company_reply: true,
  sender_rotation: true,
};

describe("isWithinSendWindow", () => {
  it("accepts 12:00 Stockholm on a weekday", () => {
    // 2026-05-20 (Wed) 12:00 CEST = 10:00 UTC
    expect(isWithinSendWindow(sverige, new Date("2026-05-20T10:00:00Z"))).toBe(true);
  });

  it("rejects 21:00 Stockholm (the observed bug hour)", () => {
    // 2026-05-20 21:00 CEST = 19:00 UTC
    expect(isWithinSendWindow(sverige, new Date("2026-05-20T19:00:00Z"))).toBe(false);
  });

  it("rejects 05:00 Stockholm", () => {
    // 2026-05-20 05:00 CEST = 03:00 UTC
    expect(isWithinSendWindow(sverige, new Date("2026-05-20T03:00:00Z"))).toBe(false);
  });

  it("rejects Saturday inside hour range", () => {
    // 2026-05-23 (Sat) 12:00 CEST
    expect(isWithinSendWindow(sverige, new Date("2026-05-23T10:00:00Z"))).toBe(false);
  });

  it("accepts exactly the start hour", () => {
    // 06:00 CEST = 04:00 UTC
    expect(isWithinSendWindow(sverige, new Date("2026-05-20T04:00:00Z"))).toBe(true);
  });

  it("rejects exactly the end hour", () => {
    // 18:00 CEST = 16:00 UTC
    expect(isWithinSendWindow(sverige, new Date("2026-05-20T16:00:00Z"))).toBe(false);
  });
});

describe("getNextSendTime — timezone-aware", () => {
  it("from 21:00 Wed Stockholm, returns 06:00 Thu Stockholm", () => {
    // 2026-05-20T21:00 CEST = 2026-05-20T19:00:00Z
    const result = getNextSendTime(sverige, new Date("2026-05-20T19:00:00Z"));
    // Expect 2026-05-21T06:00 CEST = 2026-05-21T04:00:00Z
    expect(result.toISOString()).toBe("2026-05-21T04:00:00.000Z");
  });

  it("from 04:00 Wed Stockholm, returns 06:00 Wed Stockholm (today, future)", () => {
    // 2026-05-20T04:00 CEST = 2026-05-20T02:00:00Z
    const result = getNextSendTime(sverige, new Date("2026-05-20T02:00:00Z"));
    expect(result.toISOString()).toBe("2026-05-20T04:00:00.000Z"); // 06:00 CEST
  });

  it("from Friday 19:00 Stockholm, skips weekend to Monday 06:00", () => {
    // 2026-05-22 (Fri) 19:00 CEST = 17:00 UTC
    const result = getNextSendTime(sverige, new Date("2026-05-22T17:00:00Z"));
    // 2026-05-25 (Mon) 06:00 CEST = 04:00 UTC
    expect(result.toISOString()).toBe("2026-05-25T04:00:00.000Z");
  });

  it("during the window, returns now+5s (active send)", () => {
    const now = new Date("2026-05-20T10:00:00Z"); // 12:00 CEST Wed
    const result = getNextSendTime(sverige, now);
    expect(result.getTime() - now.getTime()).toBe(5000);
  });

  it("respects DST: CET winter window also starts at 06:00 local", () => {
    // 2026-01-14 (Wed) 21:00 CET = 20:00 UTC (winter, no DST)
    const result = getNextSendTime(sverige, new Date("2026-01-14T20:00:00Z"));
    // 2026-01-15 (Thu) 06:00 CET = 05:00 UTC
    expect(result.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });
});
