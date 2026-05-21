// Verify NO contacts.email via MillionVerifier. Sister script to verify-emails.mjs
// (which targets discovered_shops). Updates contacts.email_status + email_verified_at
// for rows in the wrenchlane workspace where the linked company.country_code='NO'.
//
// Reuses the freshness cache (valid 90d / invalid 30d / risky 7d) and the
// loud-on-error MV wrapper from lib/email-verify.mjs.
//
// Usage:
//   node scripts/verify-contacts-no.mjs --dry-run
//   node scripts/verify-contacts-no.mjs --concurrency 80
//   node scripts/verify-contacts-no.mjs --limit 400 --only-null

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import { verifyEmail, shouldSkip } from "./lib/email-verify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const p of [join(__dirname, "../.env.local"), join(__dirname, "../../../../.env.local")]) {
  if (!dotenv.config({ path: p }).error) break;
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };

const DRY_RUN = flag("--dry-run");
const ONLY_NULL = flag("--only-null");
const LIMIT = arg("--limit") ? parseInt(arg("--limit"), 10) : null;
const CONCURRENCY = arg("--concurrency") ? parseInt(arg("--concurrency"), 10) : 80;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mvKey = process.env.MILLIONVERIFIER_API_KEY;
if (!supabaseUrl || !supabaseServiceKey || !mvKey) {
  console.error("Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MILLIONVERIFIER_API_KEY)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

// 1. Pre-fetch all NO company IDs (paginated past 1000 cap)
console.log("Loading NO company IDs...");
const noCompanyIds = [];
let cOffset = 0;
const PAGE_SIZE = 1000;
while (true) {
  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("country_code", "NO")
    .order("id")
    .range(cOffset, cOffset + PAGE_SIZE - 1);
  if (error) { console.error("Fetch error:", error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  noCompanyIds.push(...data.map((d) => d.id));
  if (data.length < PAGE_SIZE) break;
  cOffset += PAGE_SIZE;
}
console.log(`  ${noCompanyIds.length} NO companies.`);

// 2. Pull contacts in batches of 200 IDs (PostgREST .in() limit)
const all = [];
const CHUNK = 200;
for (let i = 0; i < noCompanyIds.length; i += CHUNK) {
  const ids = noCompanyIds.slice(i, i + CHUNK);
  let q = supabase
    .from("contacts")
    .select("id, email, email_status, email_verified_at")
    .eq("workspace_id", WORKSPACE_ID)
    .in("company_id", ids)
    .not("email", "is", null)
    .neq("email", "");
  if (ONLY_NULL) q = q.is("email_status", null);
  const { data, error } = await q;
  if (error) { console.error("Fetch error:", error.message); process.exit(1); }
  if (data) all.push(...data);
  if (LIMIT && all.length >= LIMIT) break;
}
const rows = LIMIT ? all.slice(0, LIMIT) : all;

// Filter by freshness cache
const targets = rows.filter((r) => !shouldSkip(r.email_status, r.email_verified_at));
const cached = rows.length - targets.length;
console.log(`NO contacts with email: ${rows.length}`);
console.log(`Cached (fresh enough): ${cached}`);
console.log(`To verify:             ${targets.length}`);
console.log(`Estimated cost:        $${(targets.length * 0.0007).toFixed(2)} (~$0.7/1k)`);

if (DRY_RUN) { console.log("\nDRY-RUN."); process.exit(0); }
if (targets.length === 0) { console.log("Nothing to verify."); process.exit(0); }

let verified = 0, updateErrors = 0;
const startTs = Date.now();
const queue = [...targets];

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    if (!row) return;
    try {
      const { status } = await verifyEmail(row.email, mvKey);
      const { error } = await supabase
        .from("contacts")
        .update({ email_status: status, email_verified_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) { console.error(`\n  update ${row.id}: ${error.message}`); updateErrors++; }
      else { verified++; }
      if (verified % 50 === 0) {
        const elapsed = Math.round((Date.now() - startTs) / 1000);
        process.stdout.write(`\r  verified ${verified}/${targets.length}  elapsed=${elapsed}s`);
      }
    } catch (err) {
      console.error(`\n  MV error on ${row.email}: ${err.message}`);
      // Don't update — leave for retry. Halt on persistent error.
      updateErrors++;
      if (updateErrors > 20) {
        console.error("Too many errors — halting");
        process.exit(1);
      }
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(`\nDone. Verified ${verified}/${targets.length} (${updateErrors} errors).`);

// Distribution snapshot
const { data: dist } = await supabase
  .from("contacts")
  .select("email_status, count:id.count()")
  .eq("workspace_id", WORKSPACE_ID)
  .not("email", "is", null);
const stats = {};
if (dist) for (const r of dist) stats[r.email_status || "null"] = (stats[r.email_status || "null"] || 0) + 1;
console.log("\nCurrent email_status distribution (all workspace NO contacts):", stats);
