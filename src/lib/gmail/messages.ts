// Shared Gmail message parsing helpers used by mail-ingestion crons.
// (check-replies has its own private copies; mailbox-sync uses these.)

export type GmailHeader = { name?: string | null; value?: string | null };

export type GmailPayload = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPayload[] | null;
  headers?: GmailHeader[] | null;
};

export function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

/** Parse a single "Name <addr@x>" token into name + lower-cased email. */
export function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim().toLowerCase() };
  return { name: "", email: raw.trim().toLowerCase() };
}

/** Parse a To/Cc header (comma-separated) into a list of lower-cased emails. */
export function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  // Split on commas that aren't inside quotes/angle brackets — good enough for
  // real-world headers (display names with commas are rare and quoted).
  return raw
    .split(/,(?![^<]*>)/)
    .map((part) => parseEmailAddress(part).email)
    .filter((e) => e.includes("@"));
}

export function extractTextBody(payload: GmailPayload): string | null {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractTextBody(part);
      if (result) return result;
    }
  }
  return null;
}

export function extractHtmlBody(payload: GmailPayload): string | null {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractHtmlBody(part);
      if (result) return result;
    }
  }
  return null;
}

/** OOO / auto-reply detection (header-first, then multilingual subject). */
export function isAutoReply(
  headers: GmailHeader[],
  subject: string,
  bodyText: string | null,
): boolean {
  const autoSubmitted = getHeader(headers, "auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;
  if (getHeader(headers, "x-autoreply")) return true;
  if (getHeader(headers, "x-auto-response-suppress")) return true;
  const precedence = getHeader(headers, "precedence");
  if (precedence && ["bulk", "auto_reply", "junk"].includes(precedence.toLowerCase())) return true;

  const subjectLower = subject.toLowerCase();
  const oooPatterns = [
    "out of office",
    "automatic reply",
    "auto-reply",
    "autoreply",
    "frånvarande",
    "automatiskt svar",
    "fraværende",
    "automatisk svar",
    "abwesenheit",
    "automatische antwort",
    "poissa",
    "automaattinen vastaus",
  ];
  if (oooPatterns.some((p) => subjectLower.includes(p))) return true;

  void bodyText; // reserved for future body-based heuristics
  return false;
}
