import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getTenant } from "@/config/tenants";
import { featureForPath, isCronPath } from "@/config/features";

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
  if (!isCronPath(pathname)) {
    const feature = featureForPath(pathname);
    if (feature && getTenant().features[feature] !== true) {
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
