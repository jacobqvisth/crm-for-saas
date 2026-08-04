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

## Two auth paths, both already supported

`createGoogleAuth()` in `src/lib/ceo/sync/google-auth.ts` accepts either
credential, so this is a configuration choice and needs no code change:

| Path | Env var | Notes |
|---|---|---|
| **OAuth** (current, recommended) | `GOOGLE_OAUTH_CLIENT_ID` + `_SECRET` + `_REFRESH_TOKEN` | Already set, already carries `adwords`. Zero extra setup. |
| **Service account** | `GOOGLE_SERVICE_ACCOUNT_JSON` | Survives an employee leaving. Needs a downloaded key, and the SA email added as a user inside the Google Ads account. |

The [Quick start](https://developers.google.com/google-ads/api/docs/get-started/make-first-call)
walks the service-account path, which makes it look mandatory. It is not: the
[service accounts page](https://developers.google.com/google-ads/api/docs/oauth/service-accounts)
states they are one of several approaches. We use OAuth because it already works
and avoids storing a second long-lived secret. Note also that GCP org policies can
block service-account key creation outright.

Current Google docs describe the service-account setup as "add the SA email as a
user in your Google Ads account", with no Workspace domain-wide delegation or
impersonation subject. Older material and forum threads describe a DWD
requirement; if a service account ever errors with `NOT_ADS_USER`, the cause is
the SA not being added as an Ads user.

## Getting the token: the manager-account gate

**A developer token needs no credential at all.** Neither a service account, an
OAuth client, a JSON key, nor a linked Cloud project is required to obtain one.
The order is token first, credentials after. Both the developer-token page and the
Google Ads Help article confirm this.

The one hard prerequisite is a Google Ads **manager account (MCC)**. Per Google
Ads Help: "The API Center, where you can generate a developer token, is only
available within Google Ads Manager Accounts. If you have an individual admin
account, you must link it to an MCC account to obtain a developer token."

**Verified 2026-08-04:** account `766-795-4223` (WrenchLane), which is what
`GOOGLE_ADS_CUSTOMER_ID` points at, is a **standalone account**. Visiting
`ads.google.com/aw/apicenter` while signed in as `jacob@wrenchlane.com` returns:

> The API Centre is only available to manager accounts.

So an MCC has to be created before any token exists. Quick test for whether one
exists: open `ads.google.com/aw/apicenter`. If it loads, there is a manager
account. If it shows the message above, there is not.

### Creating the MCC

1. `ads.google.com/home/tools/manager-accounts` → Create a manager account.
2. Sign up with an email **not already associated with any Google Ads account**.
   `jacob@wrenchlane.com` is already on 766-795-4223, so it cannot be used. Create
   a **new Workspace user** such as `ads-api@wrenchlane.com`. An *alias* of an
   existing account will not do: it resolves to the same Google account.
3. In the manager account: Accounts → `+` → Link existing account → enter
   `766-795-4223` → approve the request from the WrenchLane account.
4. Linking is non-destructive. Campaigns, budgets and billing stay exactly as they
   are; the manager account only gains access.
5. API Center then appears **in the manager account**. Apply there.

Once linked, the two customer IDs are different things:

```
GOOGLE_ADS_CUSTOMER_ID       = 7667954223   # the ads account being queried
GOOGLE_ADS_LOGIN_CUSTOMER_ID = <MCC id>     # the manager account holding the token
```

### Applying, once the MCC exists

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
