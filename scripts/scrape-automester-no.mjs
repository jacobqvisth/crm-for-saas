// Scrape AutoMester NO per-branch pages. Sitemap → branch URLs (root slugs).
// Sitemap: https://www.automester.no/sitemap.xml (~158 URLs, ~140 are branches)
// Pattern: /{name-slugified}/

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const SITEMAP_URL = "https://www.automester.no/sitemap.xml";
const OUT = join(DATA_DIR, "no-chains-automester.json");

// Top-level paths that are NOT branches (service/info pages, observed in sitemap)
const NON_BRANCH_PREFIXES = [
  "tjenester-produkter", "nyheter", "om-oss", "kontakt",
  "brukervilkar", "personvern", "cookies", "sok-verksted",
  "bestill-time-finn-verksted", "elbil", "bilservice", "bli-medlem",
  "bli-automester", "finn-verksted",
];

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

console.log(`Fetching sitemap: ${SITEMAP_URL}`);
const sitemapXml = await fetchText(SITEMAP_URL);
let urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  .filter((u) => {
    try {
      const p = new URL(u).pathname.split("/").filter(Boolean);
      if (p.length !== 1) return false;
      return !NON_BRANCH_PREFIXES.includes(p[0]);
    } catch { return false; }
  });
console.log(`Found ${urls.length} branch URLs.`);
if (LIMIT) { urls = urls.slice(0, LIMIT); console.log(`Limit ${urls.length}.`); }

const parseBranch = (html, url) => {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || null;
  const phoneRaw = $('a[href^="tel:"]').first().attr("href") || null;
  const phone = phoneRaw ? phoneRaw.replace(/^tel:/, "").trim() : null;
  const emailRaw = $('a[href^="mailto:"]').first().attr("href") || null;
  let email = emailRaw ? emailRaw.replace(/^mailto:/, "").trim().toLowerCase() : null;

  // Fallback regex if no mailto link
  if (!email) {
    const text = $("body").text();
    const m = text.match(/[\w.-]+@[\w-]+\.[a-zA-Z]{2,6}/);
    if (m && !/automester\.no$/i.test(m[0])) email = m[0].toLowerCase();
  }

  let website = null;
  $("a[href^='http']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (/automester\.no|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|youtube\.com|maps\.google|google\.com|wa\.me|whatsapp|tiktok\.com|pinterest\.com|spotify\.com|apple\.com/i.test(href)) return;
    if (!website) website = href;
  });

  const bodyText = $("body").text();
  const addrMatch = bodyText.match(/([^\n,]+?)\s*,?\s*(\d{4})\s+([A-ZÆØÅ][\wÆØÅæøå -]+)/);
  let address = addrMatch ? addrMatch[1].trim() : null;
  let postal_code = addrMatch ? addrMatch[2] : null;
  let city = addrMatch ? addrMatch[3].trim() : null;

  return {
    chain: "automester", source_url: url, name, address, postal_code, city,
    phone, email, website, scraped_at: new Date().toISOString(),
  };
};

console.log(`\nScraping branch pages...`);
const results = await concurrentMap(urls, CONCURRENCY, async (url) => {
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
