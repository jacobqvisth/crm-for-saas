// Import Hans's pre-CRM manual outreach log into the CRM.
//
// Source: scripts/data/hans-manual-outreach.json
//   (extracted from `_inbox/wrenchlane_verkstadsmail_2025-2026.xlsx` — Hans's
//   personal Gmail outreach ledger covering 2025-03 → 2025-11, 82 threads.
//   See `scripts/data/_README-hans-outreach.md` for extraction details.)
//
// What this does — for each of 79 prospect threads:
//   1. Upsert the **company** (by domain when present, else by name match).
//      Sets `last_visited_at = thread date`, `last_contacted_at`-equivalent
//      semantics via the contact, tags it with `manual-outreach-2025`.
//   2. Upsert the **contact** (by email). Sets `last_contacted_at`,
//      `last_visited_at`, `source='manual'`, lead_status by classification.
//   3. Insert one **activity** row (type='note', subject=Hans's email subject,
//      body=summary, metadata={n_mails, n_replies, replied}). Preserves the
//      full thread story without overwriting the contact's `notes` field.
//   4. Per classification:
//        cold        → lead_status=contacted, lifecycle_stage=lead
//        mid_stage   → lead_status=engaged,   lifecycle_stage=mql, +hot-replied-2025 tag
//        late_stage  → lead_status=qualified, lifecycle_stage=sql, +hot-replied-2025 tag
//        customer    → lead_status=customer,  lifecycle_stage=paying,
//                      customer_status=active on the company,
//                      +hot-replied-2025 tag
//
// Modes:
//   node scripts/import-hans-outreach.mjs           → dry-run (default)
//   node scripts/import-hans-outreach.mjs --apply   → write to prod
//
// Idempotency: re-running is safe. Companies / contacts upsert by domain/email,
// the cohort tag is added-not-replaced, and activity rows use a deterministic
// external_id (`hans-outreach:<email>:<thread-date>`) so they de-dup.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0"; // wrenchlane.com workspace
const COHORT_TAG = "manual-outreach-2025";
const HOT_TAG = "hot-replied-2025";

const DATA_PATH = join(__dirname, "data/hans-manual-outreach.json");
const payload = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
console.log(
  `Loaded ${payload.rows.length} rows (skipped ${payload.skipped.length}) — mode: ${
    APPLY ? "APPLY" : "DRY-RUN"
  }`,
);

// ---------------- classification → field mapping ----------------
// NOTE: DB check constraint allows lead_status IN
// (new, contacted, qualified, customer, churned). 'engaged' is documented in
// CLAUDE.md but NOT in the constraint — using 'qualified' for both mid- and
// late-stage replied threads. Tags + lifecycle_stage carry the funnel detail.
const PROFILE = {
  cold: { lead_status: "contacted", lifecycle_stage: "lead", hot_tag: false, customer: false },
  mid_stage: { lead_status: "qualified", lifecycle_stage: "mql", hot_tag: true, customer: false },
  late_stage: {
    lead_status: "qualified",
    lifecycle_stage: "sql",
    hot_tag: true,
    customer: false,
  },
  customer: {
    lead_status: "customer",
    lifecycle_stage: "paying",
    hot_tag: true,
    customer: true,
  },
};

// Merge new tags into an existing tags array without duplicates
function mergeTags(existing, additions) {
  const set = new Set(existing ?? []);
  for (const t of additions) set.add(t);
  return Array.from(set);
}

// ---------------- pre-fetch existing companies/contacts ----------------
console.log("\nFetching existing companies + contacts…");

const allEmails = payload.rows.map((r) => r.email);
const allDomains = Array.from(
  new Set(payload.rows.map((r) => r.company_domain).filter(Boolean)),
);

async function fetchExistingContacts(emails) {
  const map = new Map();
  const CHUNK = 200;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const slice = emails.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, email, first_name, last_name, company_id, tags, lead_status, source, last_contacted_at, last_visited_at, notes",
      )
      .eq("workspace_id", WORKSPACE_ID)
      .in("email", slice);
    if (error) throw new Error(`contacts fetch failed: ${error.message}`);
    for (const c of data ?? []) map.set(c.email.toLowerCase(), c);
  }
  return map;
}

