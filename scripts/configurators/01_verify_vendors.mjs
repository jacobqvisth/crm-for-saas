#!/usr/bin/env node
// Phase A — prove every seeded configurator vendor exists, and find where each one
// lists its customers.
//
// The vendor list is the discovery vector for the whole prospect list, so a vendor
// that is wrong costs far more than one row: it costs every reference behind it. Each
// domain is therefore fetched, its title recorded, and its own sitemap and navigation
// searched for the page where it publishes references.
//
// Reference pages have no standard name. Across this list they are /customers,
// /cases, /case-studies, /referenzen, /referenties, /klanten, /kunder, /kunden,
// /success-stories, /portfolio and /showcase, in six languages. So the discovery is
// a vocabulary match over links the site itself publishes rather than a guess at a
// path, which is what kept the orgs crawl honest.
//
//   node scripts/configurators/01_verify_vendors.mjs
//
// Writes scripts/configurators/data/verified_vendors.json.

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "../schools/lib_skolverket.mjs";
import { fetchHtml, stripTags, normUrl } from "../schools/lib_scrape.mjs";

const DATA = path.join(import.meta.dirname, "data");
const seed = JSON.parse(fs.readFileSync(path.join(DATA, "seed_vendors.json"), "utf8")).vendors;

// The words a configurator vendor uses for "here are the companies that bought this".
// Deliberately includes the German, Dutch, Nordic, French and Italian forms: half this
// list does not publish in English.
const REF_WORDS =
  /(customers?|clients?|case[-\s]?stud(y|ies)|cases|success[-\s]?stor|showcase|portfolio|references?|referenzen|referenzkunden|kunden|kundenstimmen|anwender|referenties|klanten|klantcases|kunder|kundcase|kundcases|referanser|asiakkaat|referencer|r[ée]f[ée]rences|clients?[-\s]?cas|casi[-\s]?studio|clienti|referencje|klienci|z[aá]kazn[ií]ci|examples|our[-\s]?work|projects?)/i;

// Pages that match the vocabulary but never carry a reference list.
const REF_REJECT =
  /(\/blog\/|\/news\/|\/careers?\/|\/jobs?\/|\/pricing|\/contact|\/privacy|\/terms|\/cookie|\/legal|\/imprint|\/impressum|\.pdf$|\.jpg$|\.png$|\/wp-content\/|\/tag\/|\/author\/|\/category\/|\/feed|\/login|\/support)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? stripTags(m[1]).replace(/\s+/g, " ").trim().slice(0, 140) : null;
}

// Retry before believing a failure. The orgs crawl learned this the expensive way:
// at concurrency 6 with no retry it declared four live domains dead, and all four
// answered 200 a second later.
async function fetchRetry(url, attempts = 3) {
  let res = { ok: false, status: "unattempted", html: "", url };
  for (let i = 0; i < attempts; i++) {
    res = await fetchHtml(url, { timeout: 25000 });
    if (res.ok) return res;
    // A 403 is a live site refusing a robot, not a dead one. Retrying does not help
    // and hammering it is rude, so stop and record it as blocked.
    if (String(res.status) === "403") return res;
    await sleep(1500 * (i + 1));
  }
  return res;
}

function linksFrom(html, base) {
  const out = new Map();
  const re = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = normUrl(m[1], base);
    if (!href) continue;
    const text = stripTags(m[2]).replace(/\s+/g, " ").trim();
    if (!out.has(href)) out.set(href, text);
  }
  return out;
}

// Sitemaps are the reliable half of this: a vendor that hides its case studies behind
// a JS-rendered menu still lists every one of them in sitemap.xml.
async function sitemapUrls(origin, depth = 0) {
  if (depth > 1) return [];
  const res = await fetchHtml(`${origin}/sitemap.xml`, { timeout: 20000 });
  if (!res.ok) return [];
  const locs = [...res.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  // A sitemap index points at more sitemaps. Follow one level, no further.
  const nested = locs.filter((u) => /\.xml($|\?)/i.test(u)).slice(0, 6);
  const pages = locs.filter((u) => !/\.xml($|\?)/i.test(u));
  for (const n of nested) {
    const sub = await fetchHtml(n, { timeout: 20000 });
    if (sub.ok) pages.push(...[...sub.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]));
  }
  return pages;
}

console.log(`Verifying ${seed.length} configurator vendors...`);
let done = 0;

const rows = await mapPool(seed, 4, async (v) => {
  const res = await fetchRetry(v.website);
  const blocked = String(res.status) === "403";
  const out = {
    ...v,
    verified: res.ok,
    blocked,
    http_status: String(res.status),
    resolved_website: res.ok ? res.url : null,
    page_title: res.ok ? titleOf(res.html) : null,
    reference_pages: [],
  };

  if (res.ok) {
    const origin = new URL(res.url).origin;
    const candidates = new Map();

    for (const [href, text] of linksFrom(res.html, res.url)) {
      if (!href.startsWith(origin)) continue;
      if (REF_REJECT.test(href)) continue;
      const p = href.slice(origin.length);
      if (REF_WORDS.test(p) || (text && text.length < 40 && REF_WORDS.test(text))) {
        candidates.set(href.replace(/#.*$/, ""), text);
      }
    }

    for (const u of await sitemapUrls(origin)) {
      if (!u.startsWith(origin) || REF_REJECT.test(u)) continue;
      if (REF_WORDS.test(u.slice(origin.length))) candidates.set(u.replace(/#.*$/, ""), "(sitemap)");
    }

    // Shortest paths first: /customers is an index, /customers/acme-gmbh is one entry,
    // and the index is where a list of many companies lives.
    out.reference_pages = [...candidates.keys()]
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
      .slice(0, 120);
  }

  if (++done % 10 === 0) console.log(`  ${done}/${seed.length}`);
  return out;
});

fs.writeFileSync(
  path.join(DATA, "verified_vendors.json"),
  JSON.stringify({ checked_at: new Date().toISOString(), count: rows.length, vendors: rows }, null, 2),
);

const ok = rows.filter((r) => r.verified || r.blocked);
const bad = rows.filter((r) => !r.verified && !r.blocked);
console.log(`\n${ok.length}/${rows.length} usable (${rows.filter((r) => r.blocked).length} blocked but real)`);
console.log(`reference pages found: ${rows.reduce((n, r) => n + r.reference_pages.length, 0)}`);
console.log(`vendors with no reference page: ${ok.filter((r) => !r.reference_pages.length).map((r) => r.name).join(", ") || "none"}`);

if (bad.length) {
  console.log(`\nDID NOT RESOLVE (${bad.length}) — fix or drop:`);
  for (const b of bad) console.log(`  ${String(b.http_status).padEnd(16)} ${b.hq_code}  ${b.name}  ${b.website}`);
}

console.log("\nTitles to eyeball (title does not mention the vendor):");
for (const r of ok) {
  const t = (r.page_title ?? "").toLowerCase();
  const n = r.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3);
  if (!n.some((w) => t.includes(w))) console.log(`  ${r.hq_code} ${r.name.padEnd(20)} -> ${r.page_title ?? "(no title)"}`);
}
