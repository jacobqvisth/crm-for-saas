-- Mirror the app workshop's billing payment status onto the linked CRM contact
-- so dynamic lists can target failed-payment recovery cohorts.
--
-- Why a contact-level column: the signal already lands on
-- `companies.payment_status` (propagate-to-crm writes it from
-- dashboard_workshops), but dynamic-list filters run as a single-table query
-- against `contacts` and cannot traverse the company relation. Chain-domain
-- collapse also means a contact's `company_id` is not always its own
-- workshop's company (e.g. Mekonomen branches share one chain company), so
-- the company column is the wrong join anyway.
--
-- Source: dashboard_workshops.payment_status, a tri-state from the core_app
-- S3 export: null (no subscription ever) | active | payment_failed. It flips
-- back to `active` once a card is fixed, which is what lets a
-- "failed payment" dynamic list drain itself.
alter table contacts add column if not exists payment_status text;

create index if not exists contacts_payment_status_idx
  on contacts (workspace_id, payment_status)
  where payment_status is not null;

comment on column contacts.payment_status is
  'Billing payment status of the app workshop this contact belongs to, mirrored from dashboard_workshops.payment_status by propagate-to-crm. Values: active | payment_failed | null (no subscription ever).';
