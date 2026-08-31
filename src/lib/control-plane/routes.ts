// The URL prefix the control-plane console is mounted at.
//
// Its own module so the middleware can import it without pulling in
// `server-only` code (auth.ts) or the Supabase client (db.ts), which would
// either fail to build for the edge runtime or bloat the middleware bundle.
export const CONTROL_PLANE_PREFIX = "/admin";

/** True on the deployment that IS the control plane. */
export function isControlPlaneDeployment(): boolean {
  return process.env.IS_CONTROL_PLANE === "1";
}

// The only paths the control-plane deployment serves.
//
// The console shares a codebase with the CRM, so the control-plane build also
// contains every tenant route: /contacts, /sequences, /api/cron/*, all of it.
// Those routes would run against NEXT_PUBLIC_SUPABASE_URL, which on this
// deployment points at the CONTROL-PLANE database. They cannot read customer
// data — it is not in that database — but they would render a broken CRM at a
// URL that looks like one, and a half-working CRM shell is a better phishing
// surface than a 404.
//
// So the gate is a deny-by-default allow-list rather than a list of things to
// block: a route added to the CRM tomorrow is closed here without anyone
// having to remember to close it.
//
//   /admin          the console itself
//   /api/config     the endpoint tenants pull their config from (self-gated too)
//   /api/heartbeat  where tenants report their own aggregate counts
//   /login          the console signs in through Supabase Auth like any page
//   /auth/callback  where Google returns
//
// `/` is handled separately: it redirects to the console rather than 404ing,
// because someone opening the bare hostname wants the console.
//
// ADD A ROUTE HERE WHEN YOU ADD ONE TO THE CONSOLE. Deny-by-default means a new
// control-plane endpoint 404s until it is listed, which is the right way round
// but does not announce itself: the route works locally, and returns 404 in
// production, with nothing in the logs to say why.
const CONTROL_PLANE_SURFACE = new Set([
  "/api/config",
  "/api/heartbeat",
  "/login",
  "/auth/callback",
]);

export function isControlPlaneSurface(pathname: string): boolean {
  if (pathname === CONTROL_PLANE_PREFIX || pathname.startsWith(`${CONTROL_PLANE_PREFIX}/`)) {
    return true;
  }
  return CONTROL_PLANE_SURFACE.has(pathname);
}
