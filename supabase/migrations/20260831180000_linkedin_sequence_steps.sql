-- Sequence steps: add "linkedin_invite" and "linkedin_message".
--
-- Both behave exactly like the existing `call` and `task` steps: they create a
-- row in `tasks` for the enrolled contact when the sequence reaches them, then
-- let the sequence carry on to the next step. Nothing is sent automatically.
--
-- WHY A TASK AND NOT A SEND
-- -------------------------
-- LinkedIn has no API that can send a connection request or a member-to-member
-- message, at any tier, to any partner. Every tool that does it (Lemlist
-- included) drives a real logged-in session outside LinkedIn's terms, and the
-- risk lands on the customer's account rather than on the vendor. Modelling
-- the step as a task keeps that decision open: a rep does the send today, and
-- if a sending provider is ever wired in, it slots in behind these same rows.
--
-- Additive only, per the productisation ground rule that tenants may run
-- different releases: an older deployment simply never writes these types.

alter table sequence_steps
  drop constraint if exists sequence_steps_type_check;

alter table sequence_steps
  add constraint sequence_steps_type_check
  check (type = any (array[
    'email'::text,
    'delay'::text,
    'condition'::text,
    'call'::text,
    'task'::text,
    'linkedin_invite'::text,
    'linkedin_message'::text
  ]));

-- The message itself, kept apart from `task_description` (which is notes for
-- the rep) because it is the text that actually gets sent. A future sending
-- provider reads this column and nothing else.
alter table sequence_steps
  add column if not exists linkedin_body text;

comment on column sequence_steps.linkedin_body is
  'Connection-request note or LinkedIn message body. Supports the same {{variables}} as email steps. LinkedIn caps an invitation note at 300 characters; the editor enforces it, the database deliberately does not, because a linkedin_message step has no such limit.';

-- `tasks.type` already permits ''linkedin'' (it has since the tasks table was
-- created), so no constraint change is needed there.
