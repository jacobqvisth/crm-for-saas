-- Add a website column to contacts.
-- Companies already have `website`; contacts did not, so there was no way to
-- record or view a person's website on the contact profile. This adds it so
-- the contact page can show + edit a website (and auto-discovery can fill it).

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS website text;

COMMENT ON COLUMN public.contacts.website IS
  'Website URL for this contact (their company/personal site). Mirrors companies.website.';
