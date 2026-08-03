import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  POST_LOGIN_NEXT_COOKIE,
  decodeNextCookie,
  safeNextPath,
} from "@/lib/auth/next-path";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // The destination the middleware captured. It travels in a cookie because
  // putting it on `redirectTo` broke the allow-list match (see
  // POST_LOGIN_NEXT_COOKIE). A `?next=` query param is still honoured for
  // hand-made links, but it is user-controllable either way, so both go
  // through safeNextPath and anything off-site falls back to the dashboard.
  const cookieStore = await cookies();
  const next =
    safeNextPath(searchParams.get("next")) ??
    decodeNextCookie(cookieStore.get(POST_LOGIN_NEXT_COOKIE)?.value) ??
    "/dashboard";

  /** Consume the stashed destination so it can't misdirect a later sign-in. */
  const clearNextCookie = (res: NextResponse) => {
    res.cookies.set(POST_LOGIN_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if user has a workspace, create one if not
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: memberships } = await supabase
          .from("workspace_members")
          .select("workspace_id")
          .eq("user_id", user.id)
          .limit(1);

        if (!memberships || memberships.length === 0) {
          const userEmail = user.email || "";
          const emailDomain = userEmail.split("@")[1]?.toLowerCase();

          // Use service-role client for domain lookup (new user has no workspace yet, RLS blocks)
          const serviceClient = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

          let targetWorkspaceId: string | null = null;

          if (emailDomain) {
            // Match either the primary domain OR any registered alias
            // (e.g. wrenchlane.co users land in the wrenchlane.com workspace).
            const { data: byDomain } = await serviceClient
              .from("workspaces")
              .select("id")
              .eq("domain", emailDomain)
              .limit(1)
              .maybeSingle();

            if (byDomain) {
              targetWorkspaceId = byDomain.id;
            } else {
              const { data: byAlias } = await serviceClient
                .from("workspaces")
                .select("id")
                .contains("domain_aliases", [emailDomain])
                .limit(1)
                .maybeSingle();
              if (byAlias) {
                targetWorkspaceId = byAlias.id;
              }
            }
          }

          // Onboarding writes were silently swallowed before this hardening.
          // A failure on any of them put the user into a broken state:
          // signed in but with no workspace membership or no owner record.
          // The user would see an empty dashboard with no obvious error.
          // Now each insert is checked and any failure short-circuits to
          // /login?error=onboarding so the user gets feedback + can retry
          // instead of landing in limbo.
          if (targetWorkspaceId) {
            const { error: joinError } = await serviceClient
              .from("workspace_members")
              .insert({
                workspace_id: targetWorkspaceId,
                user_id: user.id,
                role: "member",
              });
            if (joinError) {
              console.error(
                `[auth/callback] join workspace ${targetWorkspaceId} for user ${user.id}:`,
                joinError,
              );
              return clearNextCookie(
                NextResponse.redirect(`${origin}/login?error=onboarding`),
              );
            }
          } else {
            // No matching workspace — create a new one
            const workspaceName =
              user.user_metadata?.full_name
                ? `${user.user_metadata.full_name}'s Workspace`
                : "My Workspace";

            const { data: workspace, error: workspaceError } = await serviceClient
              .from("workspaces")
              .insert({
                name: workspaceName,
                domain: emailDomain || null,
              })
              .select("id")
              .single();

            if (workspaceError || !workspace) {
              console.error(
                `[auth/callback] create workspace for user ${user.id}:`,
                workspaceError ?? "no row returned",
              );
              return clearNextCookie(
                NextResponse.redirect(`${origin}/login?error=onboarding`),
              );
            }

            const { error: ownerError } = await serviceClient
              .from("workspace_members")
              .insert({
                workspace_id: workspace.id,
                user_id: user.id,
                role: "owner",
              });
            if (ownerError) {
              console.error(
                `[auth/callback] add owner ${user.id} to workspace ${workspace.id}:`,
                ownerError,
              );
              return clearNextCookie(
                NextResponse.redirect(`${origin}/login?error=onboarding`),
              );
            }
          }
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      const base = !isLocalEnv && forwardedHost ? `https://${forwardedHost}` : origin;
      return clearNextCookie(NextResponse.redirect(`${base}${next}`));
    }
  }

  // Auth code exchange failed
  return clearNextCookie(NextResponse.redirect(`${origin}/login?error=auth`));
}
