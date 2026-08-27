/**
 * Human-readable copy for AI provider failures.
 *
 * The Anthropic SDK throws errors whose `message` is the raw HTTP status plus
 * the provider's JSON body, e.g.
 *
 *   400 {"type":"error","error":{"type":"invalid_request_error","message":"Your
 *   credit balance is too low to access the Anthropic API. ..."},"request_id":"req_01..."}
 *
 * Those strings get stored (call_sessions.error) and rendered straight into the
 * UI, which is how a rep ends up staring at a JSON blob in the call drawer. Run
 * every provider error message through friendlyAiError() before it is persisted
 * or shown: known operator-actionable failures get plain copy that says what to
 * do, and anything unrecognised at least loses the JSON wrapper.
 */

/** Pull the provider's own message out of a "<status> {json}" SDK error string. */
function unwrapProviderMessage(raw: string): string {
  const brace = raw.indexOf("{");
  if (brace === -1) return raw.trim();
  try {
    const parsed = JSON.parse(raw.slice(brace)) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const inner = parsed.error?.message ?? parsed.message;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  } catch {
    // Not JSON after all (or truncated), so fall through to the raw string.
  }
  return raw.trim();
}

/**
 * Map an AI provider error to copy a rep or operator can act on.
 * Safe to call on an already-friendly string: it passes through unchanged.
 */
export function friendlyAiError(raw: string | null | undefined): string {
  if (!raw) return "AI processing failed for an unknown reason.";
  const message = unwrapProviderMessage(raw);
  const probe = `${raw} ${message}`.toLowerCase();

  if (probe.includes("credit balance is too low")) {
    return (
      "The AI account is out of credits, so nothing could be summarised. " +
      "Top up at console.anthropic.com under Plans & Billing, then hit Retry processing."
    );
  }
  if (probe.includes("anthropic_api_key not set")) {
    return "The AI API key is missing on this environment. Set ANTHROPIC_API_KEY, then retry.";
  }
  if (probe.includes("authentication_error") || probe.includes("invalid x-api-key")) {
    return "The AI API key was rejected. Rotate ANTHROPIC_API_KEY, then retry.";
  }
  if (probe.includes("permission_error")) {
    return "The AI API key is not allowed to use this model. Check the key's workspace, then retry.";
  }
  if (probe.includes("rate_limit") || probe.includes(" 429")) {
    return "The AI provider is rate-limiting us. Wait a minute, then hit Retry processing.";
  }
  if (probe.includes("overloaded") || probe.includes(" 529")) {
    return "The AI provider is overloaded right now. Hit Retry processing in a few minutes.";
  }
  if (probe.includes("timeout") || probe.includes("timed out") || probe.includes("etimedout")) {
    return "The AI request timed out. Hit Retry processing.";
  }

  return message;
}
