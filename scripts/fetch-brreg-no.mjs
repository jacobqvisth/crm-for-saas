// Pull all Norwegian motor-vehicle-repair establishments (underenheter, code 95.310)
// from the Brønnøysund Register and write them to scripts/data/brreg-95310-<date>.json.
//
// Public API, no auth. Expected count as of 2026-05-21: ~6,826 underenheter.
//
// Usage:
//   node scripts/fetch-brreg-no.mjs
//   node scripts/fetch-brreg-no.mjs --size 500           # smaller pages (default 1000)
//   node scripts/fetch-brreg-no.mjs --code 95.310        # override naeringskode (default 95.310)
//   node scripts/fetch-brreg-no.mjs --out path.json      # override output path

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const CODE = arg("code", "95.310");
const SIZE = parseInt(arg("size", "1000"), 10);
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = arg("out", join(DATA_DIR, `brreg-${CODE.replace(".", "")}-${TODAY}.json`));

const BASE = "https://data.brreg.no/enhetsregisteret/api/underenheter";

mkdirSync(DATA_DIR, { recursive: true });

console.log(`Fetching brreg underenheter, naeringskode=${CODE}, size=${SIZE}/page`);
console.log(`Output: ${OUT}\n`);

const all = [];
let page = 0;
let totalPages = null;
let totalElements = null;

while (true) {
  const url = `${BASE}?naeringskode=${encodeURIComponent(CODE)}&size=${SIZE}&page=${page}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "wrenchlane-crm-scrape/1.0" },
  });
  if (!res.ok) {
    console.error(`Page ${page} failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();

  if (totalElements === null) {
    totalElements = body.page?.totalElements ?? null;
    totalPages = body.page?.totalPages ?? null;
    console.log(`API reports totalElements=${totalElements}, totalPages=${totalPages}`);
  }

  const items = body._embedded?.underenheter ?? [];
  if (items.length === 0) break;
  all.push(...items);
  process.stdout.write(`\r  fetched ${all.length}${totalElements ? ` / ${totalElements}` : ""}`);

  if (totalPages !== null && page + 1 >= totalPages) break;
  page++;
}

console.log("\n");
console.log(`Done. Total rows: ${all.length}`);

writeFileSync(OUT, JSON.stringify(all, null, 2));
console.log(`Written to ${OUT}`);
