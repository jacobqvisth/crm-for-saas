import { afterEach, describe, expect, it } from "vitest";
import {
  buildOverviewQuery,
  buildTrackedEventsQuery,
  formatHogqlDateTime,
  getPostHogApiHost,
  getTrackedEvents,
} from "./posthog";

const window = {
  start: new Date("2026-06-08T00:00:00.000Z"),
  end: new Date("2026-06-15T00:00:00.000Z"),
};

describe("posthog connector helpers", () => {
  const originalHost = process.env.POSTHOG_API_HOST;
  const originalEvents = process.env.POSTHOG_TRACKED_EVENTS;

  afterEach(() => {
    if (originalHost === undefined) delete process.env.POSTHOG_API_HOST;
    else process.env.POSTHOG_API_HOST = originalHost;
    if (originalEvents === undefined) delete process.env.POSTHOG_TRACKED_EVENTS;
    else process.env.POSTHOG_TRACKED_EVENTS = originalEvents;
  });

  it("defaults to EU cloud and strips trailing slashes", () => {
    delete process.env.POSTHOG_API_HOST;
    expect(getPostHogApiHost()).toBe("https://eu.posthog.com");

    process.env.POSTHOG_API_HOST = "https://us.posthog.com/";
    expect(getPostHogApiHost()).toBe("https://us.posthog.com");
  });

  it("formats HogQL datetimes without the T separator or Z suffix", () => {
    expect(formatHogqlDateTime(window.start)).toBe("2026-06-08 00:00:00");
  });

  it("builds an overview query bounded by the rolling window", () => {
    const query = buildOverviewQuery(window);
    expect(query).toContain("count(DISTINCT person_id) AS active_users");
    expect(query).toContain("countIf(event = '$pageview') AS pageviews");
    expect(query).toContain("timestamp >= toDateTime('2026-06-08 00:00:00')");
    expect(query).toContain("timestamp < toDateTime('2026-06-15 00:00:00')");
  });

  it("parses and escapes the tracked-events allow-list", () => {
    process.env.POSTHOG_TRACKED_EVENTS = " diagnostic_started , chat_opened ,";
    expect(getTrackedEvents()).toEqual(["diagnostic_started", "chat_opened"]);

    const query = buildTrackedEventsQuery(window, ["o'brien_event"]);
    expect(query).toContain("event IN ('o''brien_event')");
  });
});
