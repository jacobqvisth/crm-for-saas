// One-off: move all companies + contacts from a source workspace to a
// destination workspace, merging records that collide on (workspace_id, domain)
// so the partial UNIQUE index doesn't reject the move. Also re-points any
// discovered_shops crm_company_id / crm_contact_id pointers.
//
// Built to clean up the misallocation caused by the promote route's
// non-deterministic workspace lookup before PR #132 — 4,690 contacts +
// 4,690 companies landed in the wrong workspace. Kept as a re-runnable
// template; require explicit --from / --to UUIDs.
//
// Usage:
//   node scripts/move-workspace-data.mjs --from <uuid> --to <uuid> [--dry-run]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? true;
};

const FROM = getArg("--from");
const TO = getArg("--to");
const DRY_RUN = args.includes("--dry-run");

if (!FROM || !TO) {
  console.error("ERROR: --from <uuid> --to <uuid> required");
  process.exit(1);
}
if (FROM === TO) {
  console.error("ERROR: --from and --to must differ");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PAGE = 1000;

async function fetchAll(builder) {
  const out = [];
  let off = 0;
  while (true) {
    const { data, error } = await builder.range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
    off += PAGE;
  }
  return out;
}

// ── 1. Pre-flight: load both sides ──────────────────────────────────────────
console.log(`FROM: ${FROM}`);
console.log(`TO:   ${TO}`);
console.log(`DRY-RUN: ${DRY_RUN}\n`);

const fromCompanies = await fetchAll(
  sb.from("companies").select("id, domain, name, country_code").eq("workspace_id", FROM)
);
const toCompaniesWithDomain = await fetchAll(
  sb.from("companies").select("id, domain").eq("workspace_id", TO).not("domain", "is", null)
);
const toDomainMap = new Map(); // lowercased domain → TO company id
for (const c of toCompaniesWithDomain) toDomainMap.set(c.domain.toLowerCase(), c.id);

const fromContacts = await fetchAll(
  sb.from("contacts").select("id, email, company_id").eq("workspace_id", FROM)
);
const toContacts = await fetchAll(
  sb.from("contacts").select("id, email, company_id").eq("workspace_id", TO).not("email", "is", null)
);
const toEmailMap = new Map(); // lowercased email → TO contact id
for (const c of toContacts) {
  if (c.email) toEmailMap.set(c.email.toLowerCase(), c.id);
}

const collidingCompanies = fromCompanies.filter(
  (c) => c.domain && toDomainMap.has(c.domain.toLowerCase())
);
const nonCollidingCompanies = fromCompanies.filter(
  (c) => !c.domain || !toDomainMap.has(c.domain.toLowerCase())
);

console.log(`FROM companies total: ${fromCompanies.length}`);
console.log(`FROM contacts total:  ${fromContacts.length}`);
console.log(`Domain collisions:    ${collidingCompanies.length} (will merge into TO)`);
console.log(`No-collision moves:   ${nonCollidingCompanies.length} (just flip workspace_id)\n`);

// Map: FROM company id → TO company id (for collisions)
const companyRemap = new Map();
for (const c of collidingCompanies) {
  companyRemap.set(c.id, toDomainMap.get(c.domain.toLowerCase()));
}

// Among FROM contacts, classify:
//   - whose company is being merged (need re-point + dedup against email)
//   - whose company is being moved as-is (just flip workspace_id; might still collide on email)
const contactsOnMergedCompanies = fromContacts.filter((c) => companyRemap.has(c.company_id));
const contactsOnMovedCompanies = fromContacts.filter((c) => !companyRemap.has(c.company_id));

const emailDuplicatesOnMerged = contactsOnMergedCompanies.filter(
  (c) => c.email && toEmailMap.has(c.email.toLowerCase())
);
const emailDuplicatesOnMoved = contactsOnMovedCompanies.filter(
  (c) => c.email && toEmailMap.has(c.email.toLowerCase())
);

console.log(`FROM contacts on merged companies: ${contactsOnMergedCompanies.length}`);
console.log(`  → email duplicates (will repoint shops then delete): ${emailDuplicatesOnMerged.length}`);
console.log(`  → unique emails (will repoint company_id + flip workspace): ${contactsOnMergedCompanies.length - emailDuplicatesOnMerged.length}`);
console.log(`FROM contacts on moved companies:  ${contactsOnMovedCompanies.length}`);
console.log(`  → email duplicates (rare; would need manual review): ${emailDuplicatesOnMoved.length}`);
console.log(`  → unique emails (will flip workspace_id only): ${contactsOnMovedCompanies.length - emailDuplicatesOnMoved.length}\n`);

if (DRY_RUN) {
  console.log("DRY-RUN — no writes. Re-run without --dry-run to apply.");
  process.exit(0);
}

// ── 2. Re-point discovered_shops to merged-into companies ──────────────────
// We do this BEFORE deleting the FROM company so the FK is replaced cleanly.
// (discovered_shops.crm_company_id has no FK constraint at the DB level —
// the route uses it as a soft pointer — so a stale ID would silently break
// the company-detail page's "discovered_shop" tab. Worth keeping consistent.)

const collidingCompanyIds = collidingCompanies.map((c) => c.id);
let shopsRepointed = 0;

if (collidingCompanyIds.length > 0) {
  // Fetch shops in chunks; the .in() URL has a length limit
  const allShops = [];
  for (let i = 0; i < collidingCompanyIds.length; i += 200) {
    const chunk = collidingCompanyIds.slice(i, i + 200);
    const { data, error } = await sb
      .from("discovered_shops")
      .select("id, crm_company_id")
      .in("crm_company_id", chunk);
    if (error) throw error;
    allShops.push(...(data ?? []));
  }
  console.log(`discovered_shops pointing to merging companies: ${allShops.length}`);

  // Update each shop's crm_company_id to the merged-into id
  for (let i = 0; i < allShops.length; i++) {
    const newId = companyRemap.get(allShops[i].crm_company_id);
    const { error } = await sb
      .from("discovered_shops")
      .update({ crm_company_id: newId })
      .eq("id", allShops[i].id);
    if (error) throw error;
    shopsRepointed++;
  }
}
console.log(`✓ Re-pointed ${shopsRepointed} discovered_shops to merged-into companies.\n`);

// ── 3. Re-point shops + delete duplicate contacts on merged companies ──────
// For each FROM contact whose email already exists in TO, re-point the shop's
// crm_contact_id to the TO contact, then delete the FROM contact.

let contactsDeletedAsDuplicates = 0;
let contactsShopsRepointed = 0;

for (const c of emailDuplicatesOnMerged) {
  const toContactId = toEmailMap.get(c.email.toLowerCase());
  // Re-point any discovered_shops crm_contact_id pointing at this FROM contact
  const { data: shops, error: e1 } = await sb
    .from("discovered_shops")
    .select("id")
    .eq("crm_contact_id", c.id);
  if (e1) throw e1;
  for (const s of shops ?? []) {
    const { error } = await sb
      .from("discovered_shops")
      .update({ crm_contact_id: toContactId })
      .eq("id", s.id);
    if (error) throw error;
    contactsShopsRepointed++;
  }
  // Delete the FROM contact
  const { error: delErr } = await sb.from("contacts").delete().eq("id", c.id);
  if (delErr) throw delErr;
  contactsDeletedAsDuplicates++;
}
console.log(`✓ Deleted ${contactsDeletedAsDuplicates} duplicate FROM contacts (re-pointed ${contactsShopsRepointed} shops).\n`);

// ── 4. Update non-duplicate contacts on merged companies ───────────────────
// Set workspace_id=TO, company_id=remapped TO company. Chunk in batches.

const contactsToRemap = contactsOnMergedCompanies.filter(
  (c) => !c.email || !toEmailMap.has(c.email.toLowerCase())
);
let contactsRemapped = 0;

for (const c of contactsToRemap) {
  const newCompanyId = companyRemap.get(c.company_id);
  const { error } = await sb
    .from("contacts")
    .update({ workspace_id: TO, company_id: newCompanyId })
    .eq("id", c.id);
  if (error) throw error;
  contactsRemapped++;
}
console.log(`✓ Re-pointed ${contactsRemapped} contacts to merged-into companies.\n`);

// ── 5. Delete the now-empty merged-from companies ──────────────────────────
let companiesDeleted = 0;
for (let i = 0; i < collidingCompanyIds.length; i += 200) {
  const chunk = collidingCompanyIds.slice(i, i + 200);
  const { error } = await sb.from("companies").delete().in("id", chunk);
  if (error) throw error;
  companiesDeleted += chunk.length;
}
console.log(`✓ Deleted ${companiesDeleted} duplicate FROM companies.\n`);

// ── 6. Bulk-move non-colliding companies (just flip workspace_id) ─────────
const nonCollidingIds = nonCollidingCompanies.map((c) => c.id);
let companiesMoved = 0;
for (let i = 0; i < nonCollidingIds.length; i += 200) {
  const chunk = nonCollidingIds.slice(i, i + 200);
  const { error } = await sb.from("companies").update({ workspace_id: TO }).in("id", chunk);
  if (error) throw error;
  companiesMoved += chunk.length;
}
console.log(`✓ Moved ${companiesMoved} non-colliding companies (workspace_id flip).\n`);

// ── 7. Bulk-move remaining contacts (those on moved-as-is companies) ──────
// At this point all contacts left in FROM should be on companies that have
// already been moved to TO; we just need to flip their workspace_id too.
// Email duplicates here are rare and shouldn't blow up — no unique constraint
// on (workspace_id, email). Leave them for manual cleanup if needed.
const remainingContactIds = contactsOnMovedCompanies.map((c) => c.id);
let contactsMoved = 0;
for (let i = 0; i < remainingContactIds.length; i += 200) {
  const chunk = remainingContactIds.slice(i, i + 200);
  const { error } = await sb.from("contacts").update({ workspace_id: TO }).in("id", chunk);
  if (error) throw error;
  contactsMoved += chunk.length;
}
console.log(`✓ Moved ${contactsMoved} contacts (workspace_id flip).\n`);

// ── 8. Verify ───────────────────────────────────────────────────────────────
const { count: leftoverCompanies } = await sb
  .from("companies")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", FROM);
const { count: leftoverContacts } = await sb
  .from("contacts")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", FROM);

console.log(`\nPost-move totals in FROM workspace: companies=${leftoverCompanies}, contacts=${leftoverContacts}`);

const { count: toCompaniesAfter } = await sb
  .from("companies")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", TO);
const { count: toContactsAfter } = await sb
  .from("contacts")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", TO);
console.log(`Post-move totals in TO workspace: companies=${toCompaniesAfter}, contacts=${toContactsAfter}`);

console.log(`\n✅ Done.
  Collisions merged:           ${collidingCompanies.length}
  Duplicate contacts deleted:  ${contactsDeletedAsDuplicates}
  Contacts re-pointed:         ${contactsRemapped}
  Companies moved (flip):      ${companiesMoved}
  Contacts moved (flip):       ${contactsMoved}
  discovered_shops repointed:  ${shopsRepointed + contactsShopsRepointed}
`);
