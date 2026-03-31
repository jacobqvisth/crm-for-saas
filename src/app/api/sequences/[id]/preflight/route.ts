import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sequenceId } = await params;
  const { searchParams } = new URL(request.url);
  const listId = searchParams.get("listId");
  const workspaceId = searchParams.get("workspaceId");

  if (!listId || !workspaceId) {
    return NextResponse.json({ error: "Missing listId or workspaceId" }, { status: 400 });
  }

  const supabase = await createClient();

  // Verify auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify workspace membership
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Check for active Gmail account
  const { data: gmailAccount } = await supabase
    .from("gmail_accounts")
    .select("email_address, max_daily_sends")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  // 2. Check sequence has email steps
  const { count: emailStepCount } = await supabase
    .from("sequence_steps")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequenceId)
    .eq("type", "email");

  // 3. Get list members with contact data
  const { data: members } = await supabase
    .from("contact_list_members")
    .select("contact_id, contacts(id, email, first_name)")
    .eq("list_id", listId);

  const listMemberCount = members?.length || 0;
  let missingEmail = 0;
  let missingFirstName = 0;
  const validContactIds: string[] = [];

  for (const m of members || []) {
    const contact = m.contacts as {
      id: string;
      email: string | null;
      first_name: string | null;
    } | null;

    if (!contact?.email) {
      missingEmail++;
    } else {
      validContactIds.push(contact.id);
      if (!contact.first_name) {
        missingFirstName++;
      }
    }
  }

  // 4. Count already actively enrolled contacts
  let alreadyEnrolled = 0;
  if (validContactIds.length > 0) {
    const { count } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId)
      .eq("status", "active")
      .in("contact_id", validContactIds);
    alreadyEnrolled = count || 0;
  }

  const enrollableCount = Math.max(0, validContactIds.length - alreadyEnrolled);

  return NextResponse.json({
    gmailConnected: !!gmailAccount,
    gmailAccount: gmailAccount
      ? {
          email: gmailAccount.email_address,
          maxDailySends: gmailAccount.max_daily_sends,
        }
      : null,
    hasEmailStep: (emailStepCount || 0) > 0,
    listMemberCount,
    missingEmail,
    missingFirstName,
    alreadyEnrolled,
    enrollableCount,
  });
}
