import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveWebrtcEndpoint } from "@/lib/calls/webrtc";

// Serves the 46elks WebRTC (SIP) credentials to the browser so it can register
// as the WebRTC number and take "talk from the computer" calls.
//
// By design a SIP/WebRTC client authenticates from the browser, so this secret
// necessarily reaches the client — it cannot be a server-only secret. We still
// gate it: only an authenticated workspace member whose calling is enabled may
// fetch it. The number is a dedicated, low-value, rotatable endpoint.
//
// Returns { available:false } (200) when the env isn't configured, so the UI can
// cleanly hide / disable computer-calling instead of erroring.

const WS_URI = process.env.ELKS_WEBRTC_WS_URI || "wss://voip.46elks.com/w1/websocket";
const SIP_HOST = process.env.ELKS_WEBRTC_SIP_HOST || "voip.46elks.com";

// ICE servers for the browser's media negotiation. A STUN server is required for
// a laptop behind NAT to establish audio; a TURN server is needed on restrictive
// networks. Defaults to a public STUN; override with ELKS_WEBRTC_ICE_SERVERS
// (a JSON array of RTCIceServer, e.g. to add a TURN server with credentials).
function iceServers(): RTCIceServer[] {
  const raw = process.env.ELKS_WEBRTC_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as RTCIceServer[];
    } catch {
      /* fall through to the default */
    }
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Respect the per-user calling master switch before anything else.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("call_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile?.call_enabled === false) {
    return NextResponse.json({ available: false });
  }

  // Each person has their own WebRTC endpoint (a 46elks WebRTC number is its own
  // SIP account, and one account holds one registration). Falls back to the
  // shared env endpoint for its configured owner — see src/lib/calls/webrtc.ts.
  const endpoint = await resolveWebrtcEndpoint(supabase, user.id);
  if (!endpoint) return NextResponse.json({ available: false });

  return NextResponse.json({
    available: true,
    wsUri: WS_URI,
    uri: `${endpoint.username}@${SIP_HOST}`,
    password: endpoint.password,
    iceServers: iceServers(),
  });
}
