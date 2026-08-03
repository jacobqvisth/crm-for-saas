import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/next-path";

/** Paths reachable without a session. `/` server-redirects on its own. */
const PUBLIC_PATHS = ["/", "/login", "/auth"];

/**
 * Does this path need a signed-in user?
 *
 * Deny-list, not allow-list: anything that isn't explicitly public is gated.
 * The old hard-coded allow-list only named the sections that existed when it
 * was written, so every page added since (forums, calls, inbox, tasks,
 * discovery, videos, field routes) was left unguarded. A logged-out visitor
 * got the whole app shell instead of the login screen, and the first client
 * fetch failed with a bare "Unauthorized" banner — which is what forums users
 * were reporting. New sections are now protected by default.
 *
 * `/api/*` stays exempt on purpose: an API has to answer 401 JSON, not a 307
 * to an HTML login page, so route handlers keep doing their own auth checks.
 */
export function requiresAuth(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  return !PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
  );
}


export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Redirect unauthenticated users from protected routes to login, remembering
  // where they were headed so a shared deep link still lands after signing in.
  if (!user && requiresAuth(pathname)) {
    const url = request.nextUrl.clone();
    const next = `${pathname}${request.nextUrl.search}`;
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login — to wherever they were
  // originally headed if we captured it above, otherwise the dashboard.
  if (user && pathname === "/login") {
    // `next` can carry its own query string, so resolve it as a URL rather
    // than assigning it to `pathname` (which would escape the "?").
    const target = safeNextPath(request.nextUrl.searchParams.get("next")) ?? "/dashboard";
    return NextResponse.redirect(new URL(target, request.nextUrl.origin));
  }

  return supabaseResponse;
}
