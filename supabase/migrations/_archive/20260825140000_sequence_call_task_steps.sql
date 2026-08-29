-- Sequence steps: add "call" (follow-up call) and "task" step types.
--
-- Both are non-email steps that create a row in `tasks` for the enrolled
-- contact when the sequence reaches them, then let the sequence continue to
-- the next step (non-blocking — they never hold an enrollment open).

alter table sequence_steps
  drop constraint if exists sequence_steps_type_check;

alter table sequence_steps
  add constraint sequence_steps_type_check
  check (type = any (array['email'::text, 'delay'::text, 'condition'::text, 'call'::text, 'task'::text]));

alter table sequence_steps
  add column if not exists task_title text,
  add column if not exists task_description text,
  add column if not exists task_priority text default 'medium',
  add column if not exists task_due_days integer default 0;

alter table sequence_steps
  drop constraint if exists sequence_steps_task_priority_check;

alter table sequence_steps
  add constraint sequence_steps_task_priority_check
  check (task_priority is null or task_priority = any (array['low'::text, 'medium'::text, 'high'::text]));

comment on column sequence_steps.task_title is
  'Title for the task created by a call/task step. Falls back to a generated title when null.';
comment on column sequence_steps.task_description is
  'Optional notes copied into the created task''s description.';
comment on column sequence_steps.task_due_days is
  'Days after the step fires that the created task is due. 0 = due immediately.';

-- Tasks created by a sequence step point back at the step that made them, so
-- the same step firing twice for one enrollment can be detected.
alter table tasks
  add column if not exists sequence_step_id uuid references sequence_steps(id) on delete set null;

-- Deliberately NOT a partial index: ON CONFLICT inference (which PostgREST's
-- upsert relies on) cannot name an index predicate. Postgres treats NULLs as
-- distinct in a unique index, so hand-made tasks — which have neither column
-- set — are unaffected.
create unique index if not exists tasks_enrollment_step_uniq
  on tasks (enrollment_id, sequence_step_id);
