-- Add source column to contacts to track where contacts came from
-- Values: 'csv_import', 'manual', 'prospector', null (unknown)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT;
