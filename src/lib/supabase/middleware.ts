import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedRoutes = [
  "/dashboard",
  "/contacts",
  "/companies",
  "/deals",
  "/sequences",
  "/lists",
  "/templates",
  "/settings",
  "/ceo",
];

const CEO_ALLOWED_EMAILS = (process.env.CEO_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isCeoUser(email?: string | null): boolean {
  if (!email) return false;
  if (CEO_ALLOWED_EMAILS.length === 0) return false;
  const normalized = email.toLowerCase();
  return CEO_ALLOWED_EMAILS.some((entry) =>
    entry.startsWith("@") ? normalized.endsWith(entry) : normalized === entry,
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

  // Check if the route is protected
  const isProtected = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  // Redirect unauthenticated users from protected routes to login
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users from login to dashboard
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Gate /ceo/* to allowlisted emails only — non-CEO authenticated users go
  // back to the regular dashboard. The /api/ceo-sync/* cron routes are
  // authenticated by SYNC_SECRET, not user session, so they bypass this gate.
  if (
    user &&
    (pathname === "/ceo" || pathname.startsWith("/ceo/")) &&
    !isCeoUser(user.email)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
