import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOAuth2Client, getGmailClient } from "@/lib/gmail/client";
import { encrypt } from "@/lib/encryption";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const baseUrl = request.nextUrl.origin;

  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/settings/email?error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${baseUrl}/settings/email?error=${encodeURIComponent("Missing authorization code or state")}`
    );
  }

  // Verify state and extract user/workspace info
  let stateData: { userId: string; workspaceId: string };
  try {
    stateData = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return NextResponse.redirect(
      `${baseUrl}/settings/email?error=${encodeURIComponent("Invalid state parameter")}`
    );
  }

  // Verify the authenticated user matches the state
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== stateData.userId) {
    return NextResponse.redirect(
      `${baseUrl}/settings/email?error=${encodeURIComponent("Authentication mismatch")}`
    );
  }

  try {
    // Exchange code for tokens
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(
        `${baseUrl}/settings/email?error=${encodeURIComponent("Failed to get tokens from Google")}`
      );
    }

    // Fetch the user's Gmail profile
    const gmail = getGmailClient(tokens.access_token);
    const profile = await gmail.users.getProfile({ userId: "me" });

    const emailAddress = profile.data.emailAddress;
    if (!emailAddress) {
      return NextResponse.redirect(
        `${baseUrl}/settings/email?error=${encodeURIComponent("Could not retrieve email address")}`
      );
    }

    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = encrypt(tokens.refresh_token);

    const tokenExpiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000).toISOString();

    // Check if this Gmail account is already connected
    const { data: existing } = await supabase
      .from("gmail_accounts")
      .select("id")
      .eq("workspace_id", stateData.workspaceId)
      .eq("email_address", emailAddress)
      .single();

    if (existing) {
      // Update existing account (reconnect)
      const { error: updateError } = await supabase
        .from("gmail_accounts")
        .update({
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
          status: "active",
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("[gmail/callback] Update failed:", updateError);
        return NextResponse.redirect(
          `${baseUrl}/settings/email?error=${encodeURIComponent(`Failed to update Gmail account: ${updateError.message}`)}`
        );
      }
    } else {
      // Insert new account
      const { error: insertError } = await supabase.from("gmail_accounts").insert({
        workspace_id: stateData.workspaceId,
        user_id: user.id,
        email_address: emailAddress,
        display_name: emailAddress.split("@")[0],
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expires_at: tokenExpiresAt,
        status: "active",
      });

      if (insertError) {
        console.error("[gmail/callback] Insert failed:", insertError);
        return NextResponse.redirect(
          `${baseUrl}/settings/email?error=${encodeURIComponent(`Failed to save Gmail account: ${insertError.message}`)}`
        );
      }
    }

    return NextResponse.redirect(
      `${baseUrl}/settings/email?success=${encodeURIComponent("Gmail account connected successfully")}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${baseUrl}/settings/email?error=${encodeURIComponent(`Failed to connect Gmail: ${message}`)}`
    );
  }
}
