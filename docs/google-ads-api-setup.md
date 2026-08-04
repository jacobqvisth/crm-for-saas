# Google Ads API setup

The `google_ads_api` source is built and registered but **inert until a developer
token exists**. It records "skipped" on every run until then, which is harmless.

This is separate from the older `google_ads` source. That one reads GA4's
`advertiserAdCost` / `advertiserAdClicks` / `advertiserAdImpressions` dimensions,
so it knows what we spent but carries no search terms and no market volume. This
source talks to the Ads API directly.

## What already exists

Verified in Vercel production on 2026-08-04:

| Variable | State |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | set |
| `GOOGLE_OAUTH_CLIENT_SECRET` | set |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | set, and **already carries the `adwords` scope** |
| `GOOGLE_ADS_CUSTOMER_ID` | set |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | **missing, this is the only blocker** |

No OAuth re-consent is needed. The refresh token's granted scopes are
`adwords`, `analytics.readonly`, `firebase.readonly`, `webmasters.readonly`.

## Getting the token

The API Center only exists on a Google Ads **manager account (MCC)**. A plain
advertising account has no API Center, so if `GOOGLE_ADS_CUSTOMER_ID` points at a
standalone account, create a manager account first and link the existing account
to it. The manager account must be created with an email not already tied to a
Google Ads account.

1. Go to `ads.google.com/aw/apicenter`, signed into the **manager** account.
2. Set the API contact email to a real, monitored address. The application cannot
   complete without one.
3. Make sure the company website is live. Placeholder URLs are rejected.
4. Link all active Ads accounts to that manager account.
5. Accept the terms. You get a 22-character token.
6. Open the access-level dropdown and **Apply for Basic Access**, declaring the
   "Researching keywords and recommendations" permissible use.

## Access levels, and why step 6 matters

| Level | Production | Ops/day | Application | Keyword Planner |
|---|---|---|---|---|
| Test | no | 15,000 | none | no |
| Explorer | yes | 2,880 | none, usually automatic | **no** |
| Basic | yes | 15,000 | yes, ~5 business days | yes |
| Standard | yes | unlimited | yes, ~10 business days | yes |

**Explorer access reaches production accounts but is refused
`KeywordPlanIdeaService` and `KeywordPlanService`.** So a fresh token makes the
search-terms reports work while keyword volumes stay unavailable. Both land once
Basic is granted, with no code change: each report degrades independently and
records a warning in the sync run's metadata.

Google acknowledged a review backlog in February 2026, so Basic can take longer
than the stated five days.

## Turning it on

1. Add to Vercel production:
   ```
   GOOGLE_ADS_DEVELOPER_TOKEN=<22-char token>
   ```
2. If the token lives on a manager account above the target account, also add:
   ```
   GOOGLE_ADS_LOGIN_CUSTOMER_ID=<manager account id>
   ```
3. Trigger a run by hand before scheduling it:
   ```
   curl -X POST https://crm-for-saas.vercel.app/api/ceo-sync/google_ads_api \
     -H "Authorization: Bearer $SYNC_SECRET"
   ```
4. Read `metadata.warnings` on the resulting `dashboard_sync_runs` row. That is
   where an access-level refusal shows up.
5. Once it returns rows, schedule it with `supabase/ceo-cron-google-ads-api.sql`
   (substitute `__SYNC_SECRET__`, and do not commit the substituted file).

## Optional variables

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | unset | Manager account for the `login-customer-id` header |
| `GOOGLE_ADS_GEO_TARGETS` | the 15 EU markets | Comma-separated geo target constant IDs |
| `GOOGLE_ADS_LANGUAGE_CONSTANT` | unset, meaning all languages | Language constant ID |
| `GOOGLE_ADS_KEYWORD_IDEAS` | unset | Set to `1` to also run keyword discovery |
| `GOOGLE_ADS_IDEA_SEED_CAP` | 20 | Seed terms used for discovery |

Geo target constant IDs for countries are `2000 + ISO 3166-1 numeric`, so Sweden
(752) is 2752 and Germany (276) is 2276.

## What it writes

All into `dashboard_metric_snapshots` under `source_key = 'google_ads_api'`, with
full payloads in `dashboard_raw_metric_rows`.

**Keyword volume**, dimensioned by `{keyword, country, cluster}`, stamped on the
calendar month so repeated syncs upsert one row per keyword per month:

- `keyword_avg_monthly_searches`
- `keyword_competition_index`
- `keyword_top_of_page_bid_low` / `_high` (currency, converted from micros)

**Paid search terms**, dimensioned by `{searchTerm, campaign}`, one row per day:

- `paid_search_term_impressions` / `_clicks` / `_cost` / `_conversions`

**Pmax search categories**, dimensioned by `{searchCategory, campaign}`:

- `pmax_search_category_impressions` / `_clicks` / `_conversions`

## The Performance Max caveat

As of 2026-08-04, **71% of spend and 97% of ad-attributed signups come from one
Performance Max campaign** ("Pmax eng may 2026": $8,295, 27,856 clicks, 778
signups). Performance Max traffic **does not appear in `search_term_view` at
all**.

The only view that covers Pmax is `campaign_search_term_insight`, which reports
search *categories* rather than exact queries and must be filtered to one
campaign at a time. The connector does that, but expect category labels, not
keywords, for the majority of spend.

That is why Keyword Planner is the more valuable of the two unlocks for this
account: the search-terms report is structurally dark for most of the budget.

## Testing status

The response shaping, micros conversion, month bucketing, dimension keys and
error classification are unit tested (28 tests across
`google-ads-client.test.ts` and `sources/google-ads-api.test.ts`).

**The request paths have never run against a live account**, because no token
existed when this was written. On the first real run, watch:

- the API version in `GOOGLE_ADS_API_VERSION` (currently `v21`) still being served
- whether `login-customer-id` is required for this account pair
- GAQL field names on `campaign_search_term_insight`, the least stable of the three
- whether `generateKeywordHistoricalMetrics` accepts a 500-keyword batch, and if
  not, lower `KEYWORD_CHUNK_SIZE`
