// Enroll the "Never emailed swedish contacts" list into the
// "Sverige 2 - aldrig mailade kontakter" sequence (sender: Valdemar).
//
// Run:  npx tsx scripts/enroll-never-emailed-se.mjs [--dry-run]
//
// Eligibility (mirrors scripts/bulk-enroll-se-sverige.mjs, plus suppressions):
//   - member of list 962d384d (never emailed: no sent queue row, no email_sent
//     activity, last_emailed_at NULL, exclusions already applied)
//   - contact.email_status = 'valid'
//   - contact.status = 'active'
//   - NOT present in `suppressions` (active) -- enrollContacts only checks
//     `unsubscribes`, so hard bounces and lemlist-prior-outreach must be
//     filtered here or they get mailed again.
//
// Goes through enrollContacts so the matching email_queue row, sender pin,
// variant pick and scheduled_for are all created. NEVER SQL-insert enrollments.

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "../.env.local") });

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";
const LIST_ID = "962d384d-55e1-4b3d-8427-5354d4b552dd";
const SEQUENCE_ID = "bcccd256-cf64-462a-8fbd-25bc04bcbabc";
const SENDER_ID = "aca5d632-0787-4189-8588-aef3b82e3fdd"; // valdemar@wrenchlane.com
const BATCH_SIZE = 200;
const DRY_RUN = process.argv.includes("--dry-run");

const PAGE = 1000;

async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) {
      console.error("page failed:", error.message);
      process.exit(1);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// 1. List members
const memberRows = await pageAll((a, b) =>
  supabase
    .from("contact_list_members")
    .select("contact_id")
    .eq("list_id", LIST_ID)
    .order("contact_id", { ascending: true })
    .range(a, b),
);
const memberIds = memberRows.map((r) => r.contact_id);
console.log(`List members: ${memberIds.length}`);

// 2. Active suppressions for the workspace (emails + domains)
const supRows = await pageAll((a, b) =>
  supabase
    .from("suppressions")
    .select("email, domain")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("active", true)
    .order("id", { ascending: true })
    .range(a, b),
);
const supEmails = new Set(
  supRows.map((r) => r.email?.toLowerCase()).filter(Boolean),
);
const supDomains = new Set(
  supRows.map((r) => r.domain?.toLowerCase()).filter(Boolean),
);
console.log(`Suppressions: ${supEmails.size} emails, ${supDomains.size} domains`);

// 3. Load the member contacts and apply eligibility
const CHUNK = 200;
const eligible = [];
const dropped = { email_status: 0, status: 0, suppressed: 0, no_email: 0 };
for (let i = 0; i < memberIds.length; i += CHUNK) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, status, email_status")
    .eq("workspace_id", WORKSPACE_ID)
    .in("id", memberIds.slice(i, i + CHUNK));
  if (error) {
    console.error("contacts chunk failed:", error.message);
    process.exit(1);
  }
  for (const c of data ?? []) {
    const email = (c.email ?? "").toLowerCase();
    if (!email) { dropped.no_email++; continue; }
    if (c.email_status !== "valid") { dropped.email_status++; continue; }
    if (c.status !== "active") { dropped.status++; continue; }
    const domain = email.split("@")[1] ?? "";
    if (supEmails.has(email) || supDomains.has(domain)) { dropped.suppressed++; continue; }
    eligible.push(c.id);
  }
}

console.log("Dropped:", JSON.stringify(dropped));
console.log(`Eligible to enroll: ${eligible.length}`);

if (DRY_RUN) {
  console.log("--dry-run, stopping before enrollment.");
  process.exit(0);
}

// 4. Enroll through the real code path, in batches
const { enrollContacts } = await import("../src/lib/sequences/enrollment.ts");

const totals = { enrolled: 0, skipped: 0, skippedCustomer: 0, skippedAlreadySequenced: 0 };
const sampleReasons = [];

for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
  const batch = eligible.slice(i, i + BATCH_SIZE);
  const res = await enrollContacts(
    {
      sequenceId: SEQUENCE_ID,
      contactIds: batch,
      workspaceId: WORKSPACE_ID,
      senderAccountId: SENDER_ID,
    },
    supabase,
  );
  totals.enrolled += res.enrolled;
  totals.skipped += res.skipped;
  totals.skippedCustomer += res.skippedCustomer;
  totals.skippedAlreadySequenced += res.skippedAlreadySequenced;
  for (const r of res.reasons.slice(0, 3)) sampleReasons.push(r);
  console.log(
    `batch ${i / BATCH_SIZE + 1}: enrolled=${res.enrolled} skipped=${res.skipped}`,
  );
}

console.log("\n=== TOTAL ===");
console.log(JSON.stringify(totals, null, 2));
if (sampleReasons.length) {
  console.log("sample skip reasons:");
  for (const r of sampleReasons.slice(0, 15)) console.log("  -", r);
}
