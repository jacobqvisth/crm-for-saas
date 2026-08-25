// Ops script: find (and optionally remove) sequence enrollments whose contact
// sits on one of the exclusion lists.
//
// WHY THIS EXISTS
// ---------------
// Exclusions (`src/lib/lists/exclusions.ts`) are enforced at *enrollment* time:
// a contact list opts into `never_call` / `partners` / `internal_testers` via
// `contact_lists.exclusions`, and `/api/lists/[id]/resolve` subtracts the
// matching contacts before they are enrolled. Nothing re-checks them afterwards
// — the send cron (`/api/cron/process-emails`) only consults `suppressions`.
//
// So a contact leaks through in two ways:
//   1. It was enrolled from a list with no exclusions configured (the Swedish
//      cold-outreach filter lists have `exclusions: null`).
//   2. It was enrolled first, and added to never-call / flagged as a partner
//      afterwards. The live enrollment keeps sending.
//
// This script closes that loop. Run it before restarting a paused sequence.
// It checks every non-terminal enrollment ('active' and 'paused' — `resume-all`
// revives paused rows, so they are just as live) against all three exclusion
// groups, using the same matching rules as `resolveExcludedContactIds`.
//
// Usage:
//   node scripts/audit-sequence-exclusions.mjs                    # dry-run, all sequences
//   node scripts/audit-sequence-exclusions.mjs --sequence Sverige # one sequence
//   node scripts/audit-sequence-exclusions.mjs --apply            # cancel queue rows + close enrollments
//
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const seqArgIndex = process.argv.indexOf("--sequence");
const SEQ_FILTER = seqArgIndex !== -1 ? process.argv[seqArgIndex + 1] : null;

// Mirrors INTERNAL_TEST_EMAIL_DOMAINS in src/lib/ceo/internal-test/auto-flag.ts.
const INTERNAL_TEST_EMAIL_DOMAINS = ["wrenchlane.com", "codeoc.ai", "bitknife.se"];

// Non-terminal enrollment states. 'paused' counts: POST /api/sequences/[id]/resume-all
// flips paused -> active and revives the latest cancelled queue row, so a paused
// enrollment on an exclusion list is one click away from sending.
const LIVE_STATUSES = ["active", "paused"];

const envText = readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") || l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log(APPLY ? "MODE: APPLY (writes will execute)" : "MODE: DRY-RUN (no writes)");
if (SEQ_FILTER) console.log(`Sequence filter: ${SEQ_FILTER}`);

// PostgREST encodes .in() lists in the URL, so long lists 414 or silently
// truncate. Chunk every value-based fetch, same as exclusions.ts.
const IN_CHUNK = 100;

/** Page through a table with a unique tiebreaker on the order key. */
async function pageAll(build) {
  const PAGE = 1000;
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

// --- Load the exclusion sources ---------------------------------------------

async function loadExclusionSources() {
  const [{ data: callExclusions }, { data: partners }, { data: internalUsers }, { data: patterns }] =
    await Promise.all([
      supabase.from("call_exclusions").select("kind, value"),
      supabase.from("companies").select("id, domain").eq("is_partner", true),
      supabase
        .from("dashboard_users")
        .select("internal_user_id, is_internal_test, is_internal_test_exempt")
        .or("is_internal_test.eq.true,is_internal_test_exempt.eq.true"),
      supabase.from("dashboard_internal_test_patterns").select("kind, value"),
    ]);

  const neverCall = { companies: new Set(), emails: new Set(), domains: new Set() };
  for (const e of callExclusions ?? []) {
    if (e.kind === "company") neverCall.companies.add(e.value);
    else if (e.kind === "email") neverCall.emails.add(e.value.toLowerCase());
    else if (e.kind === "domain") neverCall.domains.add(e.value.toLowerCase());
  }

  const partnerCompanies = new Set();
  const partnerDomains = new Set();
  for (const c of partners ?? []) {
    partnerCompanies.add(c.id);
    if (c.domain) partnerDomains.add(c.domain.toLowerCase());
  }

  // A partner row's domain excludes EVERY contact at that domain. Broad domains
  // (meko.com, meca.se) therefore reach independent franchise workshops that are
  // deliberately NOT flagged as partners. Surfaced so it is a visible choice.
  const internalUserIds = new Set();
  for (const u of internalUsers ?? []) {
    if (u.is_internal_test && !u.is_internal_test_exempt) internalUserIds.add(String(u.internal_user_id));
  }

  const internalEmails = new Set();
  for (const p of patterns ?? []) {
    if (p.kind === "email") internalEmails.add(p.value.toLowerCase());
  }

  return { neverCall, partnerCompanies, partnerDomains, internalUserIds, internalEmails };
}

/** Every reason this contact is excluded, or [] if it is clean. */
function exclusionReasons(contact, src) {
  const email = (contact.email ?? "").toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop() : null;
  const reasons = [];

  if (contact.company_id && src.neverCall.companies.has(contact.company_id)) reasons.push("never_call:company");
  if (email && src.neverCall.emails.has(email)) reasons.push("never_call:email");
  if (domain && src.neverCall.domains.has(domain)) reasons.push(`never_call:domain=${domain}`);

  if (contact.company_id && src.partnerCompanies.has(contact.company_id)) reasons.push("partner:company");
  if (domain && src.partnerDomains.has(domain)) reasons.push(`partner:domain=${domain}`);

  if (contact.wl_user_id && src.internalUserIds.has(String(contact.wl_user_id))) reasons.push("internal:user");
  if (email && src.internalEmails.has(email)) reasons.push("internal:email");
  if (domain && INTERNAL_TEST_EMAIL_DOMAINS.includes(domain)) reasons.push(`internal:domain=${domain}`);

  return reasons;
}

// --- Audit ------------------------------------------------------------------

const src = await loadExclusionSources();
console.log(
  `Exclusion sources: ${src.neverCall.companies.size} never-call companies, ` +
    `${src.neverCall.emails.size} emails, ${src.neverCall.domains.size} domains; ` +
    `${src.partnerCompanies.size} partner companies (${src.partnerDomains.size} with a domain); ` +
    `${src.internalUserIds.size} internal-test users, ${src.internalEmails.size} internal email patterns.`,
);

const { data: sequences } = await supabase.from("sequences").select("id, name");
const seqName = new Map((sequences ?? []).map((s) => [s.id, s.name]));

const enrollments = await pageAll(() =>
  supabase
    .from("sequence_enrollments")
    .select("id, sequence_id, contact_id, status, current_step")
    .in("status", LIVE_STATUSES)
    .order("id", { ascending: true }),
);

const scoped = SEQ_FILTER
  ? enrollments.filter((e) => seqName.get(e.sequence_id) === SEQ_FILTER)
  : enrollments;

console.log(`Live enrollments to check (${LIVE_STATUSES.join("/")}): ${scoped.length}`);

// Fetch the contacts behind those enrollments.
const contactIds = [...new Set(scoped.map((e) => e.contact_id).filter(Boolean))];
const contacts = new Map();
for (let i = 0; i < contactIds.length; i += IN_CHUNK) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, company_id, wl_user_id")
    .in("id", contactIds.slice(i, i + IN_CHUNK));
  if (error) throw new Error(error.message);
  for (const c of data ?? []) contacts.set(c.id, c);
}

