#!/usr/bin/env node
// Phase A gate — check that every seeded organisation actually exists.
//
// There is no Skolverket for trade associations. The seed list is assembled from the
// European umbrella bodies' own member directories (CECRA, AECDR, FIGIEFA) plus
// per-country research, which means it carries recall risk: a plausible-looking URL
// may be dead, renamed or simply wrong. So every entry is fetched and the page title
// recorded. An org whose site does not resolve does not get imported.
//
//   node scripts/orgs/01_verify_seed.mjs
//
// Writes scripts/orgs/data/verified_orgs.json.

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "../schools/lib_skolverket.mjs";
import { fetchHtml, stripTags } from "../schools/lib_scrape.mjs";

const DATA = path.join(import.meta.dirname, "data");

const seed = [
  ...JSON.parse(fs.readFileSync(path.join(DATA, "seed_orgs.json"), "utf8")),
  ...JSON.parse(fs.readFileSync(path.join(DATA, "seed_events.json"), "utf8")),
];

// Two entries may not share a website: that would mean one of them is wrong, or they
// are the same body under two names.
const byUrl = new Map();
for (const o of seed) {
  const key = o.website.replace(/\/+$/, "").toLowerCase();
  if (byUrl.has(key)) console.warn(`  duplicate website: ${o.name} and ${byUrl.get(key)}`);
  byUrl.set(key, o.name);
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? stripTags(m[1]).replace(/\s+/g, " ").trim().slice(0, 140) : null;
}

console.log(`Verifying ${seed.length} seeded organisations...`);
let done = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = await mapPool(seed, 4, async (o) => {
  // Retry with backoff before believing a failure. At concurrency 6 with no retry,
  // mrf.se, sbrservice.se, akeri.se and me.se all reported dead and every one of them
  // answers 200 when asked again a second later. A verifier that drops real
  // associations on a transient blip is worse than no verifier at all.
  let res = { ok: false, status: "unattempted", html: "", url: o.website };
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetchHtml(o.website, { timeout: 25000 });
    if (res.ok) break;
    await sleep(1500 * (attempt + 1));
  }
  // A bare-domain retry catches the common case of a guessed deep path.
  if (!res.ok) {
    try {
      const root = new URL(o.website).origin;
      if (root !== o.website.replace(/\/+$/, "")) {
        const alt = await fetchHtml(root, { timeout: 25000 });
        if (alt.ok) res = alt;
      }
    } catch { /* keep the original failure */ }
  }
  if (++done % 20 === 0) console.log(`  ${done}/${seed.length}`);
  return {
    ...o,
    verified: res.ok,
    http_status: String(res.status),
    resolved_website: res.ok ? res.url : null,
    page_title: res.ok ? titleOf(res.html) : null,
  };
});

fs.writeFileSync(
  path.join(DATA, "verified_orgs.json"),
  JSON.stringify({ checked_at: new Date().toISOString(), count: rows.length, orgs: rows }, null, 2),
);

const ok = rows.filter((r) => r.verified);
const bad = rows.filter((r) => !r.verified);
console.log(`\n${ok.length}/${rows.length} resolved`);

const byType = {};
for (const r of ok) byType[r.org_type] = (byType[r.org_type] ?? 0) + 1;
console.log("  by type:", byType);
console.log(`  countries: ${new Set(ok.map((r) => r.country)).size}`);

if (bad.length) {
  console.log(`\nDID NOT RESOLVE (${bad.length}) — fix or drop these:`);
  for (const b of bad) console.log(`  ${String(b.http_status).padEnd(14)} ${b.country_code}  ${b.name}  ${b.website}`);
}

// A title that does not mention the org is worth a human glance: it usually means a
// parked domain, a redirect to an unrelated site, or a wrong guess.
console.log("\nTitles to eyeball (title does not contain the name or acronym):");
for (const r of ok) {
  const t = (r.page_title ?? "").toLowerCase();
  const n = r.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 4);
  const a = (r.acronym ?? "").toLowerCase();
  const hit = n.some((w) => t.includes(w)) || (a.length >= 2 && t.includes(a));
  if (!hit) console.log(`  ${r.country_code} ${r.name.padEnd(42)} -> ${r.page_title ?? "(no title)"}`);
}
