import { google } from "googleapis";
import { getEnv } from "@/lib/ceo/env";
import { SyncSkippedError } from "./errors";

export function hasGoogleApiCredentials() {
  return Boolean(
    getEnv("GOOGLE_SERVICE_ACCOUNT_JSON") ||
      (getEnv("GOOGLE_OAUTH_CLIENT_ID") &&
        getEnv("GOOGLE_OAUTH_CLIENT_SECRET") &&
        getEnv("GOOGLE_OAUTH_REFRESH_TOKEN")),
  );
}

export async function createGoogleAuth(scopes: string[]) {
  const rawCredentials = getEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (rawCredentials) {
    const credentials = JSON.parse(rawCredentials);
    if (!credentials.client_email || !credentials.private_key) {
      throw new SyncSkippedError(
        "GOOGLE_SERVICE_ACCOUNT_JSON must be a Google service account JSON with client_email and private_key.",
      );
    }

    return new google.auth.JWT({
      email: credentials.client_email,
      key: String(credentials.private_key).replaceAll("\\n", "\n"),
      scopes,
    });
  }

  const clientId = getEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = getEnv("GOOGLE_OAUTH_REFRESH_TOKEN");

  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(
      clientId,
      clientSecret,
      getEnv("GOOGLE_OAUTH_REDIRECT_URI"),
    );
    auth.setCredentials({ refresh_token: refreshToken });
    return auth;
  }

  throw new SyncSkippedError(
    "Google API credentials are not configured. Provide GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN.",
  );
}
