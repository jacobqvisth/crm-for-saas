-- Move internal-test exclusion list from src/config/ceo/internal-test-users.ts
-- into the database so it can be managed from the CEO settings UI without
-- requiring a redeploy. The static const file becomes a seed-only artifact;
-- runtime helpers read from these tables.
--
-- Three concepts:
--   1. dashboard_users.is_internal_test         — flag the user as internal
--   2. dashboard_users.is_internal_test_exempt  — override: count this user
--      even if their workshop is flagged internal
--   3. dashboard_workshops.is_internal_test     — flag the whole workshop
--   4. dashboard_internal_test_patterns         — email / username fallback
--      patterns used when a row doesn't have a matched user record
--
-- Backfill values match src/config/ceo/internal-test-users.ts as of 2026-05-08.

ALTER TABLE public.dashboard_users
  ADD COLUMN IF NOT EXISTS is_internal_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_internal_test_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS internal_test_note text,
  ADD COLUMN IF NOT EXISTS internal_test_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_test_set_by text;

CREATE INDEX IF NOT EXISTS dashboard_users_is_internal_test_idx
  ON public.dashboard_users (is_internal_test) WHERE is_internal_test = true;

CREATE INDEX IF NOT EXISTS dashboard_users_is_internal_test_exempt_idx
  ON public.dashboard_users (is_internal_test_exempt) WHERE is_internal_test_exempt = true;

ALTER TABLE public.dashboard_workshops
  ADD COLUMN IF NOT EXISTS is_internal_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS internal_test_note text,
  ADD COLUMN IF NOT EXISTS internal_test_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_test_set_by text;

CREATE INDEX IF NOT EXISTS dashboard_workshops_is_internal_test_idx
  ON public.dashboard_workshops (is_internal_test) WHERE is_internal_test = true;

CREATE TABLE IF NOT EXISTS public.dashboard_internal_test_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('email', 'username')),
  value text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_internal_test_patterns_kind_value_idx
  ON public.dashboard_internal_test_patterns (kind, lower(value));

ALTER TABLE public.dashboard_internal_test_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read internal test patterns"
  ON public.dashboard_internal_test_patterns;
CREATE POLICY "authenticated can read internal test patterns"
  ON public.dashboard_internal_test_patterns FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- Seed: internal-test workshops (8)
-- ---------------------------------------------------------------------------
INSERT INTO public.dashboard_workshops (
  workshop_id, name, is_internal_test, internal_test_note, internal_test_set_at
)
VALUES
  ('37ea2318-890a-401e-9c62-107e71a18341', 'CodeOC', true, 'CodeOC', now()),
  ('472ab9b9-77f5-4a4f-af82-8adfc1c8a759', 'Matteo self-service', true, 'Matteo self-service', now()),
  ('4c0aef67-a98b-49e5-b0ea-82f22642de2b', 'Apple', true, 'Apple', now()),
  ('adb85343-1a35-45e8-9a99-4a80ddaa5ca9', 'Android', true, 'Android', now()),
  ('ebc4d121-7990-4381-81f9-f149dca8a0cf', 'Edward''s workshop', true, 'Edward''s workshop', now()),
  ('2c4284e5-d879-40a6-9bfe-f8b3b33633e8', 'xxx (happymachineholdings.com)', true, 'xxx (happymachineholdings.com)', now()),
  ('bfa2f4b8-75df-41ff-949e-0693e0a00898', 'Magnus test', true, 'Magnus test', now()),
  ('c623f3b1-e07d-4042-b56a-d945769bfcd1', 'Internal — Magnus (codeoc.ai)', true, 'Internal — Magnus (codeoc.ai)', now())
ON CONFLICT (workshop_id) DO UPDATE SET
  is_internal_test = true,
  internal_test_note = COALESCE(public.dashboard_workshops.internal_test_note, EXCLUDED.internal_test_note),
  internal_test_set_at = COALESCE(public.dashboard_workshops.internal_test_set_at, EXCLUDED.internal_test_set_at);

