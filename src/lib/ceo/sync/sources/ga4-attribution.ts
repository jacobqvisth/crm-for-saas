// Per-user first-touch attribution from GA4.
//
// Both wrenchlane.com and app.wrenchlane.com run the same GA4 property, so
// the _ga cookie survives the marketing -> app hop and GA4 stamps every
// identified user (customUser:crm_user_id, wired 2026-05-25) with the
// source/medium/campaign of their first session. That is the only place the
// "did this signup click a Google Ad?" answer exists per user - PostHog
// never sees the marketing site and the app drops UTMs before signup.
//
// The report is a full-history snapshot, not a window: firstUser* dimensions
// are immutable per user, and GA4's user-level retention (14 months, reset
// on activity) keeps every user we still care about queryable. The sync
// window argument is therefore ignored on purpose.
//
// Caveat carried by the data: users who signed up before the 2026-05-25
// user-ID wiring got firstUser* stamped at their first IDENTIFIED session,
// which can postdate signup. Consumers treat pre-June-2026 signups as
// approximate (see /dashboard/google-ads-users).

import { classifyAttribution } from "@/lib/ceo/attribution/classify";
import { runGa4Report } from "@/lib/ceo/sync/ga4-client";
import { requireSourceEnv } from "../errors";
import type { SourceConnector, UserAttributionRow } from "../types";

// GA4 has no data before this; a fixed origin keeps the report cacheable.
const REPORT_START_DATE = "2026-01-01";
const NOT_SET = "(not set)";

const runReport = runGa4Report;

export const ga4AttributionConnector: SourceConnector = {
  sourceKey: "ga4_attribution",
  async fetchMetrics(window) {
    requireSourceEnv("GA4 User Attribution", ["GA4_PROPERTY_ID"]);

    const rows = await runReport({
      dateRanges: [{ startDate: REPORT_START_DATE, endDate: "today" }],
      dimensions: [
        { name: "customUser:crm_user_id" },
        { name: "firstUserSource" },
        { name: "firstUserMedium" },
        { name: "firstUserCampaignName" },
        { name: "firstUserDefaultChannelGroup" },
        { name: "firstUserGoogleAdsCampaignName" },
      ],
      metrics: [{ name: "activeUsers" }],
      limit: "100000",
    });

    const seen = new Set<string>();
    const userAttribution: UserAttributionRow[] = [];
    for (const row of rows) {
      const values = (row.dimensionValues ?? []).map((d) => d.value ?? "");
      const [userId, source, medium, campaign, channelGroup, adsCampaign] = values;
      // Rows without an identified user ("(not set)" or blank) are anonymous
      // traffic - nothing to attach attribution to.
      if (!userId || userId === NOT_SET || userId.length < 10) continue;
      if (seen.has(userId)) continue;
      seen.add(userId);

      userAttribution.push({
        internal_user_id: userId,
        first_source: source || null,
        first_medium: medium || null,
        first_campaign: campaign || null,
        first_channel_group: channelGroup || null,
        google_ads_campaign: adsCampaign === NOT_SET ? null : adsCampaign || null,
        channel: classifyAttribution({
          firstSource: source,
          firstMedium: medium,
          firstCampaign: campaign,
          googleAdsCampaign: adsCampaign,
        }),
      });
    }

    // One aggregate point per run so the sources page can chart coverage.
    const googleAdsUsers = userAttribution.filter(
      (row) => row.channel === "google_ads",
    ).length;

    return {
      sourceKey: "ga4_attribution",
      rowsRead: rows.length,
      metrics: [
        {
          sourceKey: "ga4_attribution",
          metricKey: "attributed_users",
          periodStart: window.start,
          periodEnd: window.end,
          value: userAttribution.length,
        },
        {
          sourceKey: "ga4_attribution",
          metricKey: "google_ads_users",
          periodStart: window.start,
          periodEnd: window.end,
          value: googleAdsUsers,
        },
      ],
      userAttribution,
      metadata: {
        identifiedUsers: userAttribution.length,
        googleAdsUsers,
      },
    };
  },
};
