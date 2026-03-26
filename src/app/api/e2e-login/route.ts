import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * E2E test login route — only for automated testing, never for real users.
 * Creates/ensures a test user exists, signs them in server-side, and redirects
 * to /dashboard with the auth cookies set correctly.
 *
 * Security: requires CRON_SECRET as a query param.
 */
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const testEmail =
    process.env.TEST_USER_EMAIL || "e2e-test@wrenchlane-test.local";
  const testPassword = "e2e-test-password-crm-2026!";

  // Ensure test user exists with known password (admin client, never exposed to browser)
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = users?.find((u) => u.email === testEmail);

  if (!existingUser) {
    const { error } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: "E2E Test User" },
    });
    if (error) {
      return NextResponse.json(
        { error: `Failed to create test user: ${error.message}` },
        { status: 500 }
      );
    }
  } else {
    await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
      password: testPassword,
    });
  }

  // Sign in server-side and set auth cookies on the redirect response
  const redirectResponse = NextResponse.redirect(
    new URL("/dashboard", request.url)
  );

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signInError) {
    return NextResponse.json(
      { error: `Sign in failed: ${signInError.message}` },
      { status: 500 }
    );
  }

  return redirectResponse;
}
