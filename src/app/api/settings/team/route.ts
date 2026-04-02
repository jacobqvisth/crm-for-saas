import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get workspace for current user
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const workspaceId = membership.workspace_id;

  // Get all members of the workspace
  const { data: members, error: membersError } = await supabase
    .from("workspace_members")
    .select("id, user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (membersError || !members) {
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }

  // Use service client to get auth user profiles
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get Gmail accounts for the workspace (all members)
  const { data: gmailAccounts } = await serviceClient
    .from("gmail_accounts")
    .select("user_id, email_address, display_name, status")
    .eq("workspace_id", workspaceId);

  // Fetch each member's auth profile
  const enrichedMembers = await Promise.all(
    members.map(async (member) => {
      const { data: authUser } = await serviceClient.auth.admin.getUserById(member.user_id);

      const userGmailAccounts = (gmailAccounts || [])
        .filter((a) => a.user_id === member.user_id)
        .map((a) => ({ email_address: a.email_address, display_name: a.display_name, status: a.status }));

      return {
        id: member.id,
        user_id: member.user_id,
        role: member.role,
        joined_at: member.created_at,
        is_current_user: member.user_id === user.id,
        full_name: authUser?.user?.user_metadata?.full_name ?? null,
        email: authUser?.user?.email ?? null,
        avatar_url: authUser?.user?.user_metadata?.avatar_url ?? null,
        gmail_accounts: userGmailAccounts,
      };
    })
  );

  return NextResponse.json({ members: enrichedMembers });
}
