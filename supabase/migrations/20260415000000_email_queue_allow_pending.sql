-- Allow 'pending' status in email_queue for draft/paused sequence enrollments.
-- When a contact is enrolled into a draft or paused sequence, queue rows are
-- inserted with status='pending'. When the sequence is activated, pending rows
-- are promoted to 'scheduled' so the cron picks them up.
ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_status_check;
ALTER TABLE public.email_queue ADD CONSTRAINT email_queue_status_check
  CHECK (status = ANY (ARRAY['pending','scheduled','sending','sent','failed','cancelled']));
