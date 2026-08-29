import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { peekFlags } from "@/lib/tenant-config/runtime";
import { featureForPath, isCronPath } from "@/config/features";
import { CONTROL_PLANE_PREFIX } from "@/lib/control-plane/routes";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Feature gating, before auth.
  //
  // Doing it here rather than in each page and handler is the whole point: a
  // route that nobody remembered to guard is still guarded, and a customer
  // cannot reach another customer's feature by typing the URL. There are ~70
  // page and API routes; per-file guards would have meant ~70 chances to miss
  // one, and the one missed is the one that matters.
  //
  // Before auth, so a disabled route 404s whether or not you are signed in.
  // That also avoids telling an anonymous visitor which features exist by
  // bouncing them to /login for some paths and 404ing others.
  //
  // Crons are exempt: they answer 200 "skipped" from their own handler via
  // cronGate(). Two of them (/api/forums/mentions/scan and
  // /api/forums/candidates/scan) sit UNDER a gated prefix, so without this
  // check they would 404 here and Vercel would report a failing schedule every
  // day for a feature that is merely switched off.
  // The control-plane console is mounted only on the deployment that IS the
  // control plane. On a tenant deployment these routes must not exist at all —
  // 404, not 403, because a 403 confirms the console lives at this URL.
  //
  // The page and every server action re-check this themselves. Middleware is a
  // convenience, not the boundary: a server action reached by direct POST does
  // not necessarily pass through here.
  if (pathname === CONTROL_PLANE_PREFIX || pathname.startsWith(`${CONTROL_PLANE_PREFIX}/`)) {
    if (process.env.IS_CONTROL_PLANE !== "1") {
      return new NextResponse(null, { status: 404 });
    }
    return await updateSession(request);
  }

  if (!isCronPath(pathname)) {
    const feature = featureForPath(pathname);
    // peekFlags() never awaits a network call: it answers from a module-level
    // memo, falling back to the compiled defaults, and refreshes in the
    // background. Middleware runs on nearly every request, so blocking here
    // would put a control-plane round trip in front of the whole app.
    if (feature && peekFlags()[feature] !== true) {
      return new NextResponse(null, { status: 404 });
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/tracking (public tracking endpoints)
     *
     * /api/tracking stays excluded. Those endpoints are deliberately outside
     * middleware auth because open and click pixels are fetched by mail
     * clients with no session, and they belong to core outbound rather than to
     * any gated feature.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/tracking|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
