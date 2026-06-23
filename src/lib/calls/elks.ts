// 46elks telephony client for the in-CRM calling pipeline.
//
// Outbound calls use the "dial-out bridge": 46elks rings the agent's own phone
// (`to`), and when they answer it connects them to the contact (`voice_start.
// connect`) showing the workspace's caller ID (`from`). The conversation is
// recorded; when the bridge ends, 46elks POSTs the recording to our hangup
// webhook (the `recordcall`/`next` action URLs).
//
// Credentials come from env (ELKS_API_USERNAME / ELKS_API_PASSWORD), the same
// account result-insurance uses — they are independent deployments sharing one
// 46elks account, so each just needs its own caller-ID number.

const ELKS_BASE = "https://api.46elks.com/a1";

function authHeader(): string {
  const user = process.env.ELKS_API_USERNAME;
  const pass = process.env.ELKS_API_PASSWORD;
  if (!user || !pass) throw new Error("46elks credentials missing (ELKS_API_USERNAME / ELKS_API_PASSWORD)");
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export interface PlaceBridgeCallParams {
  /** Caller ID shown to the contact (a 46elks number, E.164). */
  from: string;
  /** The agent's own phone — 46elks rings this first (E.164). */
  agentPhone: string;
  /** The contact's number we bridge to once the agent answers (E.164). */
  contactPhone: string;
  /** Absolute URL 46elks POSTs the recording + hangup info to. */
  hangupWebhookUrl: string;
}

export interface PlaceBridgeCallResult {
  callId: string;
  state?: string;
}

/**
 * Place an outbound bridged + recorded call. Resolves with the 46elks call id
 * (stored as call_sessions.provider_call_id for webhook correlation).
 */
export async function placeBridgeCall(params: PlaceBridgeCallParams): Promise<PlaceBridgeCallResult> {
  const voiceStart = JSON.stringify({
    connect: params.contactPhone,
    recordcall: params.hangupWebhookUrl,
    next: params.hangupWebhookUrl,
  });

  const resp = await fetch(`${ELKS_BASE}/calls`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      from: params.from,
      to: params.agentPhone,
      voice_start: voiceStart,
      // Backup hangup callback (carries duration/cost even if recordcall fails).
      whenhangup: params.hangupWebhookUrl,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "(unreadable)");
    throw new Error(`46elks call failed (HTTP ${resp.status}): ${text}`);
  }

  const json = (await resp.json()) as { id?: string; state?: string };
  if (!json.id) throw new Error("46elks call returned no id");
  return { callId: json.id, state: json.state };
}

/**
 * Fetch a recording's audio bytes. 46elks-hosted recordings on api.46elks.com
 * need Basic Auth; any other URL is fetched anonymously. Returns the audio
 * buffer + content-type for handing to Deepgram.
 */
export async function fetchRecordingAudio(
  url: string,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const needsAuth = url.includes("46elks.com");
  const resp = await fetch(url, {
    headers: needsAuth ? { Authorization: authHeader() } : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "(unreadable)");
    throw new Error(`Recording fetch failed (HTTP ${resp.status}): ${text}`);
  }
  const contentType = resp.headers.get("content-type") || "audio/mpeg";
  const buffer = await resp.arrayBuffer();
  return { buffer, contentType };
}
