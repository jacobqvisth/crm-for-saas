import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

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
          // signed in but with no workspace membership, no owner record,
          // or no default pipeline. The user would see an empty dashboard
          // with no obvious error. Now each insert is checked and any
          // failure short-circuits to /login?error=onboarding so the user
          // gets feedback + can retry instead of landing in limbo.
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

            // Create a default pipeline. A failure here is less catastrophic
            // than the membership writes — the user can still use the app,
            // they'd just hit an empty kanban — but it's still worth
            // surfacing in logs so we can investigate.
            const { error: pipelineError } = await serviceClient
              .from("pipelines")
              .insert({
                workspace_id: workspace.id,
                name: "Sales Pipeline",
                stages: [
                  { name: "Lead", order: 0, probability: 10, color: "#6366f1" },
                  { name: "Qualified", order: 1, probability: 25, color: "#8b5cf6" },
                  { name: "Proposal", order: 2, probability: 50, color: "#a855f7" },
                  { name: "Negotiation", order: 3, probability: 75, color: "#d946ef" },
                  { name: "Closed Won", order: 4, probability: 100, color: "#22c55e" },
                  { name: "Closed Lost", order: 5, probability: 0, color: "#ef4444" },
                ],
              });
            if (pipelineError) {
              console.error(
                `[auth/callback] create default pipeline for workspace ${workspace.id}:`,
                pipelineError,
              );
              // Don't redirect to error here — the user can still use the app,
              // they'd just hit an empty kanban.
            }
          }
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

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
