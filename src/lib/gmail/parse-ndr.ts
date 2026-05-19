// NDR (Non-Delivery Report) parser.
//
// SMTP-level rejections come back to the sender as bounce notification emails
// landing in their own inbox. There are several formats in the wild:
//
//   1. RFC 3464 DSN (Gmail's own, most ISPs) — multipart/report with a
//      message/delivery-status part containing standardized fields:
//      `Action: failed`, `Status: 5.x.y`, `Final-Recipient: rfc822; addr`,
//      and an attached message/rfc822 part holding the original headers.
//
//   2. Microsoft 365 NDR — readable HTML/text body with labeled sections
//      ("Recipient Address:", "Error:", "Sender Address:"). Sender is
//      typically `MicrosoftExchange...@<tenant>.onmicrosoft.com` — does NOT
//      match `from:mailer-daemon` or `from:postmaster` Gmail filters.
//
//   3. Plain prose — older systems may just send a text body like
//      "Your message to X failed: 550 5.1.1 ...".
//
// This module returns a normalized shape regardless of input. The Gmail
// query that drives the poller should also broaden beyond mailer-daemon/
// postmaster — see suggestedGmailQuery() below.

export interface ParsedNdr {
  /** The address(es) the original message failed to reach. */
  recipients: string[];
  /** SMTP basic code, e.g. "550". Null if not found. */
  smtpCode: string | null;
  /** RFC 3463 enhanced status code, e.g. "5.7.1". Null if not found. */
  enhancedStatus: string | null;
  /** Free-text error description. */
  errorText: string | null;
  /** Original Message-ID extracted from quoted headers, no angle brackets. */
  originalMessageId: string | null;
  /** Final SMTP host that issued the rejection, when present. */
  rejectingHost: string | null;
  /**
   * Best-effort categorization based on the enhanced status code's leading
   * digit (4 = temporary, 5 = permanent). Defaults to "permanent" when an
   * SMTP code in the 5xx range is present.
   */
  permanence: "permanent" | "temporary" | "unknown";
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MESSAGE_ID_REGEX = /(?:^|\n)\s*Message-ID:\s*<([^>\s]+)>/i;
const SMTP_CODE_REGEX = /(?<![\d.])([45]\d{2})(?![\d])/;
const ENHANCED_STATUS_REGEX = /(?<![\d.])([45]\.\d{1,3}\.\d{1,3})(?![\d])/;
const FINAL_RECIPIENT_REGEX = /Final-Recipient:\s*rfc822;\s*([^\s<>]+)/i;
const RECIPIENT_ADDRESS_REGEX = /Recipient Address:\s*([^\s<>]+)/i;
const REJECTING_HOST_REGEX =
  /(?:Remote-MTA:\s*dns;\s*|Reporting-MTA:\s*dns;\s*|Message rejected by[:\s]+|Generating server[:\s]+)([A-Z0-9.-]+)/i;

/**
 * Suggested Gmail search query for the NDR ingestion poller. Catches:
 * - Standard mailer-daemon / postmaster bounces
 * - Microsoft 365 NDRs (subject "Undeliverable:")
 * - Other "Delivery Status Notification (Failure)" subjects
 *
 * `newer_than:2d` gives the cron a generous overlap window — Gmail's API
 * indexing has occasional 10-15min lag and we want headroom across cron
 * ticks. The dedup check on `email_events.email_queue_id + event_type`
 * makes overlap safe.
 */
export const SUGGESTED_NDR_GMAIL_QUERY =
  '(from:mailer-daemon OR from:postmaster OR from:MAILER-DAEMON OR ' +
  'subject:"undeliverable" OR subject:"delivery status notification" OR ' +
  'subject:"delivery failed" OR subject:"returned mail" OR ' +
  'subject:"failure notice") newer_than:2d';

/**
 * Parse an NDR body (text or stripped HTML) into structured fields.
 *
 * Pure function — no I/O. Caller decides whether the recipient mapping
 * should resolve to an `email_queue` row via Message-ID lookup or
 * recipient-email match.
 */
export function parseNdr(bodyText: string): ParsedNdr {
  const recipients = extractRecipients(bodyText);
  const originalMessageId = extractMessageId(bodyText);
  const smtpCode = matchOne(bodyText, SMTP_CODE_REGEX);
  const enhancedStatus = matchOne(bodyText, ENHANCED_STATUS_REGEX);
  const rejectingHost = matchOne(bodyText, REJECTING_HOST_REGEX);
  const errorText = extractErrorText(bodyText);

  let permanence: ParsedNdr["permanence"] = "unknown";
  if (enhancedStatus) {
    permanence = enhancedStatus.startsWith("5") ? "permanent" : "temporary";
  } else if (smtpCode) {
    permanence = smtpCode.startsWith("5") ? "permanent" : "temporary";
  }

  return {
    recipients,
    smtpCode,
    enhancedStatus,
    errorText,
    originalMessageId,
    rejectingHost,
    permanence,
  };
}

function matchOne(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? m[1] : null;
}

function extractRecipients(text: string): string[] {
  // Prefer structured fields (most reliable), fall back to free-form scan.
  const out = new Set<string>();
  const finalRecipient = matchOne(text, FINAL_RECIPIENT_REGEX);
  if (finalRecipient) out.add(finalRecipient.toLowerCase());

  const ms365Recipient = matchOne(text, RECIPIENT_ADDRESS_REGEX);
  if (ms365Recipient) out.add(ms365Recipient.toLowerCase());

  // If neither structured field matched, scan the first ~1500 chars for any
  // email address. Avoid scanning the whole body — the quoted original
  // message at the bottom contains lots of addresses (List-Unsubscribe,
  // unsubscribe URLs, signatures) that aren't the failing recipient.
  if (out.size === 0) {
    const head = text.slice(0, 1500);
    const matches = head.match(EMAIL_REGEX) ?? [];
    for (const m of matches) {
      const lower = m.toLowerCase();
      // Skip obvious system/bounce addresses
      if (
        lower.startsWith("mailer-daemon@") ||
        lower.startsWith("postmaster@") ||
        lower.includes("microsoftexchange") ||
        lower.endsWith("@onmicrosoft.com")
      ) {
        continue;
      }
      out.add(lower);
    }
  }

  return [...out];
}

function extractMessageId(text: string): string | null {
  const m = MESSAGE_ID_REGEX.exec(text);
  return m ? m[1].trim() : null;
}

function extractErrorText(text: string): string | null {
  // Microsoft 365 marks the error block with "Error:" — capture the same
  // line. RFC 3464 uses Diagnostic-Code. Prose bounces just have the 5xx
  // line. Return whichever surfaces first; truncate to a sane length.
  const patterns: RegExp[] = [
    /Error:\s*(.+)/i,
    /Diagnostic-Code:\s*(?:smtp;\s*)?(.+)/i,
    /(?:^|\n)\s*(5\d{2}[\s-]+[^\n]+)/m,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1].trim().slice(0, 500);
  }
  return null;
}
