// Quick survey of the brreg dataset to sanity-check assumptions in the NO plan.
//
// Reports: total count, % with email/phone, employee bands, top counties + municipalities,
// chain-name detection, noise detection (car wash / detailing / unrelated trades).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] || join(__dirname, "data", "brreg-95310-2026-05-21.json");
const rows = JSON.parse(readFileSync(path, "utf8"));

console.log(`\n=== brreg survey: ${rows.length} underenheter ===\n`);

// Sample one row
console.log("Sample row (first):");
console.log(JSON.stringify(rows[0], null, 2).split("\n").slice(0, 40).join("\n"));
console.log("...\n");

// Contact coverage
let withEmail = 0;
let withPhone = 0;
let withMobil = 0;
let withTelefon = 0;
let withWebsite = 0;
let withAnyContact = 0;
let active = 0;
let inactive = 0;
let underAvvikling = 0;

for (const r of rows) {
  const e = r.epostadresse;
  const m = r.mobil;
  const t = r.telefon;
  const w = r.hjemmeside;
  if (e) withEmail++;
  if (m) withMobil++;
  if (t) withTelefon++;
  if (m || t) withPhone++;
  if (w) withWebsite++;
  if (e || m || t) withAnyContact++;
  if (r.slettedato) inactive++;
  else if (r.underAvvikling) underAvvikling++;
  else active++;
}

const pct = (n) => `${((n / rows.length) * 100).toFixed(1)}%`;
console.log("Contact coverage:");
console.log(`  email:         ${withEmail} (${pct(withEmail)})`);
console.log(`  mobil:         ${withMobil} (${pct(withMobil)})`);
console.log(`  telefon:       ${withTelefon} (${pct(withTelefon)})`);
console.log(`  phone (m|t):   ${withPhone} (${pct(withPhone)})`);
console.log(`  website:       ${withWebsite} (${pct(withWebsite)})`);
console.log(`  any contact:   ${withAnyContact} (${pct(withAnyContact)})`);
console.log();
console.log("Status:");
console.log(`  active:        ${active} (${pct(active)})`);
console.log(`  underAvvikling:${underAvvikling}`);
console.log(`  slettet:       ${inactive}`);

// Geo distribution
const byKommune = new Map();
const byFylke = new Map();
for (const r of rows) {
  const k = r.forretningsadresse?.kommune || r.postadresse?.kommune || "(ukjent)";
  const land = r.forretningsadresse?.land || r.postadresse?.land || null;
  byKommune.set(k, (byKommune.get(k) || 0) + 1);
  // fylke is sometimes nested under address; brreg also has dedicated `fylkesnavn` etc.
  // For now we'll just use kommune. Postal code prefix → fylke is in the importer.
}
const topKommune = [...byKommune.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log("\nTop 15 kommune:");
for (const [k, n] of topKommune) console.log(`  ${k.padEnd(25)} ${n}`);

// Sector / activity hints (look for noise)
const sample = rows.slice(0, 50).map((r) => r.aktivitet?.join(" | ") || "(no aktivitet)");
console.log("\nSample 'aktivitet' (first 5):");
for (const a of sample.slice(0, 5)) console.log(`  ${a.slice(0, 120)}`);

// Chain detection — top brands by name prefix
const chains = [
  ["Mekonomen", /mekonomen/i],
  ["MECA", /\b(meca|mecabilservice|mecaverksted)\b/i],
  ["BilXtra", /bilxtra/i],
  ["AutoMester", /automester/i],
  ["Vianor", /vianor/i],
  ["Fixus", /fixus/i],
  ["Bosch Car Service", /bosch.*car.*service/i],
  ["NAF Senter", /naf.*senter/i],
  ["Autoexperten", /autoexperten/i],
  ["Euromaster", /euromaster/i],
  ["Din Bilpartner", /din.*bilpartner/i],
];
console.log("\nChain matches by name:");
for (const [name, re] of chains) {
  const n = rows.filter((r) => re.test(r.navn || "")).length;
  if (n > 0) console.log(`  ${name.padEnd(22)} ${n}`);
}

// Noise detection — keywords that signal NOT-ICP
const noise = [
  ["vask/wash", /\b(vask|wash|polering|polish|detaljing|detailing)\b/i],
  ["dekkhotell-only", /\b(dekkhotell|tire.*hotel|dekklager)\b/i],
  ["bilglass", /\b(bilglass|carglass|ryds)\b/i],
  ["billakk", /\b(billakk|billakkering|lakkering)\b/i],
];
console.log("\nNoise / niche by name (informational — not auto-excluded):");
for (const [label, re] of noise) {
  const n = rows.filter((r) => re.test(r.navn || "")).length;
  console.log(`  ${label.padEnd(22)} ${n}`);
}

// Email domain breakdown — top 15
const emailDomains = new Map();
for (const r of rows) {
  if (!r.epostadresse) continue;
  const m = r.epostadresse.toLowerCase().match(/@([^\s>]+)/);
  if (m) emailDomains.set(m[1], (emailDomains.get(m[1]) || 0) + 1);
}
const topDomains = [...emailDomains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log("\nTop 15 email domains:");
for (const [d, n] of topDomains) console.log(`  ${d.padEnd(40)} ${n}`);

// How many distinct domains in total
console.log(`\nDistinct email domains: ${emailDomains.size}`);

// Org form
const orgForms = new Map();
for (const r of rows) {
  const f = r.organisasjonsform?.kode || "(unknown)";
  orgForms.set(f, (orgForms.get(f) || 0) + 1);
}
console.log("\nOrg form breakdown:");
for (const [f, n] of [...orgForms.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(8)} ${n}`);
}
