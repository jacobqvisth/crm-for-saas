// Import direct-contact emails for Swedish Meko-group workshops (Autoexperten /
// Mekonomen / MECA) from a Lemlist export. Only inserts rows whose email isn't
// already in the workspace contacts — uses lemlist as the authoritative source
// for per-branch direct emails to replace the SCB-import shared-inbox pattern.
//
// Source: /Users/jacobqvisth/Downloads/Meko_Autoexperten_email.xlsx - Blad1 (1).csv
// Workspace: d946ea1f-74b4-492e-ae6a-d50f59ff04f0 (wrenchlane.com)
//
// Per-row classification (run analyze first to size the batch):
//   - email already exists in contacts          → skip (do nothing)
//   - email new, domain matches existing co     → attach contact to that company
//   - email new, domain not in companies        → create new company + contact
//
// Naming convention: source = 'lemlist-meko-2026-05-20', tags include the chain
// label ('autoexperten' | 'mekonomen' | 'meca'). Contact is created with
// email_status='valid', lead_status='new', status='active'.
//
// Idempotent: re-running skips already-existing emails.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";
const SOURCE = "lemlist-meko-2026-05-20";
const CSV_PATH = "/Users/jacobqvisth/Downloads/Meko_Autoexperten_email.xlsx - Blad1 (1).csv";

const chainTag = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// ---------------- 1. Load + parse CSV ----------------
const csv = readFileSync(CSV_PATH, "utf-8");
const rows = csv.split("\n").slice(1)
  .map(line => {
    if (!line.trim()) return null;
    const parts = line.split(",");
    if (parts.length < 3) return null;
    return { name: parts[0].trim(), email: parts[1].trim().toLowerCase(), chain: parts[2].trim() };
  })
  .filter(Boolean);
console.log(`Lemlist rows parsed: ${rows.length}`);

// ---------------- 2. Find emails already in contacts (skip those) ----------------
const allEmails = [...new Set(rows.map(r => r.email))];
const existingEmails = new Set();
const CHUNK = 200;
for (let i = 0; i < allEmails.length; i += CHUNK) {
  const chunk = allEmails.slice(i, i + CHUNK);
  const { data, error } = await supabase
    .from("contacts")
    .select("email")
    .eq("workspace_id", WORKSPACE_ID)
    .in("email", chunk);
  if (error) { console.error("contacts lookup failed:", error.message); process.exit(1); }
  for (const c of data || []) existingEmails.add(c.email.toLowerCase());
}
const newRows = rows.filter(r => !existingEmails.has(r.email));
console.log(`Already in contacts: ${existingEmails.size}`);
console.log(`Net-new rows to insert: ${newRows.length}`);

// ---------------- 3. Find existing companies by domain ----------------
const allDomains = [...new Set(newRows.map(r => r.email.split("@")[1]).filter(Boolean))];
const companyByDomain = new Map(); // lowercase domain -> { id }
for (let i = 0; i < allDomains.length; i += CHUNK) {
  const chunk = allDomains.slice(i, i + CHUNK);
  const { data, error } = await supabase
    .from("companies")
    .select("id, domain")
    .eq("workspace_id", WORKSPACE_ID)
    .in("domain", chunk);
  if (error) { console.error("companies lookup failed:", error.message); process.exit(1); }
  for (const co of data || []) {
    if (co.domain) companyByDomain.set(co.domain.toLowerCase(), { id: co.id });
  }
}
console.log(`Domains with existing companies: ${companyByDomain.size}`);

// ---------------- 4. Insert companies + contacts ----------------
const newContactIds = [];
const issues = [];
let companiesInserted = 0, contactsInserted = 0, contactsSkipped = 0;

for (const r of newRows) {
  const domain = r.email.split("@")[1] || null;
  const cTag = chainTag(r.chain);

  let companyId = domain ? companyByDomain.get(domain)?.id : null;

  if (!companyId) {
    const payload = {
      workspace_id: WORKSPACE_ID,
      name: r.name,
      domain,
      country: "Sweden",
      country_code: "SE",
      source: SOURCE,
      tags: [cTag],
    };
    let { data, error } = await supabase
      .from("companies")
      .insert(payload)
      .select("id, domain")
      .single();

    // Domain collision (another lemlist row already grabbed it in this run) — retry with NULL
    if (error && error.code === "23505") {
      const retry = { ...payload, domain: null };
      ({ data, error } = await supabase
        .from("companies")
        .insert(retry)
        .select("id, domain")
        .single());
    }

    if (error) {
      issues.push({ name: r.name, email: r.email, step: "company_insert", error: error.message });
      continue;
    }
    companyId = data.id;
    if (data.domain) companyByDomain.set(data.domain.toLowerCase(), { id: companyId });
    companiesInserted++;
  }

  const contactPayload = {
    workspace_id: WORKSPACE_ID,
    company_id: companyId,
    email: r.email,
    email_status: "valid",
    country: "Sweden",
    country_code: "SE",
    source: SOURCE,
    lead_status: "new",
    status: "active",
    tags: [cTag],
  };
  const { data, error } = await supabase
    .from("contacts")
    .insert(contactPayload)
    .select("id")
    .single();
  if (error) {
    issues.push({ name: r.name, email: r.email, step: "contact_insert", error: error.message });
    contactsSkipped++;
    continue;
  }
  newContactIds.push(data.id);
  contactsInserted++;
}

console.log(`\nInserted ${companiesInserted} new companies`);
console.log(`Inserted ${contactsInserted} new contacts`);
console.log(`Contacts skipped (errors): ${contactsSkipped}`);
if (issues.length) {
  writeFileSync(join(__dirname, "lemlist-meko-import-issues.json"), JSON.stringify(issues, null, 2));
  console.log(`Wrote ${issues.length} issues to lemlist-meko-import-issues.json`);
}

writeFileSync(
  join(__dirname, "lemlist-meko-import-new-contacts.json"),
  JSON.stringify(newContactIds, null, 2),
);
console.log(`New contact IDs written to lemlist-meko-import-new-contacts.json`);
