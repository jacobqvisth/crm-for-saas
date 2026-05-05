import { afterEach, describe, expect, it } from "vitest";
import {
  getAppStoreKeyId,
  normalizeReportName,
  selectAnalyticsReports,
  selectReportInstances,
} from "./app-store-connect";

describe("app store connect helpers", () => {
  const originalKeyId = process.env.APP_STORE_CONNECT_KEY_ID;
  const originalApiKey = process.env.APP_STORE_CONNECT_API_KEY;

  afterEach(() => {
    if (originalKeyId === undefined) {
      delete process.env.APP_STORE_CONNECT_KEY_ID;
    } else {
      process.env.APP_STORE_CONNECT_KEY_ID = originalKeyId;
    }

    if (originalApiKey === undefined) {
      delete process.env.APP_STORE_CONNECT_API_KEY;
    } else {
      process.env.APP_STORE_CONNECT_API_KEY = originalApiKey;
    }
  });

  it("accepts APP_STORE_CONNECT_API_KEY as a key id alias", () => {
    delete process.env.APP_STORE_CONNECT_KEY_ID;
    process.env.APP_STORE_CONNECT_API_KEY = "ABC123XYZ9";

    expect(getAppStoreKeyId()).toBe("ABC123XYZ9");
  });

  it("normalizes report names without the content level suffix", () => {
    expect(normalizeReportName("App Store Downloads Detailed")).toBe(
      "App Store Downloads",
    );
    expect(normalizeReportName("App Sessions Standard")).toBe("App Sessions");
  });

  it("prefers one report variant per base name", () => {
    const reports = selectAnalyticsReports([
      {
        id: "standard",
        type: "analyticsReports",
        attributes: {
          category: "COMMERCE",
          name: "App Store Downloads Standard",
        },
      },
      {
        id: "detailed",
        type: "analyticsReports",
        attributes: {
          category: "COMMERCE",
          name: "App Store Downloads Detailed",
        },
      },
      {
        id: "sessions",
        type: "analyticsReports",
        attributes: {
          category: "APP_USAGE",
          name: "App Sessions Standard",
        },
      },
    ]);

    expect(new Set(reports.map((report) => report.id))).toEqual(
      new Set(["detailed", "sessions"]),
    );
  });

  it("keeps recent daily instances and falls back to the latest available", () => {
    const window = {
      start: new Date("2026-04-17T00:00:00.000Z"),
      end: new Date("2026-04-24T00:00:00.000Z"),
    };

    const selected = selectReportInstances(
      [
        {
          id: "older-weekly",
          type: "analyticsReportInstances",
          attributes: {
            granularity: "WEEKLY",
            processingDate: "2026-04-10",
          },
        },
        {
          id: "recent-daily",
          type: "analyticsReportInstances",
          attributes: {
            granularity: "DAILY",
            processingDate: "2026-04-22",
          },
        },
        {
          id: "old-daily",
          type: "analyticsReportInstances",
          attributes: {
            granularity: "DAILY",
            processingDate: "2026-04-12",
          },
        },
      ],
      window,
    );

    expect(selected.map((instance) => instance.id)).toEqual(["recent-daily"]);
  });
});
