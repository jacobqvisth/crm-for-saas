import { google } from "googleapis";

// The only place in this codebase that constructs a Google API client for MAIL.
//
// `lib/ceo/sync/*` also imports googleapis, and legitimately: that is GA4,
// Search Console and Google Ads, which are analytics, not mail. The rule phase
// 06 introduces is narrower than "nothing imports googleapis" — it is that
// nothing reaches the Gmail API except through `lib/mail/`.
//
// Moved here from `lib/gmail/client.ts`, which now re-exports from this file so
// the existing call sites keep working while they are migrated onto the
// MailProvider interface one at a time.

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.trim();
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    `${getBaseUrl()}/api/auth/gmail/callback`,
  );
}

export function getGmailClient(accessToken: string) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];
