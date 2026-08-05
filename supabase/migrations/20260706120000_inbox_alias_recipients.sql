-- Alias inbox lanes + send-as support.
--
-- Context: support@wrenchlane.com is a Google Workspace *alias* on the connected
-- mailbox hans@wrenchlane.com (as are hello@ and career@). Alias mail is delivered
-- into hans@'s single mailbox, so the mailbox-sync cron already ingests it — but
-- nothing recorded WHICH address the mail was sent to, so there was no way to (a)
-- filter the Inbox down to "just support@ mail" or (b) reply/send AS the alias.
--
-- This migration adds:
--   1. mailbox_aliases  — the registry of send-as / lane addresses per mailbox.
--   2. inbox_messages.to_emails / delivered_to — the recipients captured at sync
--      time so a message can be attributed to an alias lane.

-- 1. Alias registry ---------------------------------------------------------
create table if not exists public.mailbox_aliases (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  email_address    text not null,
  display_name     text,
  -- Whether the CRM may set From: this alias when sending. For Google Workspace
  -- domain aliases Gmail auto-registers a "send mail as" entry, so no extra
  -- OAuth scope / verification is needed to send from them.
  can_send_as      boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (gmail_account_id, email_address)
);

create index if not exists idx_mailbox_aliases_workspace
  on public.mailbox_aliases (workspace_id);

alter table public.mailbox_aliases enable row level security;

-- Mirror the gmail_accounts policy: workspace-scoped access.
drop policy if exists "Workspace access for mailbox_aliases" on public.mailbox_aliases;
create policy "Workspace access for mailbox_aliases"
  on public.mailbox_aliases
  using (workspace_id in (select get_user_workspace_ids()));

-- 2. Recipient capture on inbox_messages ------------------------------------
alter table public.inbox_messages
  add column if not exists to_emails    text[] not null default '{}',
  add column if not exists delivered_to text;

-- GIN index so the alias-lane filter (to_emails @> ARRAY['support@…']) is fast.
create index if not exists idx_inbox_messages_to_emails
  on public.inbox_messages using gin (to_emails);

-- 3. Seed hans@wrenchlane.com's wrenchlane.com aliases ----------------------
-- support@ is the address Jacob asked for; hello@ and career@ are the sibling
-- aliases on the same mailbox (per Google Workspace admin), seeded so all three
-- get a lane + send-as out of the box. Idempotent via the unique constraint.
insert into public.mailbox_aliases (workspace_id, gmail_account_id, email_address, display_name)
select ga.workspace_id, ga.id, v.email_address, v.display_name
from public.gmail_accounts ga
cross join (values
  ('support@wrenchlane.com', 'WrenchLane Support'),
  ('hello@wrenchlane.com',   'WrenchLane'),
  ('career@wrenchlane.com',  'WrenchLane Careers')
) as v(email_address, display_name)
where ga.email_address = 'hans@wrenchlane.com'
on conflict (gmail_account_id, email_address) do nothing;
