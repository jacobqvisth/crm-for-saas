import { createClient } from '@supabase/supabase-js';

const url = process.env.KUNDBOLAGET_SUPABASE_URL;
const key = process.env.KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('KUNDBOLAGET_SUPABASE_URL or KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY missing from env');
}

export const kb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' }
});
