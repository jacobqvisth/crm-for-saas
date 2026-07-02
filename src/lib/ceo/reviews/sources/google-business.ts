// Google Business Profile review connector — DORMANT until access is granted.
//
// Reviews come from the legacy Google My Business API v4
// (`GET https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews`),
// which ships at quota 0 for every GCP project until Google approves a
// "Basic API Access" request (support.google.com/business/contact/api_default).
// Until that approval lands for project crm-for-saas-491113, any call returns
// 429 RESOURCE_EXHAUSTED, so this connector stays a no-op and the cron simply
// reports it as skipped.
//
// To activate (after approval), set:
//   GBP_REVIEWS_ENABLED=1
//   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
//     (refresh token consented with scope https://www.googleapis.com/auth/business.manage)
//   GBP_ACCOUNT_ID, GBP_LOCATION_ID  (resolve once via Account Management +
//     Business Information APIs, then pin them)
// …then implement the fetch below (flagged TODO). Kept as a thin, honest stub
// rather than untested API code we can't exercise without live access.

import { getEnv } from "@/lib/ceo/env";
import type { ReviewSourceFetchResult } from "@/lib/ceo/reviews/types";

export async function fetchGoogleBusinessReviews(): Promise<ReviewSourceFetchResult> {
  if (getEnv("GBP_REVIEWS_ENABLED") !== "1") {
    return {
      ok: true,
      skipped: true,
      reason:
        "Google Business Profile API access not yet approved (GBP_REVIEWS_ENABLED unset)",
    };
  }

  const hasCreds =
    getEnv("GOOGLE_OAUTH_REFRESH_TOKEN") &&
    getEnv("GBP_ACCOUNT_ID") &&
    getEnv("GBP_LOCATION_ID");
  if (!hasCreds) {
    return {
      ok: true,
      skipped: true,
      reason:
        "Google Business Profile credentials incomplete (need refresh token + account/location IDs)",
    };
  }

  // TODO(post-approval): exchange refresh token → access token, then
  // GET /v4/accounts/{GBP_ACCOUNT_ID}/locations/{GBP_LOCATION_ID}/reviews,
  // map starRating(ENUM FIVE→5)/comment/reviewer/createTime/reviewReply into
  // NormalizedReview[], and return an aggregate snapshot. Implement + verify
  // against live access in a focused follow-up.
  return {
    ok: true,
    skipped: true,
    reason: "Google Business Profile connector not yet implemented",
  };
}
