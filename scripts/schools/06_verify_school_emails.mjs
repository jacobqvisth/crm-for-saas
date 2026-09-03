// Verify the school contacts' email addresses.
//
// Why this has to run before the sequence does anything. The process-emails cron
// treats email_status 'unknown' (or NULL) as "deliverability unknown, do not send
// blind": it cancels the queue row and sets the enrollment to `paused`, silently.
// All 1250 imported school contacts land as 'unknown', so enrolling them without
// this step produces a sequence that appears to run and sends nothing.
//
// Scoped to source='skolverket' on purpose. scripts/verify-contacts-unknown.mjs
// sweeps every unknown contact in the CRM (2569 rows), and there is no reason to
// spend MillionVerifier credits on the other 1319 while setting up a school campaign.
//
//   node scripts/schools/06_verify_school_emails.mjs --dry-run
//   node scripts/schools/06_verify_school_emails.mjs

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import { verifyEmail } from "../lib/email-verify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env.local") });

const DRY = process.argv.includes("--dry-run");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const mvKey = process.env.MILLIONVERIFIER_API_KEY;
if (!mvKey) throw new Error("MILLIONVERIFIER_API_KEY missing from .env.local");

// PostgREST caps a response at 1000 rows, so page explicitly with a unique order.
const targets = [];
const PAGE = 500;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, email_status")
    .eq("source", "skolverket")
    .or("email_status.is.null,email_status.eq.unknown")
    .not("email", "is", null)
    .neq("email", "")
    .order("id")
    .range(from, from + PAGE - 1);
  if (error) { console.error("fetch error:", error.message); process.exit(1); }
  if (!data?.length) break;
  targets.push(...data);
  if (data.length < PAGE) break;
}

const credits = await fetch(`https://api.millionverifier.com/api/v3/credits?api=${mvKey}`)
  .then((r) => r.json()).catch(() => null);
console.log(`Targets: ${targets.length} school contacts`);
console.log(`MillionVerifier credits: ${credits?.credits ?? "unknown"}`);

if (DRY) { console.log("Dry run, nothing verified."); process.exit(0); }
if (targets.length === 0) process.exit(0);
if (credits?.credits != null && credits.credits < targets.length) {
  console.error(`Not enough credits: ${credits.credits} < ${targets.length}`);
  process.exit(1);
}

const counts = {};
let done = 0;
const queue = [...targets];
const startTs = Date.now();

async function worker() {
  for (;;) {
    const row = queue.shift();
    if (!row) return;
    // verifyEmail throws on a provider/quota error rather than mapping to
    // "unknown" — a silent mapping once poisoned ~100 rows. Let it halt the run.
    const { status } = await verifyEmail(row.email, mvKey);
    const { error } = await supabase
      .from("contacts")
      .update({ email_status: status, email_verified_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) console.error(`update err ${row.id}: ${error.message}`);
    counts[status] = (counts[status] ?? 0) + 1;
    if (++done % 100 === 0) console.log(`  ${done}/${targets.length}`);
  }
}

await Promise.all(Array.from({ length: Math.min(15, targets.length) }, worker));

console.log(`\nVerified ${done}/${targets.length} in ${Math.round((Date.now() - startTs) / 1000)}s`);
console.log("Results:", counts);
console.log("\nOnly 'valid' and 'catch_all' will send. 'invalid' and 'risky' stay paused by the cron.");
