-- Per-user profile + email signature
-- Signature is global to a person, applied automatically across every Gmail account
-- they have connected (multi-mailbox sequences pick up the right sig via gmail_accounts.user_id).

CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  title TEXT,
  signature_html TEXT,
  signature_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Each user can read/insert/update only their own row.
CREATE POLICY "users_select_own_profile"
  ON user_profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users_insert_own_profile"
  ON user_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_update_own_profile"
  ON user_profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Send-time lookup also needs to see signatures of other workspace members
-- (when a sequence rotates senders, the cron joins gmail_accounts.user_id → user_profiles
-- to find the signature of whoever is sending). Service-role queries bypass RLS, so
-- the cron path is fine without an extra policy. No additional SELECT policy needed.

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Per-step toggle to suppress signature on a specific email step
-- (e.g. one-line bump emails where a full sig would feel wrong).
ALTER TABLE sequence_steps
  ADD COLUMN include_signature BOOLEAN NOT NULL DEFAULT true;

COMMENT ON TABLE user_profiles IS
  'Per-user profile data (name, title, signature). One row per auth user; signature applies across all of their connected gmail_accounts.';
COMMENT ON COLUMN user_profiles.signature_html IS
  'Rendered HTML appended to outgoing sequence emails. Auto-suppressed on thread replies and when sequence_steps.include_signature = false.';
COMMENT ON COLUMN sequence_steps.include_signature IS
  'When false, the sender signature is not appended to this step''s outgoing email. Defaults to true.';
