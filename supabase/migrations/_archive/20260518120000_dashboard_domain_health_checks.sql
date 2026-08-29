-- Daily domain-health snapshot for wrenchlane.com.
-- Cron at 08:30 UTC writes one row per run: DNS auth records, blocklist
-- status, and the trailing-24h send-health metrics from email_queue +
-- email_events. The /api/cron/domain-health route diffs the latest two
-- rows and notifies via SLACK_ALERT_WEBHOOK_URL on regression.

CREATE TABLE IF NOT EXISTS public.dashboard_domain_health_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),

  -- Snapshot of the DNS records we care about. Shape:
  --   { spf: { value, ok }, dkim: { selector, value, ok },
  --     dmarc: { value, policy, ok }, mx: { value, ok } }
  dns_records jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Per-blocklist verdict. Shape:
  --   [{ list: 'dbl.spamhaus.org', listed: false, raw: '...', note: '...' }, ...]
  blocklists  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Trailing-24h send metrics. Shape:
  --   { sent, bounces, unsubscribes, replies, bounce_rate, unsubscribe_rate,
  --     volume_vs_7d_avg, queue_failures }
  send_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ok | warning | critical
  status      text NOT NULL CHECK (status IN ('ok','warning','critical')),

  -- Human-readable alert lines. Empty when status='ok'.
  alerts      jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Free-text from the runner — exception messages, partial-failure notes.
  run_notes   text
);

CREATE INDEX IF NOT EXISTS dashboard_domain_health_checks_domain_checked_at_idx
  ON public.dashboard_domain_health_checks (domain, checked_at DESC);

COMMENT ON TABLE public.dashboard_domain_health_checks IS
  'Daily DNS + reputation + send-health snapshot per sending domain (currently wrenchlane.com). Written by /api/cron/domain-health.';
