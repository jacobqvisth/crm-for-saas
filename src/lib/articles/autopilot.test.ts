// The Autopilot scheduler is pure arithmetic over a wall clock, which makes it
// both easy to test and easy to get quietly wrong: an off-by-one on the slot
// boundary publishes twice in an hour, and a mishandled zone shifts the whole
// day by one twice a year. Those are the cases covered here.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOPILOT_SETTINGS,
  decideRun,
  localParts,
  settingsFromRow,
  slotHours,
  type AutopilotSettings,
} from "./autopilot";

const base: AutopilotSettings = { ...DEFAULT_AUTOPILOT_SETTINGS, enabled: true };

/** A UTC instant, so each test states the absolute moment it means. */
const utc = (iso: string) => new Date(iso);

describe("slotHours", () => {
  it("spreads per_day slots at the configured interval", () => {
    expect(slotHours(base)).toEqual([8, 10, 12, 14, 16]);
  });

  it("stops at midnight rather than wrapping into the next day", () => {
    // A slot at 24:00 would land on tomorrow's count and publish twice.
    expect(slotHours({ perDay: 5, intervalHours: 4, startHour: 20 })).toEqual([20]);
  });

  it("handles a single article a day", () => {
    expect(slotHours({ perDay: 1, intervalHours: 2, startHour: 9 })).toEqual([9]);
  });
});

describe("localParts", () => {
  it("reads Stockholm summer time as CEST, not UTC", () => {
    // 06:00Z on 1 July is 08:00 in Stockholm. Reading it as UTC would put the
    // first slot two hours late all summer.
    expect(localParts(utc("2026-07-01T06:00:00Z"), "Europe/Stockholm").hour).toBe(8);
  });

  it("reads Stockholm winter time as CET", () => {
    // 07:00Z on 1 January is 08:00 in Stockholm: one hour of offset, not two.
    expect(localParts(utc("2026-01-01T07:00:00Z"), "Europe/Stockholm").hour).toBe(8);
  });

  it("reports midnight as hour 0, not 24", () => {
    // en-GB with hour12:false renders midnight as "24", which would compare as
    // past every slot and let a whole extra day's worth through.
    expect(localParts(utc("2026-07-01T22:00:00Z"), "Europe/Stockholm").hour).toBe(0);
  });

  it("rolls the date key at local midnight, not UTC midnight", () => {
    // 23:30Z on 30 June is already 01:30 on 1 July in Stockholm. Counting the
    // day in UTC would credit those articles to the wrong date.
    const p = localParts(utc("2026-06-30T23:30:00Z"), "Europe/Stockholm");
    expect(p.dateKey).toBe("2026-07-01");
  });
});

describe("decideRun", () => {
  const at = (iso: string, publishedToday: number, settings: AutopilotSettings = base) =>
    decideRun({ settings, now: utc(iso), publishedToday });

  it("does nothing while disabled, whatever the clock says", () => {
    const d = at("2026-07-01T10:00:00Z", 0, { ...base, enabled: false });
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/off/i);
  });

  it("waits until the first slot", () => {
    // 05:00Z = 07:00 Stockholm, an hour before the 08:00 slot.
    const d = at("2026-07-01T05:00:00Z", 0);
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/before the first slot/i);
  });

  it("publishes on the first slot", () => {
    const d = at("2026-07-01T06:00:00Z", 0);
    expect(d.run).toBe(true);
    expect(d.reason).toBe("Slot 1 of 5");
  });

  it("holds between slots once that slot is served", () => {
    // 09:00 Stockholm: one slot elapsed, one published. Nothing due until 10:00.
    const d = at("2026-07-01T07:00:00Z", 1);
    expect(d.run).toBe(false);
    expect(d.nextSlotHour).toBe(10);
  });

  it("catches up a slot that was missed to an error", () => {
    // 10:00 Stockholm, two slots elapsed, nothing published: the 08:00 run
    // failed. Catching up is the whole reason the rule compares counts rather
    // than measuring time since the last publish.
    const d = at("2026-07-01T08:00:00Z", 0);
    expect(d.run).toBe(true);
    expect(d.slotsElapsed).toBe(2);
  });

  it("stops at the daily quota even late in the evening", () => {
    const d = at("2026-07-01T20:00:00Z", 5);
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/done/i);
  });

  it("never exceeds per_day when every slot has elapsed", () => {
    // 23:00 Stockholm with all five out. The day is over, not owed more.
    const d = at("2026-07-01T21:00:00Z", 5);
    expect(d.run).toBe(false);
  });

  it("skips weekends when asked to", () => {
    // 2026-07-04 is a Saturday.
    const d = at("2026-07-04T08:00:00Z", 0, { ...base, weekdaysOnly: true });
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/weekend/i);
  });

  it("still runs at the weekend by default", () => {
    expect(at("2026-07-04T08:00:00Z", 0).run).toBe(true);
  });

  it("is unaffected by the DST boundary", () => {
    // 07:00Z in January is 08:00 Stockholm, the first slot, exactly as 06:00Z is
    // in July. Both must fire; an offset added by hand would break one of them.
    expect(at("2026-01-01T07:00:00Z", 0).run).toBe(true);
    expect(at("2026-01-01T06:00:00Z", 0).run).toBe(false);
  });
});

describe("settingsFromRow", () => {
  it("falls back to the defaults for a missing row", () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_AUTOPILOT_SETTINGS);
  });

  it("reads a full row", () => {
    const s = settingsFromRow({
      enabled: true,
      per_day: 3,
      interval_hours: 4,
      start_hour: 7,
      time_zone: "Europe/Stockholm",
      weekdays_only: true,
      publish_mode: "stage",
      allowed_categories: ["Diagnostics"],
      extra_tags: ["from-our-data"],
      stats_every: 5,
      stats_cooldown_days: 30,
      options: { length: "long" },
    });
    expect(s.enabled).toBe(true);
    expect(s.perDay).toBe(3);
    expect(s.publishMode).toBe("stage");
    expect(slotHours(s)).toEqual([7, 11, 15]);
  });

  it("treats an unknown publish mode as live rather than crashing", () => {
    // The column has a CHECK constraint, so this only happens if that is ever
    // relaxed. Defaulting to the documented behaviour beats throwing in a cron.
    expect(settingsFromRow({ publish_mode: "nonsense" }).publishMode).toBe("live");
  });

  it("does not let a null column become NaN in the slot arithmetic", () => {
    const s = settingsFromRow({ per_day: null, start_hour: null, interval_hours: null });
    expect(slotHours(s)).toEqual([8, 10, 12, 14, 16]);
  });
});
