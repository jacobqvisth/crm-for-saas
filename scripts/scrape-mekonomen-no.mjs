// Scrape Mekonomen NO per-branch pages — TWO-PASS approach.
//
// Pass 1: workshop-locations-sitemap1.xml → ~220 area-aggregator pages
//         (URL pattern /bilverksteder/{kommune}-kommune/{place})
// Pass 2: each area page → extract per-branch <h3><a> links
//         (URL pattern /bilverksteder/{city}/{slug-of-workshop-name})
// Pass 3: each branch page → name + address + phone + email + website
//
// Output: scripts/data/no-chains-mekonomen.json
//
// Usage:
//   node scripts/scrape-mekonomen-no.mjs                    → full
//   node scripts/scrape-mekonomen-no.mjs --limit 5          → first 5 branches
//   node scripts/scrape-mekonomen-no.mjs --concurrency 8    → parallelism (default 5)

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const SITEMAP_URL = "https://www.mekonomen.no/workshop-locations-sitemap1.xml";
const OUT = join(DATA_DIR, "no-chains-mekonomen.json");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const LIMIT = arg("limit") ? parseInt(arg("limit"), 10) : null;
const CONCURRENCY = parseInt(arg("concurrency", "5"), 10);

mkdirSync(DATA_DIR, { recursive: true });

const fetchText = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "wrenchlane-crm-scrape/1.0" },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
};

const concurrentMap = async (items, n, fn) => {
  const queue = [...items];
  const results = [];
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const r = await fn(item);
        if (r) results.push(r);
      } catch (err) {
        console.error(`\n  ${item}: ${err.message}`);
        failed++;
      }
      done++;
      process.stdout.write(`\r  ${done}/${items.length} (failed: ${failed})`);
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
  console.log();
  return results;
};

// PASS 1: sitemap → area URLs
console.log(`Pass 1: fetching sitemap ${SITEMAP_URL}`);
const sitemapXml = await fetchText(SITEMAP_URL);
const areaUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1])
  .filter((u) => {
    const p = new URL(u).pathname.split("/").filter(Boolean);
    return p.length === 3 && p[0] === "bilverksteder" && p[1].endsWith("-kommune");
  });
console.log(`  Found ${areaUrls.length} area pages.`);

// PASS 2: area pages → branch URLs
console.log(`\nPass 2: extracting branch URLs from area pages`);
const branchUrlsArr = await concurrentMap(areaUrls, CONCURRENCY, async (url) => {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const urls = [];
  $("a[href*='/bilverksteder/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const full = new URL(href, "https://www.mekonomen.no").toString();
      const p = new URL(full).pathname.split("/").filter(Boolean);
      // Per-branch is /bilverksteder/{city}/{slug} where city does NOT end in -kommune
      if (p.length === 3 && p[0] === "bilverksteder" && !p[1].endsWith("-kommune")) {
        urls.push(full);
      }
    } catch {}
  });
  return urls;
});
let branchUrls = [...new Set(branchUrlsArr.flat())];
console.log(`  Found ${branchUrls.length} unique branch URLs.`);

if (LIMIT) {
  branchUrls = branchUrls.slice(0, LIMIT);
  console.log(`  Limiting to first ${branchUrls.length} for testing.`);
}

// PASS 3: branch pages → details
console.log(`\nPass 3: scraping branch details`);
const parseBranch = (html, url) => {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || null;
  const phoneRaw = $('a[href^="tel:"]').first().attr("href") || null;
  const phone = phoneRaw ? phoneRaw.replace(/^tel:/, "").trim() : null;
  const emailRaw = $('a[href^="mailto:"]').first().attr("href") || null;
  const email = emailRaw ? emailRaw.replace(/^mailto:/, "").trim().toLowerCase() : null;

  let website = null;
  $("a[href^='http']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (/mekonomen\.no|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|youtube\.com|maps\.google|google\.com|wa\.me|whatsapp|tiktok\.com|pinterest\.com|spotify\.com|apple\.com/i.test(href)) return;
    if (!website) website = href;
  });

  // Address: search for "<street>, <postal> <city>" near the h1.
  const bodyText = $("body").text();
  const addrMatch = bodyText.match(/([^\n,]+?)\s*,\s*(\d{4})\s+([A-ZÆØÅ][\wÆØÅæøå -]+)/);
  const address = addrMatch ? addrMatch[1].trim() : null;
  const postal_code = addrMatch ? addrMatch[2] : null;
  const city = addrMatch ? addrMatch[3].trim() : null;

  return {
    chain: "mekonomen",
    source_url: url,
    name,
    address,
    postal_code,
    city,
    phone,
    email,
    website,
    scraped_at: new Date().toISOString(),
  };
};

const results = await concurrentMap(branchUrls, CONCURRENCY, async (url) => {
  const html = await fetchText(url);
  return parseBranch(html, url);
});

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\nDone. ${results.length} branches saved to ${OUT}`);

const withEmail = results.filter((r) => r.email).length;
const withPhone = results.filter((r) => r.phone).length;
const withWebsite = results.filter((r) => r.website).length;
const withAddress = results.filter((r) => r.address && r.postal_code).length;
const pct = (n) => `${((n / results.length) * 100).toFixed(1)}%`;
console.log(`  with email:   ${withEmail} (${pct(withEmail)})`);
console.log(`  with phone:   ${withPhone} (${pct(withPhone)})`);
console.log(`  with website: ${withWebsite} (${pct(withWebsite)})`);
console.log(`  with address: ${withAddress} (${pct(withAddress)})`);

// Top email domains for sanity
const emailDomains = new Map();
for (const r of results) {
  if (!r.email) continue;
  const d = r.email.match(/@(.+)/)?.[1];
  if (d) emailDomains.set(d, (emailDomains.get(d) || 0) + 1);
}
const topDomains = [...emailDomains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`\nTop email domains:`);
for (const [d, n] of topDomains) console.log(`  ${d.padEnd(35)} ${n}`);
