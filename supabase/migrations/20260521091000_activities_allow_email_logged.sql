-- The "Log activity" modal on company detail offers an "Email (logged)" type
-- (src/components/companies/detail/log-activity-modal.tsx). It inserts
-- type='email_logged', which is not in the existing CHECK list — so every
-- such insert silently fails. As of this migration, prod has zero rows with
-- type='email_logged' despite 82 notes + 3 calls created from the same modal.
--
-- Widen the constraint to accept 'email_logged' for the manual-email case.

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;

ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (
  type IN (
    'email_sent',
    'email_received',
    'email_opened',
    'email_clicked',
    'email_bounced',
    'email_logged',
    'link_clicked',
    'contact_unsubscribed',
    'contact_created',
    'call',
    'meeting',
    'note',
    'task',
    'system',
    'deal_stage_change',
    'sequence_paused',
    'field_visit',
    'route_stop_removed'
  )
);
