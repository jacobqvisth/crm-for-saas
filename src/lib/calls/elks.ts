// 46elks telephony client for the in-CRM calling pipeline.
//
// Outbound calls use the "dial-out bridge": 46elks rings the agent's leg
// (`to` = their mobile, or the WebRTC number when calling from the computer),
// and when it answers connects them to the contact (`voice_start.connect`)
// showing the workspace's caller ID (`from`). The conversation is recorded;
// when the bridge ends, 46elks POSTs the recording to our hangup webhook (the
// `recordcall`/`next` action URLs). The ring leg is the only thing that differs
// between phone-bridge and computer (WebRTC) calls — everything downstream
// (recording, transcript, AI summary) is identical.
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
  /** The agent's leg 46elks rings first — their mobile (phone bridge) or the
   *  46elks WebRTC number (computer calling). E.164. */
  ring: string;
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
      to: params.ring,
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

export interface ElksNumber {
  number: string;
  active: string; // "yes" | "no"
  allocated?: string;
  capabilities?: string[];
  /** Inbound action: a URL (forwards to that webhook) or a JSON action string. */
  voice_start?: string;
  sms_url?: string;
}

/**
 * List all phone numbers allocated to the 46elks account, with their inbound
 * (voice_start) configuration. Used by the Phone System overview page to show
 * which numbers exist, what they can do, and where inbound calls currently go.
 */
export async function listElksNumbers(): Promise<ElksNumber[]> {
  const resp = await fetch(`${ELKS_BASE}/numbers?limit=100`, {
    headers: { Authorization: authHeader() },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "(unreadable)");
    throw new Error(`46elks numbers fetch failed (HTTP ${resp.status}): ${text}`);
  }
  const json = (await resp.json()) as { data?: ElksNumber[] };
  return json.data ?? [];
}
