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
  /**
   * When true (default), append the sender's signature_html (from user_profiles)
   * to the body. Applies to first touches AND thread replies/follow-ups — set
   * to false (e.g. via a sequence step's include_signature column) to skip it.
   */
  includeSignature?: boolean;
  /**
   * When true, skip the per-account min_send_interval_seconds rate limit
   * (the "minimum N seconds between sends" guard). Used for manual inbox
   * replies, which are human-paced and shouldn't be throttled like automated
   * sequence sends. The daily send cap (max_daily_sends) still applies.
   */
  bypassSendInterval?: boolean;
  /**
   * Override the From header — a complete address, e.g.
   * "WrenchLane Support <support@wrenchlane.com>". Used to send AS a verified
   * alias on the account's mailbox. Callers MUST validate that the address is a
   * registered send-as alias for this account (Gmail rejects/ rewrites an
   * unknown From). When omitted, From is the account's own identity.
   */
  from?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  /**
   * Gmail thread ID for the sent message. For a brand-new email this is a
   * fresh thread; callers persist it on email_queue.gmail_thread_id so the
   * check-replies cron can detect replies (it only scans rows where
   * gmail_thread_id IS NOT NULL).
   */
  threadId?: string;
  error?: string;
}

const DEFAULT_MIN_SEND_INTERVAL_SECONDS = 60;

function getTrackingBaseUrl(): string {
  // .trim() defends against trailing whitespace/newline in the env value —
  // a single \n in NEXT_PUBLIC_APP_URL produced URLs split mid-href in
  // outbound emails AND truncated List-Unsubscribe headers, both of which
  // are spam-filter smoking guns. See `src/lib/gmail/client.ts` for the
  // sibling fix; mirroring here so every send-path URL is normalized.
  const raw =
    process.env.TRACKING_DOMAIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return raw.trim().replace(/\/+$/, "");
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

function appendSignature(htmlBody: string, signatureHtml: string): string {
  // Glue the signature onto the body with no extra <br> spacers. The body
  // typically ends with a closing </p> (TipTap output) whose bottom margin
  // plus the signature's opening element top margin gives a natural
  // one-line gap. The old `<br><br>` stacked on top of those margins and
  // produced a ~50px void between "Hälsningar," and the sender name.
  return `${htmlBody}${signatureHtml}`;
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
  if ((account.daily_sends_count ?? 0) >= (account.max_daily_sends ?? 0)) {
    await supabase
      .from("gmail_accounts")
      .update({ status: "rate_limited" })
      .eq("id", params.accountId);
    return { success: false, error: "Daily send limit reached" };
  }

  // Check minimum send interval (per-account, configurable; default 60s).
  // Skipped for manual inbox replies (bypassSendInterval) — those are
  // human-paced; only automated sequence sends need this throttle.
  if (account.updated_at && !params.bypassSendInterval) {
    const intervalSeconds = account.min_send_interval_seconds ?? DEFAULT_MIN_SEND_INTERVAL_SECONDS;
    const intervalMs = intervalSeconds * 1000;
    const lastActivity = new Date(account.updated_at).getTime();
    const now = Date.now();
    if (now - lastActivity < intervalMs) {
      return {
        success: false,
        error: `Send rate limit: minimum ${intervalSeconds} seconds between sends`,
      };
    }
  }

  // Get valid access token (refresh if needed)
  const tokenResult = await getValidAccessToken(params.accountId);
  if ("error" in tokenResult) {
    return { success: false, error: tokenResult.error };
  }
  const accessToken = tokenResult.accessToken;

  // Send-as alias override (validated by the caller) wins over the account's
  // own identity, so replies to support@ mail go out From: support@.
  const fromAddress =
    params.from ??
    (account.display_name
      ? `${account.display_name} <${account.email_address}>`
      : account.email_address);

  // Look up the sender's signature and append it to the body.
  // Honors the explicit includeSignature flag (default true) regardless of
  // whether this is a thread reply — sequence bodies end on "Hälsningar," and
  // rely on the signature to supply the sender name, so suppressing it on
  // follow-up steps left a dangling sign-off. Callers that don't want a
  // signature on a given send (or per-step) pass includeSignature: false.
  let finalHtmlBody = params.htmlBody;
  let finalTextBody = params.textBody;
  const includeSignature = params.includeSignature !== false;
  if (includeSignature && account.user_id) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("signature_html")
      .eq("user_id", account.user_id)
      .maybeSingle();
    const signatureHtml = profile?.signature_html;
    if (signatureHtml && signatureHtml.trim()) {
      finalHtmlBody = appendSignature(finalHtmlBody, signatureHtml);
      if (finalTextBody) {
        const sigText = signatureHtml.replace(/<[^>]*>/g, "").trim();
        finalTextBody = `${finalTextBody}\n\n${sigText}`;
      }
    }
  }

  const mimeMessage = buildMimeMessage({
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    htmlBody: finalHtmlBody,
    textBody: finalTextBody,
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
        daily_sends_count: (account.daily_sends_count ?? 0) + 1,
      })
      .eq("id", params.accountId);

    return {
      success: true,
      messageId: response.data.id || undefined,
      threadId: response.data.threadId || undefined,
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
            daily_sends_count: (account.daily_sends_count ?? 0) + 1,
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