const violations = [];
for (const e of scoped) {
  const contact = contacts.get(e.contact_id);
  if (!contact) continue;
  const reasons = exclusionReasons(contact, src);
  if (reasons.length > 0) {
    violations.push({ enrollment: e, contact, reasons });
  }
}

if (violations.length === 0) {
  console.log("\nCLEAN: no live enrollment matches any exclusion list.");
  process.exit(0);
}

// Count the armed queue rows — these are what actually fire on restart.
const armed = new Map();
const violationIds = violations.map((v) => v.enrollment.id);
for (let i = 0; i < violationIds.length; i += IN_CHUNK) {
  const { data } = await supabase
    .from("email_queue")
    .select("id, enrollment_id")
    .eq("status", "scheduled")
    .in("enrollment_id", violationIds.slice(i, i + IN_CHUNK));
  for (const row of data ?? []) armed.set(row.enrollment_id, (armed.get(row.enrollment_id) ?? 0) + 1);
}

console.log(`\n${violations.length} live enrollment(s) on an exclusion list:\n`);
const bySeq = new Map();
for (const v of violations) {
  const name = seqName.get(v.enrollment.sequence_id) ?? v.enrollment.sequence_id;
  if (!bySeq.has(name)) bySeq.set(name, []);
  bySeq.get(name).push(v);
}
for (const [name, rows] of [...bySeq.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const armedCount = rows.reduce((n, v) => n + (armed.get(v.enrollment.id) ?? 0), 0);
  console.log(`  ${name} — ${rows.length} enrollment(s), ${armedCount} armed queue row(s)`);
  for (const v of rows) {
    console.log(
      `    [${v.enrollment.status}] step ${v.enrollment.current_step ?? 0}  ${v.contact.email}  (${v.reasons.join(", ")})`,
    );
  }
}

if (!APPLY) {
  console.log("\nDry-run: nothing written. Re-run with --apply to cancel the queue rows and close these enrollments.");
  process.exit(0);
}

// --- Apply ------------------------------------------------------------------
//
// Two writes per violation, in this order so no row is ever left active with a
// live queue row:
//   1. email_queue scheduled -> cancelled (stops the imminent send)
//   2. sequence_enrollments  -> 'completed'
//
// 'completed' is used deliberately: the status CHECK constraint allows only
// active/completed/replied/unsubscribed/bounced/paused, and `resume-all` revives
// ONLY paused + company_paused. So 'paused' would come straight back on the next
// Resume All, and 'unsubscribed' would pollute the unsubscribe rate. 'completed'
// is the one terminal state that is both durable and statistically harmless.
let cancelled = 0;
for (let i = 0; i < violationIds.length; i += IN_CHUNK) {
  const chunk = violationIds.slice(i, i + IN_CHUNK);
  const { data, error } = await supabase
    .from("email_queue")
    .update({ status: "cancelled" })
    .in("enrollment_id", chunk)
    .eq("status", "scheduled")
    .select("id");
  if (error) throw new Error(`cancel queue rows: ${error.message}`);
  cancelled += (data ?? []).length;
}

let closed = 0;
for (let i = 0; i < violationIds.length; i += IN_CHUNK) {
  const chunk = violationIds.slice(i, i + IN_CHUNK);
  const { data, error } = await supabase
    .from("sequence_enrollments")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .in("id", chunk)
    .in("status", LIVE_STATUSES)
    .select("id");
  if (error) throw new Error(`close enrollments: ${error.message}`);
  closed += (data ?? []).length;
}

console.log(`\nAPPLIED: ${cancelled} queue row(s) cancelled, ${closed} enrollment(s) closed.`);
