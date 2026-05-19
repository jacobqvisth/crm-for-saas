-- Widen activities.type CHECK constraint so all types the application code
-- actually inserts are accepted. Before this migration, only email_sent /
-- email_received / email_opened / email_clicked / call / meeting / note /
-- task / deal_stage_change / contact_created passed — everything else
-- (field_visit, route_stop_removed, system, link_clicked,
-- contact_unsubscribed, email_bounced, sequence_paused) silently failed.
-- The "Mark visited" modal in field routes surfaced this because logVisit
-- is one of the few call sites that propagates the insert error.

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;

ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (
  type IN (
    'email_sent',
    'email_received',
    'email_opened',
    'email_clicked',
    'email_bounced',
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
