// Scrape BilXtra NO per-branch pages — 3-pass enumeration.
//
// BilXtra's sitemap.xml is unreliable (timeouts), but the public listing page enumerates
// cities, and each city page lists per-branch links.
//
// Pass 1: https://www.bilxtra.no/bilxtraverksted/bilverksted → ~126 city links
// Pass 2: each city page → per-branch links
// Pass 3: each branch page → details

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const LISTING_URL = "https://www.bilxtra.no/bilxtraverksted/bilverksted";
const OUT = join(DATA_DIR, "no-chains-bilxtra.json");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const LIMIT = arg("limit") ? parseInt(arg("limit"), 10) : null;
const CONCURRENCY = parseInt(arg("concurrency", "6"), 10);

mkdirSync(DATA_DIR, { recursive: true });

const fetchText = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 wrenchlane-crm-scrape/1.0" },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
};

const concurrentMap = async (items, n, fn) => {
  const queue = [...items];
  const results = [];
  let done = 0, failed = 0;
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

// PASS 1: top listing → city URLs
console.log(`Pass 1: ${LISTING_URL}`);
const listingHtml = await fetchText(LISTING_URL);
const $1 = cheerio.load(listingHtml);
const cityUrls = new Set();
$1("a[href*='/bilxtraverksted/bilverksted/']").each((_, el) => {
  const href = $1(el).attr("href");
  if (!href) return;
  try {
    const full = new URL(href, "https://www.bilxtra.no").toString();
    const p = new URL(full).pathname.split("/").filter(Boolean);
    // /bilxtraverksted/bilverksted/{city} = 3 segments
    if (p.length === 3) cityUrls.add(full);
  } catch {}
});
console.log(`  Found ${cityUrls.size} city URLs.`);

// PASS 2: each city → branch URLs
console.log(`\nPass 2: city → branch URLs`);
const branchUrlsArr = await concurrentMap([...cityUrls], CONCURRENCY, async (url) => {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const urls = [];
  $("a[href*='/bilxtraverksted/bilverksted/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const full = new URL(href, "https://www.bilxtra.no").toString();
      const p = new URL(full).pathname.split("/").filter(Boolean);
      if (p.length === 4) urls.push(full);
    } catch {}
  });
  return urls;
});
let branchUrls = [...new Set(branchUrlsArr.flat())];
console.log(`  Found ${branchUrls.length} unique branch URLs.`);
if (LIMIT) { branchUrls = branchUrls.slice(0, LIMIT); console.log(`  Limit ${branchUrls.length}.`); }

// PASS 3: branch detail
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
    if (/bilxtra\.no|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|youtube\.com|maps\.google|google\.com|wa\.me|whatsapp|tiktok\.com|pinterest\.com|spotify\.com|apple\.com/i.test(href)) return;
    if (!website) website = href;
  });

  const bodyText = $("body").text();
  const addrMatch = bodyText.match(/([^\n,]+?)\s*,\s*(\d{4})\s+([A-ZÆØÅ][\wÆØÅæøå -]+)/);
  let address = addrMatch ? addrMatch[1].trim() : null;
  let postal_code = addrMatch ? addrMatch[2] : null;
  let city = addrMatch ? addrMatch[3].trim() : null;

  // Fallback: derive city from URL slug — pattern /bilxtraverksted/bilverksted/{city}/{slug}
  if (!city) {
    try {
      const p = new URL(url).pathname.split("/").filter(Boolean);
      if (p.length === 4) {
        // Title-case the slug, replace dashes with spaces
        city = p[2].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
    } catch {}
  }

  return {
    chain: "bilxtra", source_url: url, name, address, postal_code, city,
    phone, email, website, scraped_at: new Date().toISOString(),
  };
};

console.log(`\nPass 3: scraping branch pages`);
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
console.log(`  email: ${withEmail} (${pct(withEmail)}) | phone: ${withPhone} (${pct(withPhone)}) | website: ${withWebsite} (${pct(withWebsite)}) | addr: ${withAddress} (${pct(withAddress)})`);
