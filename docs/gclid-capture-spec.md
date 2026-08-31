# Capturing `gclid` and `landing_page` at signup

**Status:** the two columns exist and are empty. Nothing in this repo can fill
them — signup happens in the Wrenchlane app, a different codebase. This is the
spec for whoever changes it.

**Why it matters:** it is the difference between knowing which *campaign*
brought in a paying customer and knowing which *ad* and which *page* did. Today
we only have the former, and only because GA4 models it.

---

## The problem in one paragraph

There is no landing-page column and no click id anywhere in the CRM schema, so
"which page delivered this customer" has no answer from our own data. GA4 cannot
substitute: its `landingPagePlusQueryString` is session-scoped, so it answers
"which pages convert in a visit" and not "which page brought in someone who
signed up two visits later", and there is no `firstUserLandingPage` dimension at
all. `dashboard_users.ga_client_id` exists but GA4's reporting API does not
expose client id as a queryable dimension, so it cannot be joined back without
the BigQuery export.

The consequence is visible on `/dashboard/paying-customers`: attribution stops
at the campaign, and one Performance Max campaign carries 1,006 of 1,125
ad-driven signups, so campaign-level comparison has almost nothing to separate.

## What to capture

Two values, at the moment the account is created:

| Value | Where it comes from |
|---|---|
| `gclid` | the `?gclid=` query parameter on the first page of the visit |
| `landing_page` | the path of the first page of the visit, without the query string |

Also worth taking if it is free: `gbraid` and `wbraid`, which replace `gclid`
for iOS traffic where the click id is withheld.

## How to capture it

The click lands on the marketing site (`wrenchlane.com`) and the account is
created in the app (`app.wrenchlane.com`). Both already run the same GTM
container, so a first-party cookie on `.wrenchlane.com` survives the hop.

1. **On the marketing site**, on every page load, if `gclid` is present in the
   query string and no capture cookie exists yet, write one:

   ```js
   // .wrenchlane.com so app.wrenchlane.com can read it. 90 days matches the
   // Google Ads click lookback window; there is no point holding a click id
   // longer than Google will accept a conversion for.
   const params = new URLSearchParams(location.search);
   const gclid = params.get('gclid') ?? params.get('gbraid') ?? params.get('wbraid');
   if (gclid && !/(^|;\s*)wl_attr=/.test(document.cookie)) {
     const value = encodeURIComponent(JSON.stringify({
       gclid,
       landing_page: location.pathname,
       at: new Date().toISOString(),
     }));
     document.cookie =
       `wl_attr=${value}; domain=.wrenchlane.com; path=/; max-age=${90 * 86400}; SameSite=Lax; Secure`;
   }
   ```

   **First write wins, deliberately.** The value wanted is the click that
   started the relationship. Overwriting on a later visit turns a first-touch
   record into a last-touch one, which is a different measure that we already
   get from Google.

2. **In the app**, when the account is created, read `wl_attr` and persist
   `gclid` and `landing_page` on the user record. Do not fail the signup if the
   cookie is missing or unparseable — most signups will not have one, and an
   attribution field is never worth losing a customer over.

3. **In the core_app export**, add both fields to the user payload. The CRM sync
   then needs one line each in `src/lib/ceo/sync/sources/core-app.ts` to map them
   onto the columns that already exist:
   `dashboard_users.gclid` and `dashboard_users.landing_page`.

## What it unlocks the moment it lands

- **Exact offline conversion upload.** `src/lib/ceo/paying-customers/upload.ts`
  already prefers `gclid` over the hashed email whenever the column is set, with
  no further change. A click id is the click itself; a hashed email is a
  probabilistic match Google may or may not resolve.
- **Landing-page attribution for real.** Which page produced a paying customer,
  joined in our own database, rather than modelled by GA4.
- **Ad-level and keyword-level analysis**, via the Google Ads
  `click_view` resource, which is keyed on `gclid`.

## What it does not fix

`gclid` identifies the click, not the person. Someone who clicks an ad, forgets,
and comes back a week later by typing the address still arrives with no click id
and is still recorded as direct. That is a real ceiling on any click-id scheme
and is the reason the hashed-email path stays as a fallback rather than being
replaced.
