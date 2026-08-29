-- Profile pictures: store each user's avatar URL on their profile row.
-- The image itself lives in the public "avatars" Supabase Storage bucket
-- (created lazily by /api/settings/avatar); this column holds the public URL.
-- Also mirrored into auth.users.user_metadata.avatar_url so the sidebar — which
-- reads the auth session directly — shows it without an extra DB round-trip.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
