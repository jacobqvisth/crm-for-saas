-- Add DTC fault codes to the Videos page. We target videos built around one
-- or more specific Diagnostic Trouble Codes (P0420, P0171, P0301, …) because
-- those map directly onto the Wrenchlane app reading the code and walking a
-- DIY owner through the fix.
--
-- dtc_codes is the set of codes the video diagnoses, shown as badges on the
-- card and stored alongside the curated list in src/lib/videos/seed.ts.

ALTER TABLE diagnostic_videos
  ADD COLUMN IF NOT EXISTS dtc_codes TEXT[] NOT NULL DEFAULT '{}';
