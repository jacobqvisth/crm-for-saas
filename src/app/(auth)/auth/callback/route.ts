import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  POST_LOGIN_NEXT_COOKIE,
  decodeNextCookie,
  safeNextPath,
} from "@/lib/auth/next-path";
import {
  CONTROL_PLANE_PREFIX,
  isControlPlaneDeployment,
} from "@/lib/control-plane/routes";
import { getTenant } from "@/config/tenants";
import { resolveHomeRoute } from "@/config/home-route";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // The destination the middleware captured. It travels in a cookie because
  // putting it on `redirectTo` broke the allow-list match (see
  // POST_LOGIN_NEXT_COOKIE). A `?next=` query param is still honoured for
  // hand-made links, but it is user-controllable either way, so both go
  // through safeNextPath and anything off-site falls back to the dashboard.
  //
  // The final fallback is the tenant's own home route, not "/dashboard".
  // "/dashboard" belongs to the `product_analytics` feature, so on a tenant
  // without it a correct sign-in ended on a 404. See src/config/home-route.ts.
  const cookieStore = await cookies();
  const tenant = getTenant();
  const next =
    safeNextPath(searchParams.get("next")) ??
    decodeNextCookie(cookieStore.get(POST_LOGIN_NEXT_COOKIE)?.value) ??
    resolveHomeRoute((key) => tenant.features[key]);

  /** Consume the stashed destination so it can't misdirect a later sign-in. */
  const clearNextCookie = (res: NextResponse) => {
    res.cookies.set(POST_LOGIN_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // The control-plane console signs in through this same callback, but it
      // must not run a line of the tenant onboarding below.
      //
      // On that deployment NEXT_PUBLIC_SUPABASE_URL points at the control-plane
      // database, which has no `workspace_members` and no `workspaces`. The
      // membership lookup would error, the empty result would be read as "new
      // user", the workspace insert would fail against a table that does not
      // exist, and a legitimate super admin would be bounced to
      // /login?error=onboarding with nothing in the UI explaining why.
      //
      // Authorisation for the console is by email in requireSuperAdmin(), which
      // the page and every server action re-check. There is no workspace to
      // join, so there is nothing to do here but go to it.
      if (isControlPlaneDeployment()) {
        return clearNextCookie(
          NextResponse.redirect(`${origin}${CONTROL_PLANE_PREFIX}`),
        );
      }

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
          // MICROSOFT IDENTITIES, checked in phase 11.
          //
          // This path is provider-agnostic, but it read exactly two fields and
          // both of them are ones Entra can decline to send:
          //
          //   user.email       Entra omits it when the account has no `mail`
          //                    attribute set, which is common for accounts
          //                    created without a mailbox. Supabase then carries
          //                    the address only as `preferred_username`.
          //   full_name        Supabase maps Google's claim to it directly;
          //                    Entra sends `name`.
          //
          // Without these fallbacks a Microsoft user with either quirk gets a
          // brand new workspace called "My Workspace" with a null domain, and
          // sits alone in it, instead of joining their colleagues. That is not
          // an error anyone would see: it looks like an empty CRM.
          //
          // Google always sends both fields, so for Wrenchlane every fallback
          // below is dead code and behaviour is unchanged.
          const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
          const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
          const preferred = str(meta.preferred_username);
          const userEmail =
            user.email ||
            str(meta.email) ||
            // Only when it is actually an address: for some Entra
            // configurations preferred_username is a bare username.
            (preferred?.includes("@") ? preferred : undefined) ||
            "";
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
            // Entra sends `name` where Google sends `full_name`. Same fallback
            // reasoning as the email above: dead code for Google.
            const displayName =
              str(meta.full_name) ??
              str(meta.name) ??
              str([str(meta.given_name), str(meta.family_name)].filter(Boolean).join(" "));
            const workspaceName = displayName
              ? `${displayName}'s Workspace`
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
