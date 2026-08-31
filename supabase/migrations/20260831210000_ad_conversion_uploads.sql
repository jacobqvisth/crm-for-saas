-- Sending real payments back to Google, and the two columns that would make the
-- join exact instead of modelled.
--
-- WHY THIS IS NOT THE GOOGLE ADS API. Offline conversion import through
-- `ConversionUploadService` is closed to new integrations — verified against
-- this account, which answers CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE for
-- both a gclid and a hashed email, so it is the service that is shut and not
-- the identifier. Google routes new integrations to the Data Manager API
-- (datamanager.googleapis.com), which needs an OAuth scope this app's refresh
-- token does not carry. `scripts/google-datamanager-setup.mjs` mints one.
--
-- WHAT GETS UPLOADED. One event per workshop that Stripe has actually charged,
-- keyed on the SHA-256 of the user's lowercase-trimmed email. That hash is
-- already stored — `dashboard_users.email_hash` matches
-- `sha256(lower(trim(email)))` on 1,854 of 1,856 users — so nothing here ever
-- handles a raw address.
--
-- ADDITIVE ONLY: one new table and two nullable columns.

-- ------------------------------------------------------------------ ledger
-- What has already been sent, so a re-run cannot double-count a customer.
--
-- Belt and braces with `transaction_id`, which is also sent to Google and is
-- derived from the workshop and its payment date: the ledger stops us sending
-- twice, and the transaction id stops Google counting twice if we do anyway.
-- A failed row is kept rather than deleted, because "we tried and Google
-- refused" is the thing worth seeing on the next run.
create table if not exists public.dashboard_ad_conversion_uploads (
  workshop_id          text not null,
  conversion_action_id text not null,
  transaction_id       text not null,
  event_timestamp      timestamptz not null,
  conversion_value     numeric,
  currency             text,
  -- 'hashed_email' today. 'gclid' once the app captures one, which needs no
  -- change here: the upload prefers a gclid whenever the column below is set.
  identifier_kind      text not null,
  status               text not null,
  error                text,
  uploaded_at          timestamptz not null default now(),
  primary key (workshop_id, conversion_action_id)
);

comment on table public.dashboard_ad_conversion_uploads is
  'Ledger of payment events sent to Google via the Data Manager API. One row per (workshop, conversion action); a failed attempt is kept, not deleted.';

create index if not exists dashboard_ad_conversion_uploads_status_idx
  on public.dashboard_ad_conversion_uploads (status);

alter table public.dashboard_ad_conversion_uploads enable row level security;

-- -------------------------------------------------------- the missing join
-- There is no landing-page column and no gclid column anywhere in this schema,
-- which is why "which page delivered this customer" has never been answerable
-- and why attribution stops at the campaign. GA4 cannot fill either gap: it has
-- no firstUserLandingPage dimension at all, and its click ids are not exposed
-- to the reporting API.
--
-- These are deliberately added BEFORE anything writes them. Nothing in this
-- repo can: signup happens in the Wrenchlane app, a separate codebase. Adding
-- the columns now means the day the app forwards them there is somewhere to put
-- them, the upload switches from a modelled email match to an exact click match
-- with no further migration, and the shape of what is being asked for is
-- written down rather than described in a message.
alter table public.dashboard_users
  add column if not exists gclid text;

alter table public.dashboard_users
  add column if not exists landing_page text;

comment on column public.dashboard_users.gclid is
  'Google click id from the ad that brought this user in, captured at signup. Written by the app, not by this repo. When present the Data Manager upload keys on it instead of the hashed email, which makes the match exact rather than probabilistic.';

comment on column public.dashboard_users.landing_page is
  'First landing page path, captured at signup. Written by the app, not by this repo. The only way to answer which page delivered a paying customer; GA4 has no first-touch landing page dimension.';
