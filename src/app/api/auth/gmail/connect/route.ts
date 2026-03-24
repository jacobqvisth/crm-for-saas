import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOAuth2Client, GMAIL_SCOPES } from "@/lib/gmail/client";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get the user's workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  // Encode user ID and workspace ID in state for verification in callback
  const state = Buffer.from(
    JSON.stringify({ userId: user.id, workspaceId: membership.workspace_id })
  ).toString("base64url");

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });

  return NextResponse.redirect(authUrl);
}
