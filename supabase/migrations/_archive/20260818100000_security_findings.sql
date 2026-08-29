-- Hacker Rating: security posture tracking for the CRM itself.
-- These tables are NOT workspace-scoped — findings and scans are about the
-- application (its code, config, dependencies, headers), not tenant data.
-- This is a single-tenant internal-staff tool, so any authenticated staff
-- member may read findings and toggle their status; the automated cron/CI
-- writers use the service-role client (which bypasses RLS).

-- ---------------------------------------------------------------------------
-- security_findings: one row per discovered issue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_findings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- stable human key so re-scans upsert instead of duplicating (e.g. "H1", "M3", or a scan slug)
  finding_key   TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
                  'auth','idor','xss','injection','secrets','headers',
                  'deps','cron','rls','config','external','other')),
  severity      TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                  'open','fixed','accepted_risk','wont_fix')),
  affected_path TEXT,
  description   TEXT NOT NULL,
  remediation   TEXT,
  source        TEXT NOT NULL DEFAULT 'manual_audit' CHECK (source IN (
                  'manual_audit','daily_scan','ci_scan')),
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fixed_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_findings_status_idx   ON public.security_findings (status);
CREATE INDEX IF NOT EXISTS security_findings_severity_idx ON public.security_findings (severity);
CREATE INDEX IF NOT EXISTS security_findings_category_idx ON public.security_findings (category);

-- ---------------------------------------------------------------------------
-- security_scans: one row per automated scan run (live probe or CI static).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  scan_type       TEXT NOT NULL CHECK (scan_type IN ('live_probe','ci_static')),
  passed          BOOLEAN NOT NULL DEFAULT true,
  severity_counts JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {critical,high,medium,low,info}
  details         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of per-check {name,ok,detail}
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_scans_ran_at_idx ON public.security_scans (ran_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance (mirrors the app-wide update_updated_at trigger).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.security_findings;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.security_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: authenticated staff read everything and may update finding status;
-- inserts/scan writes come from the service-role client (bypasses RLS).
-- ---------------------------------------------------------------------------
ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_scans    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_findings_select ON public.security_findings;
CREATE POLICY security_findings_select ON public.security_findings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS security_findings_insert ON public.security_findings;
CREATE POLICY security_findings_insert ON public.security_findings
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS security_findings_update ON public.security_findings;
CREATE POLICY security_findings_update ON public.security_findings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS security_scans_select ON public.security_scans;
CREATE POLICY security_scans_select ON public.security_scans
  FOR SELECT TO authenticated USING (true);