async function fetchExistingCompanies(domains, names) {
  const byDomain = new Map();
  const byName = new Map();
  const CHUNK = 200;
  // by domain
  for (let i = 0; i < domains.length; i += CHUNK) {
    const slice = domains.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("companies")
      .select(
        "id, name, domain, tags, customer_status, lifecycle_stage, acquisition_source, last_visited_at",
      )
      .eq("workspace_id", WORKSPACE_ID)
      .in("domain", slice);
    if (error) throw new Error(`companies (domain) fetch failed: ${error.message}`);
    for (const c of data ?? []) {
      if (c.domain) byDomain.set(c.domain.toLowerCase(), c);
      if (c.name) byName.set(c.name.toLowerCase(), c);
    }
  }
  // by name — for rows with no resolvable domain (free-mail) and to catch the
  // case where the workshop already exists with a slightly different domain
  for (let i = 0; i < names.length; i += CHUNK) {
    const slice = names.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("companies")
      .select(
        "id, name, domain, tags, customer_status, lifecycle_stage, acquisition_source, last_visited_at",
      )
      .eq("workspace_id", WORKSPACE_ID)
      .in("name", slice);
    if (error) throw new Error(`companies (name) fetch failed: ${error.message}`);
    for (const c of data ?? []) {
      if (c.domain && !byDomain.has(c.domain.toLowerCase())) byDomain.set(c.domain.toLowerCase(), c);
      if (c.name) byName.set(c.name.toLowerCase(), c);
    }
  }
  return { byDomain, byName };
}

const allNames = Array.from(
  new Set(payload.rows.map((r) => r.company_name).filter(Boolean)),
);
const existingContacts = await fetchExistingContacts(allEmails);
const { byDomain: existingCompaniesByDomain, byName: existingCompaniesByName } =
  await fetchExistingCompanies(allDomains, allNames);
console.log(
  `  existing contacts: ${existingContacts.size}/${allEmails.length}, ` +
    `existing companies by domain: ${existingCompaniesByDomain.size}/${allDomains.length}, ` +
    `by name: ${existingCompaniesByName.size}/${allNames.length}`,
);

// ---------------- per-row planning + apply ----------------
let companiesCreated = 0,
  companiesUpdated = 0,
  contactsCreated = 0,
  contactsUpdated = 0,
  activitiesInserted = 0;

const issues = [];

