import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enrollContacts } from "@/lib/sequences/enrollment";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Verify auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { sequenceId, contactIds, workspaceId, senderAccountId } = body;

  if (!sequenceId || !contactIds || !workspaceId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Verify user belongs to workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const result = await enrollContacts({
    sequenceId,
    contactIds,
    workspaceId,
    senderAccountId,
  });

  return NextResponse.json(result);
}
