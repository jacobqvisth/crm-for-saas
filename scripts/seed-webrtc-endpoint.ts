/**
 * Assign a 46elks WebRTC number to a user for browser calling.
 *
 * Uses the repo's own encrypt() so the stored secret matches exactly what
 * resolveWebrtcEndpoint() will decrypt.
 *
 * Run:
 *   npx tsx --conditions=react-server --env-file=<env> \
 *     scripts/seed-webrtc-endpoint.ts <email> <+46…number> <secret>
 *
 * Pass an empty string as the number to clear a user's endpoint.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { encrypt } from "@/lib/encryption";
import { normalizePhone } from "@/lib/calls/phone";

async function main() {
  const [email, rawNumber, secret] = process.argv.slice(2);
  if (!email) {
    console.error("usage: seed-webrtc-endpoint.ts <email> <number|''> [secret]");
    process.exit(1);
  }

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const user = users?.users.find((u) => u.email === email);
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }

  let patch: Record<string, string | null>;
  if (!rawNumber) {
    patch = { call_webrtc_number: null, call_webrtc_secret_encrypted: null };
  } else {
    const number = normalizePhone(rawNumber);
    if (!number) {
      console.error(`not a valid number: ${rawNumber}`);
      process.exit(1);
    }
    if (!secret) {
      console.error("a secret is required when setting a number");
      process.exit(1);
    }
    patch = { call_webrtc_number: number, call_webrtc_secret_encrypted: encrypt(secret) };
  }

  const { error } = await supabase
    .from("user_profiles")
    .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
  if (error) {
    console.error("update failed:", error.message);
    process.exit(1);
  }

  const { data: after } = await supabase
    .from("user_profiles")
    .select("call_webrtc_number, call_webrtc_secret_encrypted")
    .eq("user_id", user.id)
    .maybeSingle();

  console.log(`${email} (${user.id})`);
  console.log("  webrtc number:", after?.call_webrtc_number ?? "(none)");
  console.log("  secret stored:", Boolean(after?.call_webrtc_secret_encrypted));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
