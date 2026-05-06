// One-off: un-promote `discovered_shops` rows where shop_type='auto_glass'
// AND `all_categories` doesn't include any auto-body-related Google category.
// Pure auto-glass shops (Carglass, Ryds Bilglas, etc.) aren't a fit for the
// mechanic-focused outreach. Combo shops (auto_body + auto_glass) stay in.
//
// What "un-promote" means here:
//   - Mark discovered_shops as status='skipped' and null out crm_company_id /
//     crm_contact_id pointers.
//   - Delete the contact (we created one per promoted shop; safe to drop).
//   - Delete the company IF no other discovered_shops still reference it.
//     For shared companies (chains like Carglass with multiple locations),
//     keep the company alive — only the shop's pointer gets unhooked.
//
// Usage:
//   node scripts/unpromote-auto-glass-only.mjs [--country SE] [--dry-run]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] ?? true;
};

const COUNTRY = getArg("--country") ? String(getArg("--country")).toUpperCase() : null;
const DRY_RUN = args.includes("--dry-run");
const BODY_KEYWORDS = /auto body|body shop|paintless|car repair|car restoration|car painting|car body|bilverkstad|bilreparation/i;

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

// ── 1. Find candidates ──────────────────────────────────────────────────────
let q = sb
  .from("discovered_shops")
  .select("id, name, country_code, all_categories, category, crm_company_id, crm_contact_id")
  .eq("shop_type", "auto_glass")
  .eq("status", "imported");
if (COUNTRY) q = q.eq("country_code", COUNTRY);

const all = await fetchAll(q);
const targets = all.filter((r) => {
  const cats = r.all_categories ?? (r.category ? [r.category] : []);
  return !cats.some((c) => BODY_KEYWORDS.test(c));
});
console.log(
  `Imported auto_glass ${COUNTRY ? `(country=${COUNTRY})` : "(all countries)"}: ${all.length}`,
);
console.log(`  → pure auto-glass (will un-promote): ${targets.length}`);
console.log(`  → combo with auto_body keywords (kept): ${all.length - targets.length}\n`);

if (targets.length === 0) {
  console.log("Nothing to un-promote.");
  process.exit(0);
}

// ── 2. Determine which companies are shared with non-target shops ──────────
// Sharing happens when the promote route's dedup logic linked multiple shops
// to the same company (e.g. Carglass chain has many locations under one
// company row). Keep those companies alive; only un-link the target shop.

const targetCompanyIds = [
  ...new Set(targets.map((t) => t.crm_company_id).filter(Boolean)),
];
const targetIdSet = new Set(targets.map((t) => t.id));

const referencingShops = [];
for (let i = 0; i < targetCompanyIds.length; i += 200) {
  const chunk = targetCompanyIds.slice(i, i + 200);
  const { data, error } = await sb
    .from("discovered_shops")
    .select("id, crm_company_id")
    .in("crm_company_id", chunk);
  if (error) throw error;
  referencingShops.push(...(data ?? []));
}
const otherShopRefsByCompany = new Map();
for (const s of referencingShops) {
  if (!targetIdSet.has(s.id)) {
    otherShopRefsByCompany.set(
      s.crm_company_id,
      (otherShopRefsByCompany.get(s.crm_company_id) ?? 0) + 1,
    );
  }
}

const companiesToDelete = targetCompanyIds.filter((id) => !otherShopRefsByCompany.has(id));
const companiesToKeep = targetCompanyIds.filter((id) => otherShopRefsByCompany.has(id));
console.log(`Companies to delete (no other shop refs): ${companiesToDelete.length}`);
console.log(`Companies to keep (shared with non-target shops): ${companiesToKeep.length}`);

const contactIdsToDelete = targets.map((t) => t.crm_contact_id).filter(Boolean);
console.log(`Contacts to delete: ${contactIdsToDelete.length}\n`);

if (DRY_RUN) {
  console.log("DRY-RUN — no writes. Re-run without --dry-run to apply.");
  process.exit(0);
}

// ── 3. Reset discovered_shops first (clears the FK soft-pointers) ──────────
const targetShopIds = targets.map((t) => t.id);
let shopsReset = 0;
for (let i = 0; i < targetShopIds.length; i += 200) {
  const chunk = targetShopIds.slice(i, i + 200);
  const { error } = await sb
    .from("discovered_shops")
    .update({ status: "skipped", crm_company_id: null, crm_contact_id: null })
    .in("id", chunk);
  if (error) throw error;
  shopsReset += chunk.length;
}
console.log(`✓ Reset ${shopsReset} discovered_shops to status='skipped' with cleared pointers.`);

// ── 4. Delete contacts ─────────────────────────────────────────────────────
let contactsDeleted = 0;
for (let i = 0; i < contactIdsToDelete.length; i += 200) {
  const chunk = contactIdsToDelete.slice(i, i + 200);
  const { error } = await sb.from("contacts").delete().in("id", chunk);
  if (error) throw error;
  contactsDeleted += chunk.length;
}
console.log(`✓ Deleted ${contactsDeleted} contacts.`);

// ── 5. Delete unshared companies ───────────────────────────────────────────
let companiesDeleted = 0;
for (let i = 0; i < companiesToDelete.length; i += 200) {
  const chunk = companiesToDelete.slice(i, i + 200);
  const { error } = await sb.from("companies").delete().in("id", chunk);
  if (error) throw error;
  companiesDeleted += chunk.length;
}
console.log(`✓ Deleted ${companiesDeleted} unshared companies.`);

console.log(`\n✅ Done.
  Shops un-promoted (status='skipped'): ${shopsReset}
  Contacts deleted:                     ${contactsDeleted}
  Companies deleted:                    ${companiesDeleted}
  Companies kept (shared with chains):  ${companiesToKeep.length}
  Combo shops left as-is:               ${all.length - targets.length}
`);