-- ---------------------------------------------------------------------------
-- Seed: internal-test users (14)
-- ---------------------------------------------------------------------------
INSERT INTO public.dashboard_users (
  internal_user_id, is_internal_test, internal_test_note, internal_test_set_at
)
VALUES
  ('e0bcb9cc-6061-7079-a1e8-766b52daa75f', true, 'hans_m (CodeOC)', now()),
  ('606c29fc-d0a1-70ff-c6f9-d3664c55e1e2', true, 'edward_wrenchlane', now()),
  ('c0ac193c-3031-70bc-c6be-d01891b07cde', true, 'dogutest-apple (Apple)', now()),
  ('800ca92c-9081-70fe-9e77-38d79a1628d2', true, 'jacobqvisth (CodeOC)', now()),
  ('d0dc99ac-7071-708c-9ff1-cbecd8fa58f9', true, 'matteo.circa@gmail.com (Matteo self-service)', now()),
  ('102c49fc-a0c1-70c0-4bca-1b190487b61e', true, 'dogu+test2@wrenchlane.com', now()),
  ('d03cb99c-8001-7026-c5c6-cd1035e6daa0', true, 'huntersb003@gmail.com', now()),
  ('507cb90c-90d1-706d-20df-7025bb8fcb67', true, 'edwardc (CodeOC)', now()),
  ('10eca93c-b061-705c-ec16-c4808fdce794', true, 'ejcintron (Edward''s workshop)', now()),
  ('006cf93c-2071-707e-8fcd-5ac8d4f2241e', true, 'hans@codeoc.ai (CodeOC)', now()),
  ('f0dc599c-f061-7079-6942-ee9601bc1f49', true, 'hans@bitknife.se', now()),
  ('208c999c-c011-7079-a288-a854c7bb3c5a', true, 'magnusx (xxx)', now()),
  ('e07c793c-40a1-70cf-254f-2273ca563e14', true, 'magnus-magnustest (Magnus test)', now()),
  ('b0bc599c-40f1-70f9-dad8-8168bacaebf1', true, 'Internal Magnus (codeoc.ai)', now())
ON CONFLICT (internal_user_id) DO UPDATE SET
  is_internal_test = true,
  internal_test_note = COALESCE(public.dashboard_users.internal_test_note, EXCLUDED.internal_test_note),
  internal_test_set_at = COALESCE(public.dashboard_users.internal_test_set_at, EXCLUDED.internal_test_set_at);

-- ---------------------------------------------------------------------------
-- Seed: exempt users (3) — counted despite living inside an internal workshop
-- ---------------------------------------------------------------------------
INSERT INTO public.dashboard_users (
  internal_user_id, is_internal_test_exempt, internal_test_note, internal_test_set_at
)
VALUES
  ('50bc99ec-e001-7072-467a-15cff025c35c', true, 'jesperh (real CodeOC user — exempt)', now()),
  ('707cf9cc-b091-70ce-433c-73dda2978e4d', true, 'maptun_1 (real CodeOC user — exempt)', now()),
  ('f09cf9bc-2061-70c4-00cc-43408e8b44e9', true, 'peter_thomassons (real CodeOC user — exempt)', now())
ON CONFLICT (internal_user_id) DO UPDATE SET
  is_internal_test_exempt = true,
  internal_test_note = COALESCE(public.dashboard_users.internal_test_note, EXCLUDED.internal_test_note),
  internal_test_set_at = COALESCE(public.dashboard_users.internal_test_set_at, EXCLUDED.internal_test_set_at);

-- ---------------------------------------------------------------------------
-- Seed: email + username patterns (fallback when no user record matches)
-- ---------------------------------------------------------------------------
INSERT INTO public.dashboard_internal_test_patterns (kind, value, note)
VALUES
  ('email', 'matteo.circa@gmail.com', NULL),
  ('email', 'dogu+test2@wrenchlane.com', NULL),
  ('email', 'huntersb003@gmail.com', NULL),
  ('email', 'hans@wrenchlane.com', NULL),
  ('email', 'hans@codeoc.ai', NULL),
  ('email', 'hans@bitknife.se', NULL),
  ('username', 'hans_m', NULL),
  ('username', 'edward_wrenchlane', NULL),
  ('username', 'dogutest-apple', NULL),
  ('username', 'jacobqvisth', NULL)
ON CONFLICT (kind, lower(value)) DO NOTHING;
