import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { tenantForEmailDomain } from "@/lib/tenants";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

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

          // Onboarding allow-list: only users whose email domain belongs to a
          // configured tenant may create/join a workspace. Without this gate the
          // callback used to spin up a brand-new workspace for ANY domain, so any
          // Google account with the URL could self-provision a tenant (this is how
          // the stray gmail.com / hantverkarbolaget.se workspaces appeared).
          const tenant = tenantForEmailDomain(emailDomain);
          if (!tenant) {
            console.warn(
              `[auth/callback] rejected onboarding for un-allowed domain "${emailDomain}" (user ${user.id})`,
            );
            // Drop the session so the user isn't left signed-in-but-workspaceless.
            await supabase.auth.signOut();
            return NextResponse.redirect(`${origin}/login?error=not_invited`);
          }

          // Use service-role client for domain lookup (new user has no workspace yet, RLS blocks)
          const serviceClient = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

          let targetWorkspaceId: string | null = null;

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
              return NextResponse.redirect(
                `${origin}/login?error=onboarding`,
              );
            }
          } else {
            // First user for an allow-listed tenant → create its workspace,
            // named after the tenant (not "X's Workspace").
            const { data: workspace, error: workspaceError } = await serviceClient
              .from("workspaces")
              .insert({
                name: tenant.name,
                domain: emailDomain || null,
              })
              .select("id")
              .single();

            if (workspaceError || !workspace) {
              console.error(
                `[auth/callback] create workspace for user ${user.id}:`,
                workspaceError ?? "no row returned",
              );
              return NextResponse.redirect(
                `${origin}/login?error=onboarding`,
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
              return NextResponse.redirect(
                `${origin}/login?error=onboarding`,
              );
            }
          }
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      // Route the user to their own tenant's domain, so a WrenchLane user who
      // started an OAuth flow on the Kundbolaget host (or vice-versa) lands on
      // the correct branded domain. Data isolation is enforced by RLS regardless;
      // this only keeps branding/domain consistent with the account.
      const userTenant = tenantForEmailDomain(
        user?.email?.split("@")[1]?.toLowerCase(),
      );
      if (
        !isLocalEnv &&
        userTenant &&
        forwardedHost &&
        forwardedHost.toLowerCase() !== userTenant.canonicalHost
      ) {
        return NextResponse.redirect(
          `https://${userTenant.canonicalHost}${next}`,
        );
      }

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // Auth code exchange failed
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
