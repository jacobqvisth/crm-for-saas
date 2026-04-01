import { createServiceClient } from "@/lib/supabase/service";
import { getGmailClient } from "./client";
import { getValidAccessToken } from "./token-refresh";
import { wrapLinks } from "@/lib/tracking/link-wrapper";
import { injectTrackingPixel } from "@/lib/tracking/pixel";

interface SendEmailParams {
  accountId: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  trackingId?: string;
  replyToMessageId?: string;
  replyToThreadId?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const MIN_SEND_INTERVAL_MS = 60 * 1000; // 60 seconds between sends per account

function getTrackingBaseUrl(): string {
  return (
    process.env.TRACKING_DOMAIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

/**
 * Applies tracking to email HTML body:
 * 1. Wrap links for click tracking
 * 2. Inject tracking pixel for open tracking
 */
function applyTracking(htmlBody: string, trackingId: string): string {
  const appUrl = getTrackingBaseUrl();

  // Step 1: Wrap links (click tracking)
  let tracked = wrapLinks(htmlBody, trackingId, appUrl);

  // Step 2: Inject tracking pixel (open tracking)
  tracked = injectTrackingPixel(tracked, trackingId, appUrl);

  return tracked;
}

function buildMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  trackingId?: string;
  replyToMessageId?: string;
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Apply tracking to HTML body before building the MIME message
  let finalHtml = params.htmlBody;
  if (params.trackingId) {
    finalHtml = applyTracking(params.htmlBody, params.trackingId);
  }

  // Generate text from the original (unwrapped) HTML to avoid tracking URLs in plaintext
  const textContent = params.textBody || params.htmlBody.replace(/<[^>]*>/g, "");

  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (params.replyToMessageId) {
    headers.push(`In-Reply-To: ${params.replyToMessageId}`);
    headers.push(`References: ${params.replyToMessageId}`);
  }

  // List-Unsubscribe headers (RFC 8058) for one-click unsubscribe in Gmail/Outlook
  if (params.trackingId) {
    const appUrl = getTrackingBaseUrl();
    const unsubUrl = `${appUrl}/api/tracking/unsubscribe/${params.trackingId}`;
    headers.push(`List-Unsubscribe: <${unsubUrl}>`);
    headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  }

  const body = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    textContent,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    finalHtml,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  return headers.join("\r\n") + "\r\n\r\n" + body;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const supabase = createServiceClient();

  // Get the Gmail account record
  const { data: account, error: fetchError } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("id", params.accountId)
    .single();

  if (fetchError || !account) {
    return { success: false, error: "Gmail account not found" };
  }

  if (account.status === "disconnected") {
    return { success: false, error: "Gmail account is disconnected" };
  }

  // Check daily send limit
  if (account.daily_sends_count >= account.max_daily_sends) {
    await supabase
      .from("gmail_accounts")
      .update({ status: "rate_limited" })
      .eq("id", params.accountId);
    return { success: false, error: "Daily send limit reached" };
  }

  // Check minimum send interval (60s between sends per account)
  if (account.updated_at) {
    const lastActivity = new Date(account.updated_at).getTime();
    const now = Date.now();
    if (now - lastActivity < MIN_SEND_INTERVAL_MS) {
      return { success: false, error: "Send rate limit: minimum 60 seconds between sends" };
    }
  }

  // Get valid access token (refresh if needed)
  const tokenResult = await getValidAccessToken(params.accountId);
  if ("error" in tokenResult) {
    return { success: false, error: tokenResult.error };
  }
  const accessToken = tokenResult.accessToken;

  const fromAddress = account.display_name
    ? `${account.display_name} <${account.email_address}>`
    : account.email_address;

  const mimeMessage = buildMimeMessage({
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    htmlBody: params.htmlBody,
    textBody: params.textBody,
    trackingId: params.trackingId,
    replyToMessageId: params.replyToMessageId,
  });

  // Base64url encode the MIME message
  const encodedMessage = Buffer.from(mimeMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const gmail = getGmailClient(accessToken);

  try {
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        threadId: params.replyToThreadId ?? undefined,
      },
    });

    // Increment daily send count
    await supabase
      .from("gmail_accounts")
      .update({
        daily_sends_count: account.daily_sends_count + 1,
      })
      .eq("id", params.accountId);

    return {
      success: true,
      messageId: response.data.id || undefined,
    };
  } catch (err: unknown) {
    const error = err as { code?: number; message?: string };

    // Handle 429 — rate limited by Google
    if (error.code === 429) {
      await supabase
        .from("gmail_accounts")
        .update({ status: "rate_limited" })
        .eq("id", params.accountId);
      return { success: false, error: "Google API rate limit reached" };
    }

    // Handle 401 — auth expired, try refreshing and retrying once
    if (error.code === 401) {
      const retryResult = await getValidAccessToken(params.accountId);
      if ("error" in retryResult) {
        return { success: false, error: retryResult.error };
      }

      try {
        const retryGmail = getGmailClient(retryResult.accessToken);
        const retryResponse = await retryGmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encodedMessage },
        });

        await supabase
          .from("gmail_accounts")
          .update({
            daily_sends_count: account.daily_sends_count + 1,
          })
          .eq("id", params.accountId);

        return {
          success: true,
          messageId: retryResponse.data.id || undefined,
        };
      } catch (retryErr) {
        return {
          success: false,
          error: `Retry after token refresh failed: ${retryErr instanceof Error ? retryErr.message : "Unknown error"}`,
        };
      }
    }

    return {
      success: false,
      error: error.message || "Unknown error sending email",
    };
  }
}
