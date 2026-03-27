import { createServiceClient } from "@/lib/supabase/service";
import { encrypt, decrypt } from "@/lib/encryption";
import { getOAuth2Client } from "./client";

interface TokenRefreshResult {
  accessToken: string;
  error?: never;
}

interface TokenRefreshError {
  accessToken?: never;
  error: string;
}

type RefreshResult = TokenRefreshResult | TokenRefreshError;

/**
 * Gets a valid (decrypted) access token for a Gmail account.
 * If the token is expired, refreshes it using the refresh token and updates the DB.
 * If the refresh fails (e.g., user revoked access), marks the account as 'disconnected'.
 */
export async function getValidAccessToken(accountId: string): Promise<RefreshResult> {
  const supabase = createServiceClient();

  const { data: account, error: fetchError } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (fetchError || !account) {
    return { error: "Gmail account not found" };
  }

  if (account.status === "disconnected") {
    return { error: "Gmail account is disconnected" };
  }

  const tokenExpiresAt = new Date(account.token_expires_at);
  const now = new Date();
  // Refresh if token expires within 5 minutes
  const bufferMs = 5 * 60 * 1000;

  if (tokenExpiresAt.getTime() - now.getTime() > bufferMs) {
    // Token is still valid
    return { accessToken: decrypt(account.access_token) };
  }

  // Token expired or expiring soon — refresh it
  try {
    const oauth2Client = getOAuth2Client();
    const decryptedRefreshToken = decrypt(account.refresh_token);
    oauth2Client.setCredentials({ refresh_token: decryptedRefreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error("No access token in refresh response");
    }

    const newExpiresAt = new Date(
      Date.now() + (credentials.expiry_date ? credentials.expiry_date - Date.now() : 3600 * 1000)
    );

    const encryptedAccessToken = encrypt(credentials.access_token);

    // If Google rotated the refresh token, encrypt and store the new one
    const updateData: Record<string, string> = {
      access_token: encryptedAccessToken,
      token_expires_at: newExpiresAt.toISOString(),
      status: "active",
    };

    if (credentials.refresh_token) {
      updateData.refresh_token = encrypt(credentials.refresh_token);
    }

    await supabase
      .from("gmail_accounts")
      .update(updateData)
      .eq("id", accountId);

    return { accessToken: credentials.access_token };
  } catch (err) {
    // Refresh failed — mark account as disconnected
    await supabase
      .from("gmail_accounts")
      .update({ status: "disconnected" })
      .eq("id", accountId);

    return {
      error: `Token refresh failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
