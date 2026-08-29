-- Phase 06, release N of the expand/contract pair.
--
-- Three additive changes so the app can talk about "mail" rather than "Gmail"
-- without a single tenant's sending path moving underneath it.
--
-- R3 COMPLIANCE. Nothing here drops, renames, retypes or narrows anything. A
-- deployment running the PREVIOUS release against this schema keeps working:
-- it goes on reading `gmail_accounts` and `gmail_thread_id`, both untouched.
--
-- Release N+1, once every tenant is confirmed on this code, is where
-- `gmail_accounts` and the `gmail_thread_id` columns finally go. Not before.

-- ---------------------------------------------------------------------------
-- 1. Which provider a mailbox belongs to.
-- ---------------------------------------------------------------------------
-- Defaults to 'google', so every existing row is correct without a backfill.
--
-- The CHECK deliberately allows 'microsoft' from the very beginning even though
-- nothing can create such a row until phase 07. Adding the value later would
-- mean WIDENING a constraint, and while widening is permitted, a release that
-- has to widen before it can insert is a release with an ordering bug waiting
-- in it. Cheaper to be inclusive now.
alter table public.gmail_accounts
  add column if not exists provider text not null default 'google';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gmail_accounts_provider_check'
  ) then
    alter table public.gmail_accounts
      add constraint gmail_accounts_provider_check
      check (provider in ('google', 'microsoft'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. `mail_accounts`, the name the application now uses.
-- ---------------------------------------------------------------------------
-- A VIEW over the existing table rather than a copy.
--
-- The phase 06 brief describes creating a new table, backfilling it and
-- dual-writing. This inverts that: `mail_accounts` is the view and
-- `gmail_accounts` stays the table. Same end state, strictly less risk —
-- there is exactly one copy of every row, so the two names cannot drift, no
-- dual-write can be missed, and the rename in release N+1 becomes a rename
-- rather than a reconciliation. Wrenchlane is sending live from this table
-- while we work, which is what tips the balance.
--
-- A simple single-table view is automatically updatable in Postgres, so
-- INSERT, UPDATE and DELETE through `mail_accounts` all reach the base table.
--
-- security_invoker = true is load-bearing: without it the view would run as its
-- OWNER and quietly bypass the RLS policies on gmail_accounts, turning a rename
-- into a workspace-isolation hole.
create or replace view public.mail_accounts
  with (security_invoker = true)
  as select * from public.gmail_accounts;

comment on view public.mail_accounts is
  'Provider-agnostic name for gmail_accounts. Updatable single-table view; security_invoker so RLS on the base table still applies. The base table is renamed in the release-N+1 contract step.';

-- ---------------------------------------------------------------------------
-- 3. Provider-tagged thread keys.
-- ---------------------------------------------------------------------------
-- Gmail's threadId and Microsoft Graph's conversationId are NOT the same idea.
-- They have different lifetimes and different rules about when two messages
-- belong together, so storing a Graph conversationId in a column called
-- gmail_thread_id would be a lie that surfaces as mis-threaded replies in a
-- customer's inbox months later.
--
-- New nullable column, backfilled from the existing one. The old column stays
-- and stays populated this release.
alter table public.email_queue    add column if not exists thread_key text;
alter table public.inbox_messages add column if not exists thread_key text;

update public.email_queue
   set thread_key = gmail_thread_id
 where thread_key is null and gmail_thread_id is not null;

update public.inbox_messages
   set thread_key = gmail_thread_id
 where thread_key is null and gmail_thread_id is not null;

create index if not exists inbox_messages_thread_key_idx
  on public.inbox_messages (thread_key);

comment on column public.email_queue.thread_key is
  'Provider-scoped conversation key. Gmail threadId or Graph conversationId, per the sending account''s provider.';
comment on column public.inbox_messages.thread_key is
  'Provider-scoped conversation key. Gmail threadId or Graph conversationId, per the receiving account''s provider.';
