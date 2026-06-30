import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const username = process.env.ELKS_WEBRTC_USERNAME;
  const password = process.env.ELKS_WEBRTC_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ available: false });
  }

  // There is a single shared WebRTC number (one SIP registration at a time), so
  // computer calling is scoped to one owner. When ELKS_WEBRTC_OWNER_USER_ID is
  // set, only that agent gets it; unset = any member (single-user setups).
  const ownerId = process.env.ELKS_WEBRTC_OWNER_USER_ID;
  if (ownerId && ownerId !== user.id) {
    return NextResponse.json({ available: false });
  }

  // Respect the per-user calling master switch.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("call_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile?.call_enabled === false) {
    return NextResponse.json({ available: false });
  }

  return NextResponse.json({
    available: true,
    wsUri: WS_URI,
    uri: `${username}@${SIP_HOST}`,
    password,
  });
}
