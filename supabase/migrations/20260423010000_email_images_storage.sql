-- Public storage bucket for images embedded in sequence/template emails.
-- Objects are written through the trusted upload API after workspace membership checks.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-images',
  'email-images',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public can read email images" ON storage.objects;
CREATE POLICY "public can read email images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'email-images');