for (const r of payload.rows) {
  const profile = PROFILE[r.classification] ?? PROFILE.cold;
  const visitedAt = r.date_iso ? `${r.date_iso}T00:00:00Z` : null;
  const tagSet = [COHORT_TAG, ...(profile.hot_tag ? [HOT_TAG] : [])];

  // --- 1. resolve / upsert company ---
  // Try domain match first; fall back to name match so free-mail rows
  // (gmail/hotmail) attach to the right workshop instead of creating a
  // duplicate company.
  let companyId = null;
  let existingCo =
    (r.company_domain && existingCompaniesByDomain.get(r.company_domain.toLowerCase())) || null;
  if (!existingCo && r.company_name) {
    existingCo = existingCompaniesByName.get(r.company_name.toLowerCase()) ?? null;
  }

  const companyPayload = {
    workspace_id: WORKSPACE_ID,
    name: r.company_name ?? r.email.split("@")[0],
    domain: r.company_domain ?? null,
    source: "manual",
    acquisition_source: "sales",
    tags: existingCo ? mergeTags(existingCo.tags, tagSet) : tagSet,
    last_visited_at: visitedAt,
    lifecycle_stage: profile.lifecycle_stage,
  };
  if (profile.customer) companyPayload.customer_status = "active";

  if (existingCo) {
    companyId = existingCo.id;
    companiesUpdated++;
    if (APPLY) {
      // Never overwrite an existing non-null domain. Skip the field entirely
      // on UPDATE — if a chain has 25 Speedy Bilservice branches sharing one
      // domain, only the *first* row claims it (via INSERT path below), the
      // rest get NULL domain. Domain backfill on UPDATE is a separate concern.
      const updatePayload = { ...companyPayload };
      delete updatePayload.domain;
      const { error } = await supabase
        .from("companies")
        .update(updatePayload)
        .eq("id", companyId);
      if (error) issues.push({ row: r.row, step: "company_update", error: error.message });
    }
  } else {
    companiesCreated++;
    if (APPLY) {
      let { data, error } = await supabase
        .from("companies")
        .insert(companyPayload)
        .select("id, name, domain")
        .single();
      // Same-domain collision: another row in this run (or another workshop
      // chain branch) already owns this domain. Retry without domain so the
      // branch still lands as its own company record.
      if (error && error.code === "23505" && companyPayload.domain) {
        const retry = { ...companyPayload, domain: null };
        ({ data, error } = await supabase
          .from("companies")
          .insert(retry)
          .select("id, name, domain")
          .single());
      }
      if (error) {
        issues.push({ row: r.row, step: "company_insert", error: error.message });
      } else {
        companyId = data.id;
        const cacheEntry = { id: data.id, name: data.name, domain: data.domain };
        if (data.domain) existingCompaniesByDomain.set(data.domain.toLowerCase(), cacheEntry);
        if (data.name) existingCompaniesByName.set(data.name.toLowerCase(), cacheEntry);
      }
    }
  }

  // --- 2. resolve / upsert contact ---
  const existingCt = existingContacts.get(r.email);
  const contactPayload = {
    workspace_id: WORKSPACE_ID,
    email: r.email,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    company_id: companyId,
    source: "manual",
    lead_status: profile.lead_status,
    tags: existingCt ? mergeTags(existingCt.tags, tagSet) : tagSet,
    last_contacted_at: visitedAt,
    last_visited_at: visitedAt,
  };

  let contactId = existingCt?.id ?? null;
  if (existingCt) {
    contactsUpdated++;
    if (APPLY) {
      const { error } = await supabase
        .from("contacts")
        .update(contactPayload)
        .eq("id", contactId);
      if (error) issues.push({ row: r.row, step: "contact_update", error: error.message });
    }
  } else {
    contactsCreated++;
    if (APPLY) {
      const { data, error } = await supabase
        .from("contacts")
        .insert(contactPayload)
        .select("id")
        .single();
      if (error) {
        issues.push({ row: r.row, step: "contact_insert", error: error.message });
      } else {
        contactId = data.id;
      }
    }
  }

  // --- 3. insert thread-summary activity ---
  // Idempotency: re-running the script must NOT duplicate activities. We can't
  // rely on a unique constraint (activities has none on (contact_id, subject,
  // metadata)), so we use a small pre-check on contact + body match.
  const body =
    `${r.summary ?? ""}\n\n` +
    `--- Imported from Hans's manual outreach log\n` +
    `Thread date: ${r.date_iso}\n` +
    `Mails sent: ${r.n_mails}  ·  Replies: ${r.n_replies}  ·  Replied: ${
      r.replied ? "Ja" : "Nej"
    }`;
  const activityPayload = {
    workspace_id: WORKSPACE_ID,
    company_id: companyId,
    contact_id: contactId,
    type: "note",
    subject: r.subject ?? "Manual outreach",
    body,
    metadata: {
      source: "hans-manual-outreach-2025",
      thread_date: r.date_iso,
      n_mails: r.n_mails,
      n_replies: r.n_replies,
      replied: r.replied,
      classification: r.classification,
    },
  };

  activitiesInserted++;
  if (APPLY && contactId) {
    // Skip the activity if one with the same source+thread_date already exists.
    const { data: existing } = await supabase
      .from("activities")
      .select("id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("contact_id", contactId)
      .eq("type", "note")
      .contains("metadata", {
        source: "hans-manual-outreach-2025",
        thread_date: r.date_iso,
      })
      .limit(1);
    if (existing && existing.length > 0) {
      activitiesInserted--; // already exists, don't double-count
    } else {
      const { error } = await supabase.from("activities").insert(activityPayload);
      if (error) {
        issues.push({ row: r.row, step: "activity_insert", error: error.message });
        activitiesInserted--;
      }
    }
  }
}

// ---------------- report ----------------
console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} SUMMARY ===`);
console.log(`Companies — created: ${companiesCreated}  updated: ${companiesUpdated}`);
console.log(`Contacts  — created: ${contactsCreated}  updated: ${contactsUpdated}`);
console.log(`Activities — would-insert / inserted: ${activitiesInserted}`);
console.log(`\nBy classification:`);
const byClass = {};
for (const r of payload.rows) byClass[r.classification] = (byClass[r.classification] ?? 0) + 1;
for (const [k, v] of Object.entries(byClass)) console.log(`  ${k}: ${v}`);

if (issues.length > 0) {
  console.log(`\n!!! ${issues.length} issue(s):`);
  for (const i of issues.slice(0, 20)) console.log(`  row ${i.row} [${i.step}]: ${i.error}`);
}

console.log(`\n${APPLY ? "Done." : "Re-run with --apply to write to prod."}`);
