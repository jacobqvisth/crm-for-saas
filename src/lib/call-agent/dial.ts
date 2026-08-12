import "server-only";

// Agent dial-out: unlike placeBridgeCall (which rings a human first), the
// agent call dials the CONTACT directly and, when they answer, connects the
// call into the ElevenLabs SIP endpoint where the assigned agent picks up.
//
// SIP address per ElevenLabs SIP reference: the identifier must match a
// phone number imported with provider "sip_trunk" — we import the workspace
// caller ID, so the URI is sip:{callerId}@sip.rtc.elevenlabs.io.

const ELKS_BASE = "https://api.46elks.com/a1";
const ELEVENLABS_SIP_HOST = "sip.rtc.elevenlabs.io";

function authHeader(): string {
  const user = process.env.ELKS_API_USERNAME;
  const pass = process.env.ELKS_API_PASSWORD;
  if (!user || !pass) {
    throw new Error("46elks credentials missing (ELKS_API_USERNAME / ELKS_API_PASSWORD)");
  }
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export function agentSipUri(callerId: string): string {
  return `sip:${callerId}@${ELEVENLABS_SIP_HOST}`;
}

export interface PlaceAgentCallParams {
  /** Caller ID shown to the contact; also the imported ElevenLabs SIP number. */
  from: string;
  /** The contact's number (E.164). */
  contactPhone: string;
  /** Absolute URL 46elks POSTs hangup info to (duration, legs). */
  hangupWebhookUrl: string;
}

export async function placeAgentCall(
  params: PlaceAgentCallParams,
): Promise<{ callId: string; state?: string }> {
  const voiceStart = JSON.stringify({
    connect: agentSipUri(params.from),
    callerid: params.from,
  });

  const resp = await fetch(`${ELKS_BASE}/calls`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      from: params.from,
      to: params.contactPhone,
      voice_start: voiceStart,
      whenhangup: params.hangupWebhookUrl,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "(unreadable)");
    // "creditslow" is the known silent-failure mode for an empty account —
    // surface it loudly so the cron marks the job failed with a clear reason.
    throw new Error(`46elks agent call failed (HTTP ${resp.status}): ${text}`);
  }

  const json = (await resp.json()) as { id?: string; state?: string };
  if (!json.id) throw new Error("46elks agent call returned no id");
  return { callId: json.id, state: json.state };
}
