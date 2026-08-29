// The URL prefix the control-plane console is mounted at.
//
// Its own module so the middleware can import it without pulling in
// `server-only` code (auth.ts) or the Supabase client (db.ts), which would
// either fail to build for the edge runtime or bloat the middleware bundle.
export const CONTROL_PLANE_PREFIX = "/admin";
