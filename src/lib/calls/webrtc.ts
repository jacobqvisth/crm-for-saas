import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { decrypt } from "@/lib/encryption";
import { normalizePhone, sipUsernameFor } from "./phone";

type Client = SupabaseClient<Database>;

// Who can take calls in their browser, and with which credentials.
//
// On 46elks a WebRTC number IS its own SIP account: the username is the number
// without the leading "+", and the password is that number's `secret` field. One
// account holds one registration, so two people sharing one number would race
// for incoming legs. Hence one endpoint per person.
//
// Resolution order:
//   1. the user's own number + secret on user_profiles (the normal path)
//   2. the shared ELKS_WEBRTC_* env endpoint, but ONLY for the single user named
//      by ELKS_WEBRTC_OWNER_USER_ID (or anyone, when that var is unset)
//
// Step 2 exists so the original owner's working setup keeps working untouched
// until they are given a number of their own. Remove it once everyone has one.

export interface WebrtcEndpoint {
  /** E.164 number 46elks rings to reach this browser. */
  number: string;
  /** SIP username. */
  username: string;
  /** SIP password. */
  password: string;
  /** Where the credentials came from, for diagnostics on the Phone System page. */
  source: "user" | "shared_env";
}

function sharedEndpointFor(userId: string): WebrtcEndpoint | null {
  const number = normalizePhone(process.env.ELKS_WEBRTC_NUMBER);
  const username = process.env.ELKS_WEBRTC_USERNAME;
  const password = process.env.ELKS_WEBRTC_PASSWORD;
  if (!number || !username || !password) return null;

  const ownerId = process.env.ELKS_WEBRTC_OWNER_USER_ID?.trim();
  if (ownerId && ownerId !== userId) return null;

  return { number, username, password, source: "shared_env" };
}

/**
 * Resolve this user's browser-calling endpoint, or null when they have none.
 *
 * Returns null (rather than throwing) for every "not set up" case, so callers can
 * simply hide the feature.
 */
export async function resolveWebrtcEndpoint(
  supabase: Client,
  userId: string,
): Promise<WebrtcEndpoint | null> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("call_webrtc_number, call_webrtc_secret_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  const own = normalizePhone(profile?.call_webrtc_number);
  if (own && profile?.call_webrtc_secret_encrypted) {
    try {
      return {
        number: own,
        username: sipUsernameFor(own),
        password: decrypt(profile.call_webrtc_secret_encrypted),
        source: "user",
      };
    } catch {
      // Undecryptable secret (rotated ENCRYPTION_KEY): fall through rather than
      // handing the browser a broken registration.
    }
  }

  return sharedEndpointFor(userId);
}

/**
 * Just the number to ring in parallel with a user's cell, for inbound hunt
 * groups. Cheaper than resolveWebrtcEndpoint when the secret is not needed.
 */
export async function resolveWebrtcNumber(
  supabase: Client,
  userId: string,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("call_webrtc_number")
    .eq("user_id", userId)
    .maybeSingle();

  const own = normalizePhone(profile?.call_webrtc_number);
  if (own) return own;

  return sharedEndpointFor(userId)?.number ?? null;
}
