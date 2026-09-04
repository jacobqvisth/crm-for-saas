#!/usr/bin/env node
// Phase C2 — a second attempt at the configurator link, and a second look at who is
// actually a prospect.
//
// Phase C found a link for 165 of 452 companies. The misses split cleanly in two, and
// each half needs a different fix:
//
// 1. BIG SITES. On festo.com, abb.com, boschrexroth.com and siemens-energy.com the
//    configurator exists but is nowhere near the homepage, so neither the anchor scan
//    nor the 27 probed paths could reach it. Their sitemaps name it. This is the same
//    trick that found the vendors' reference pages in phase A, applied one level down.
//
// 2. SOFTWARE VENDORS WEARING A CUSTOMER'S CLOTHES. Revalize links its own product
//    portfolio from its case pages, so TENADO, Attainia, AutoQuotes, PIPE-FLO, PRO.FILE
//    and SpecPage all arrived as "customers" -- their own page titles say "from
//    Revalize". They sell software; they are not manufacturers with a configurator to
//    upgrade, and sending Animech at them would waste the list's credibility.
//
// Also probes the obvious configurator SUBDOMAINS, because that is where a company that
// took the trouble to build one usually puts it: phase C already found
// driveworkslive.extronics.com and schindlerplan.com that way, but only by accident of
// them being linked.
//
//   node scripts/configurators/03b_refine_prospects.mjs
//
// Rewrites scripts/configurators/data/verified_prospects.json in place.

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "../schools/lib_skolverket.mjs";
import { fetchHtml } from "../schools/lib_scrape.mjs";
import { detectPlatforms, scoreConfiguratorLink, CONFIG_WORDS } from "./lib_configurator.mjs";

const DATA = path.join(import.meta.dirname, "data");
const FILE = path.join(DATA, "verified_prospects.json");
const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const rows = doc.prospects;

// A page title is short and deliberate, so a software claim in one is high-precision in
// a way the same words in body copy are not. "<Product> from <Vendor>" is Revalize's
// house style for its portfolio pages and catches that family exactly.
const SOFTWARE_TITLE =
  /\bfrom (Revalize|Zilliant|Forterro|Cyncly|Epicor|Aptean|Vela)\b|\b(PLM|PDM|CPQ|ERP|MES|CRM|SaaS)\b.*\b(software|platform|solution|suite|system)\b|\b(software|platform) (for|solution|suite)\b|\b(simulation|modeling|modelling) software\b/i;

// Subdomains a company puts its configurator on.
const SUBDOMAINS = [
  "configurator", "konfigurator", "configurateur", "configuratore", "config",
  "planner", "planer", "plan", "3d", "my", "design", "build", "shop", "studio",
];

function sitemapConfigUrls(xml, origin) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  const scored = [];
  for (const u of locs) {
    if (!u.startsWith("http")) continue;
    const p = u.startsWith(origin) ? u.slice(origin.length) : u;
    const score = scoreConfiguratorLink(p, "");
    // Only URL-path hits count here. There is no link text in a sitemap, and
    // scoreConfiguratorLink discounts text-only matches to 60%, which would let a
    // /planner-shaped false positive through unchallenged.
    if (score >= 60 && CONFIG_WORDS.some((re) => re.test(p))) scored.push({ url: u, score });
  }
  // Shortest path first among equals: /konfigurator beats /service/tools/konfigurator/faq.
  return scored.sort((a, b) => b.score - a.score || a.url.length - b.url.length).slice(0, 8);
}

async function sitemapPages(origin) {
  const out = [];
  for (const name of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
    const res = await fetchHtml(origin + name, { timeout: 20000 });
    if (!res.ok) continue;
    out.push(res.html);
    // One level of sitemap index, capped. A big manufacturer publishes dozens of
    // per-language sitemaps and fetching all of them would cost more than the row.
    const nested = [...res.html.matchAll(/<loc>\s*([^<\s]+\.xml)[^<]*<\/loc>/gi)].map((m) => m[1]);
    const pick = nested
      .sort((a, b) => (CONFIG_WORDS.some((r) => r.test(b)) ? 1 : 0) - (CONFIG_WORDS.some((r) => r.test(a)) ? 1 : 0))
      .slice(0, 8);
    for (const n of pick) {
      const sub = await fetchHtml(n, { timeout: 20000 });
      if (sub.ok) out.push(sub.html);
    }
    break;
  }
  return out;
}

const targets = rows.filter((r) => r.verified && !r.is_vendor && !r.configurator_url);
console.log(`Re-checking ${targets.length} companies with no configurator link...`);

let done = 0;
let reclassified = 0;
let found = 0;

// Reclassification is cheap and needs no fetch, so it runs over everything.
for (const r of rows) {
  if (r.is_vendor || !r.verified) continue;
  if (SOFTWARE_TITLE.test(`${r.page_title ?? ""}`)) {
    r.is_vendor = true;
    r.vendor_kind = r.vendor_kind ?? "cpq";
    r.notes = "Reclassified as a software vendor from its own page title, not a manufacturer.";
    reclassified++;
  }
}
console.log(`Reclassified ${reclassified} more as software vendors rather than prospects.`);

await mapPool(targets.filter((r) => !r.is_vendor), 6, async (r) => {
  const origin = new URL(r.resolved_website ?? r.website).origin;

  const candidates = [];
  for (const xml of await sitemapPages(origin)) candidates.push(...sitemapConfigUrls(xml, origin));

  if (!candidates.length) {
    const host = new URL(origin).hostname.replace(/^www\./, "");
    const hits = await mapPool(SUBDOMAINS, 5, async (s) => {
      const res = await fetchHtml(`https://${s}.${host}`, { timeout: 12000 });
      // A parked or wildcard subdomain answers 200 with the main site. Only keep it if
      // the page itself talks like a configurator.
      if (!res.ok || res.html.length < 1500) return null;
      const looks = CONFIG_WORDS.some((re) => re.test(res.url)) || detectPlatforms(res.html).length > 0;
      return looks ? { url: res.url, score: 70 } : null;
    });
    candidates.push(...hits.filter(Boolean));
  }

  for (const cand of candidates.slice(0, 3)) {
    const page = await fetchHtml(cand.url, { timeout: 20000 });
    if (!page.ok) continue;
    r.configurator_url = page.url;
    r.configurator_score = cand.score;
    r.configurator_candidates = [
      ...(r.configurator_candidates ?? []),
      ...candidates.map((c) => ({ url: c.url, text: "(sitemap)", score: c.score })),
    ].slice(0, 8);
    const p = detectPlatforms(page.html);
    if (p.length) { r.platforms = p; r.platform_source = "configurator page"; }
    found++;
    break;
  }

  if (++done % 30 === 0) console.log(`  ${done}/${targets.length}  (+${found} links)`);
});

fs.writeFileSync(FILE, JSON.stringify({ ...doc, refined_at: new Date().toISOString(), prospects: rows }, null, 2));

const live = rows.filter((r) => r.verified || r.blocked);
const prospects = live.filter((r) => !r.is_vendor);
console.log(`\n+${found} configurator links from sitemaps and subdomains`);
console.log(`${prospects.filter((r) => r.configurator_url).length}/${prospects.length} prospects now have a configurator URL`);
console.log(`${prospects.filter((r) => r.platform_source === "configurator page").length} platforms confirmed from the configurator page itself`);
console.log(`${live.length - prospects.length} entries are vendors, not prospects`);
