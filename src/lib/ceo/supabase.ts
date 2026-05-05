import { createClient as createUntypedClient } from "@supabase/supabase-js";

// Compatibility shim: copied wl-dashboard code calls
// `createSupabaseServerClient` and `createSupabaseServiceClient`. CEO dashboard
// pages are gated by middleware to allowed emails only, are server-rendered,
// and never expose the client to the browser — so we route both to a
// service-role client. This bypasses RLS (intentional: dashboard_* RLS policies
// allow `authenticated` reads, which would leak this data to any CRM user
// otherwise).
//
// We use an *untyped* client (no Database generic) because CRM's generated
// `Database` type does not yet include the dashboard_* tables. Regenerating
// types is a follow-up; the dashboard query code is in CEO-namespaced files
// only and treats rows as Record<string, unknown> via the data layer.

function buildServiceClient() {
  return createUntypedClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export async function createSupabaseServerClient() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  return buildServiceClient();
}

export function createSupabaseServiceClient() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  return buildServiceClient();
}
