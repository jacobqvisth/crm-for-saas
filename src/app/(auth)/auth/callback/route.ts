import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
          // Create a default workspace for the user
          const workspaceName =
            user.user_metadata?.full_name
              ? `${user.user_metadata.full_name}'s Workspace`
              : "My Workspace";
          const slug = workspaceName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");

          const { data: workspace } = await supabase
            .from("workspaces")
            .insert({ name: workspaceName, slug })
            .select("id")
            .single();

          if (workspace) {
            await supabase.from("workspace_members").insert({
              workspace_id: workspace.id,
              user_id: user.id,
              role: "owner",
            });

            // Create a default pipeline
            await supabase.from("pipelines").insert({
              workspace_id: workspace.id,
              name: "Sales Pipeline",
              stages: [
                { name: "Lead", order: 0, probability: 10, color: "#6366f1" },
                {
                  name: "Qualified",
                  order: 1,
                  probability: 25,
                  color: "#8b5cf6",
                },
                {
                  name: "Proposal",
                  order: 2,
                  probability: 50,
                  color: "#a855f7",
                },
                {
                  name: "Negotiation",
                  order: 3,
                  probability: 75,
                  color: "#d946ef",
                },
                {
                  name: "Closed Won",
                  order: 4,
                  probability: 100,
                  color: "#22c55e",
                },
                {
                  name: "Closed Lost",
                  order: 5,
                  probability: 0,
                  color: "#ef4444",
                },
              ],
            });
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
