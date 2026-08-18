// Single-address email verification via MillionVerifier.
//
// Extracted so interactive send paths (one-off compose) can verify inline
// before sending, using the same result mapping as the bulk
// /api/contacts/verify-email route.

export type VerifiedEmailStatus =
  | "valid"
  | "invalid"
  | "risky"
  | "catch_all"
  | "unknown";

export type VerifyEmailResult =
  | { ok: true; status: VerifiedEmailStatus }
  | { ok: false; reason: string };

/** Map MillionVerifier's result/subresult pair onto our email_status values. */
export function mapMVStatus(
  result: string,
  subresult: string,
): VerifiedEmailStatus {
  if (subresult === "catchall") return "catch_all";
  switch (result) {
    case "ok":
      return "valid";
    case "error":
      return "invalid";
    case "unknown":
      return "risky";
    default:
      return "unknown";
  }
}

/**
 * Cheap structural sanity check — not RFC-complete, just enough to reject
 * addresses that can never resolve (missing @, no dot in the domain, a TLD
 * that isn't alphabetic). Used as the fallback gate when MillionVerifier is
 * unavailable, and as a fast pre-check before spending a verification credit.
 */
export function isPlausibleEmailAddress(email: string): boolean {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(email.trim());
  if (!m) return false;
  const domain = m[1].toLowerCase();
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((l) => l.length === 0 || l.startsWith("-") || l.endsWith("-"))) {
    return false;
  }
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,24}$/.test(tld);
}

/**
 * Verify one address with MillionVerifier. Never throws; a missing API key,
 * network error, or non-OK response comes back as `{ ok: false }` so callers
 * can decide their own degraded behavior (the one-off send route falls back
 * to the structural check above rather than blocking on a vendor outage).
 */
export async function verifyEmailAddress(
  email: string,
): Promise<VerifyEmailResult> {
  const mvKey = process.env.MILLIONVERIFIER_API_KEY;
  if (!mvKey) return { ok: false, reason: "MILLIONVERIFIER_API_KEY not set" };

  try {
    const url = `https://api.millionverifier.com/api/v3/?api=${mvKey}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const data = (await res.json()) as {
      result?: string;
      subresult?: string;
      error?: string;
    };
    if (!res.ok || data.error) {
      return { ok: false, reason: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, status: mapMVStatus(data.result || "", data.subresult || "") };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch failed" };
  }
}
