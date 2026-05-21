// Bulk-enroll all eligible Swedish contacts into the "Sverige" sequence.
//
// Run with:
//   node --experimental-vm-modules --loader tsx/esm scripts/bulk-enroll-se-sverige.mjs
// Or after build:
//   npm run build && node scripts/bulk-enroll-se-sverige.mjs (won't work — uses TS imports)
//
// Easier: import the compiled output, or use `tsx` to execute the .ts entry.
//
// Eligibility:
//   - company.country IN (SE, Sweden, sweden)
//   - contact.email_status = 'valid'
//   - contact.status = 'active'
//   - NOT already enrolled in the Sverige sequence
//
// Calls enrollContacts (refactored to accept a service-role supabase client) in
// 200-contact batches so we exercise the same code path as the UI / API route.
//
// Idempotent: re-running this finds nothing left to enroll because the
// existing-enrollment guard inside enrollContacts skips already-enrolled rows.

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
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";
const SEQUENCE_ID = "ea225c67-7cda-42ed-b64a-fdcfa56a3568"; // Sverige
const BATCH_SIZE = 200;

// Load enrollContacts at runtime (tsx-compiled). This script is intended to be
// invoked via `npx tsx scripts/bulk-enroll-se-sverige.mjs`.
const { enrollContacts } = await import("../src/lib/sequences/enrollment.ts");

// 1. Already-enrolled contact_ids for the Sverige sequence
const enrolledIds = new Set();
{
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("contact_id")
      .eq("sequence_id", SEQUENCE_ID)
      .range(from, from + PAGE - 1);
    if (error) { console.error("enrollments page failed:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const r of data) enrolledIds.add(r.contact_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
}
console.log(`Already enrolled in Sverige: ${enrolledIds.size}`);

// 2. Eligible SE contacts (paged to clear PostgREST's 1000-row default)
const eligibleIds = [];
{
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, companies!inner(country)", { head: false })
      .eq("workspace_id", WORKSPACE_ID)
      .eq("email_status", "valid")
      .eq("status", "active")
      .in("companies.country", ["SE", "Sweden", "sweden"])
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("contacts page failed:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const c of data) {
      if (!enrolledIds.has(c.id)) eligibleIds.push(c.id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
}
console.log(`Eligible SE contacts to enroll: ${eligibleIds.length}`);

if (eligibleIds.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

// 3. Batch-enroll via the refactored enrollContacts with service-role client
let totalEnrolled = 0, totalSkipped = 0, totalAlreadySequenced = 0;
const allReasons = [];
const batches = Math.ceil(eligibleIds.length / BATCH_SIZE);
for (let i = 0; i < eligibleIds.length; i += BATCH_SIZE) {
  const batch = eligibleIds.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  process.stdout.write(`[${batchNum}/${batches}] enrolling ${batch.length}... `);
  const result = await enrollContacts(
    {
      sequenceId: SEQUENCE_ID,
      contactIds: batch,
      workspaceId: WORKSPACE_ID,
    },
    supabase,
  );
  totalEnrolled += result.enrolled;
  totalSkipped += result.skipped;
  totalAlreadySequenced += result.skippedAlreadySequenced;
  if (result.reasons.length) allReasons.push(...result.reasons.slice(0, 3));
  console.log(`enrolled=${result.enrolled} skipped=${result.skipped} (already-sequenced-tag=${result.skippedAlreadySequenced})`);
}

console.log(`\n=== Done ===`);
console.log(`Total enrolled: ${totalEnrolled}`);
console.log(`Total skipped:  ${totalSkipped} (of which ${totalAlreadySequenced} skipped by lemlist-csv tag guard)`);
if (allReasons.length) {
  console.log(`\nSample skip reasons (first 10):`);
  for (const r of allReasons.slice(0, 10)) console.log(`  - ${r}`);
}
