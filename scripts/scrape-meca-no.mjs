// Scrape MECA NO per-branch pages. Sitemap → branch pages (one pass).
// Sitemap: https://meca.no/workshops-sitemap1.xml (~500 URLs)
// Pattern: /bilverksted/{city}/{slug}
//
// Output: scripts/data/no-chains-meca.json

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const SITEMAP_URL = "https://www.meca.no/workshops-sitemap1.xml";
const OUT = join(DATA_DIR, "no-chains-meca.json");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const LIMIT = arg("limit") ? parseInt(arg("limit"), 10) : null;
const CONCURRENCY = parseInt(arg("concurrency", "8"), 10);

mkdirSync(DATA_DIR, { recursive: true });

const fetchText = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "wrenchlane-crm-scrape/1.0" } });
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
let urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
// Only per-branch paths: /bilverksted/{city}/{slug} (3 segments). Skip city aggregators (2).
urls = urls.filter((u) => {
  try {
    const p = new URL(u).pathname.split("/").filter(Boolean);
    return p.length === 3 && p[0] === "bilverksted";
  } catch { return false; }
});
console.log(`Found ${urls.length} branch URLs.`);

if (LIMIT) { urls = urls.slice(0, LIMIT); console.log(`Limit ${urls.length}.`); }

const parseBranch = (html, url) => {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || null;
  const phoneRaw = $('a[href^="tel:"]').first().attr("href") || null;
  const phone = phoneRaw ? phoneRaw.replace(/^tel:/, "").replace(/"[^"]*"$/, "").trim() : null;
  const emailRaw = $('a[href^="mailto:"]').first().attr("href") || null;
  const email = emailRaw ? emailRaw.replace(/^mailto:/, "").replace(/"[^"]*"$/, "").trim().toLowerCase() : null;

  let website = null;
  $("a[href^='http']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (/meca\.no|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|youtube\.com|maps\.google|google\.com|wa\.me|whatsapp|tiktok\.com|pinterest\.com|spotify\.com|apple\.com/i.test(href)) return;
    if (!website) website = href;
  });

  const bodyText = $("body").text();
  const addrMatch = bodyText.match(/([^\n,]+?)\s*,\s*(\d{4})\s+([A-ZÆØÅ][\wÆØÅæøå -]+)/);
  const address = addrMatch ? addrMatch[1].trim() : null;
  const postal_code = addrMatch ? addrMatch[2] : null;
  const city = addrMatch ? addrMatch[3].trim() : null;

  return {
    chain: "meca", source_url: url, name, address, postal_code, city,
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
console.log(`  with email:   ${withEmail} (${pct(withEmail)})`);
console.log(`  with phone:   ${withPhone} (${pct(withPhone)})`);
console.log(`  with website: ${withWebsite} (${pct(withWebsite)})`);
console.log(`  with address: ${withAddress} (${pct(withAddress)})`);
