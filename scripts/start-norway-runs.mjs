// Kick off Apify Google Maps Scraper runs for Norway.
//
// Grid: 12 cells (8 city + 4 regional fringe)
// Search terms: 6 Norwegian workshop terms (bilverksted, bilmekaniker, dekkverksted,
//   karosseriverksted, billakkering, elbilverksted)
// Total runs: 72, all async.
//
// Output: scripts/no-runs.json — read by poll-norway-runs.mjs + import-norway-shops.mjs.
//
// Usage:
//   node scripts/start-norway-runs.mjs
//   node scripts/start-norway-runs.mjs --force    # overwrite existing
//   node scripts/start-norway-runs.mjs --dry-run  # don't actually launch, just print

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
// .env.local lookup: main checkout / worktree
for (const p of [
  join(__dirname, "../.env.local"),
  join(__dirname, "../../../../.env.local"),
]) { if (!dotenv.config({ path: p }).error) break; }

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) { console.error("Missing APIFY_TOKEN"); process.exit(1); }

const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");
const RUNS_PATH = join(__dirname, "no-runs.json");
if (existsSync(RUNS_PATH) && !FORCE && !DRY_RUN) {
  const existing = JSON.parse(readFileSync(RUNS_PATH, "utf8"));
  if (existing.length) {
    console.error(`Refusing to overwrite ${RUNS_PATH} (${existing.length} runs). Pass --force.`);
    process.exit(1);
  }
}

// 8 city cells (radius matches NO scrape plan) + 4 regional fringe.
// Lat/lng from scrape-plan-NO.md Section B.
const CELLS = [
  // City cells
  { label: "Oslo",                    lat: 59.9139, lng: 10.7522, radiusKm: 20 },
  { label: "Bergen",                  lat: 60.3913, lng: 5.3221,  radiusKm: 15 },
  { label: "Stavanger/Sandnes",       lat: 58.9700, lng: 5.7331,  radiusKm: 15 },
  { label: "Trondheim",               lat: 63.4305, lng: 10.3951, radiusKm: 12 },
  { label: "Drammen",                 lat: 59.7440, lng: 10.2045, radiusKm: 10 },
  { label: "Fredrikstad/Sarpsborg",   lat: 59.2181, lng: 10.9298, radiusKm: 12 },
  { label: "Kristiansand",            lat: 58.1467, lng: 7.9956,  radiusKm: 10 },
  { label: "Tromsø",                  lat: 69.6492, lng: 18.9553, radiusKm: 10 },
  // Regional fringe (capture rural/long-tail outside the 8 metros)
  { label: "Sør-Norge fringe",        lat: 59.0,    lng: 8.5,     radiusKm: 200 },
  { label: "Vestlandet fringe",       lat: 61.5,    lng: 6.0,     radiusKm: 200 },
  { label: "Midt-Norge fringe",       lat: 64.5,    lng: 11.0,    radiusKm: 250 },
  { label: "Nord-Norge fringe",       lat: 68.5,    lng: 17.5,    radiusKm: 400 },
];

const TERMS = [
  "bilverksted",
  "bilmekaniker",
  "dekkverksted",
  "karosseriverksted",
  "billakkering",
  "elbilverksted",
];

const ACTOR_ID = "compass~crawler-google-places";
const RUN_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`;

const buildInput = (cell, term) => ({
  searchStringsArray: [term],
  countryCode: "no",
  customGeolocation: {
    type: "Point",
    coordinates: [cell.lng, cell.lat],
    radiusKm: cell.radiusKm,
  },
  maxCrawledPlacesPerSearch: 500,
  scrapeContacts: true,
  scrapePlaceDetailPage: true,
  includeOpeningHours: true,
  skipClosedPlaces: false,
  language: "en",
  includeHistogram: false,
  maxImages: 0,
  maxReviews: 0,
});

const records = [];
for (const cell of CELLS) {
  for (const term of TERMS) {
    records.push({
      label: `${cell.label} — ${term}`,
      cell: cell.label, term,
      lat: cell.lat, lng: cell.lng, radiusKm: cell.radiusKm,
      input: buildInput(cell, term),
      runId: null, datasetId: null, status: null, startedAt: null,
    });
  }
}

console.log(`Total runs to kick off: ${records.length}`);
console.log(`Estimated max-cap places: ${records.length * 500} (most far below)`);
console.log(`Estimated cost: ~$${(records.length * 500 * 0.007).toFixed(0)} max, realistic ~$50`);

if (DRY_RUN) {
  console.log("\nDRY-RUN — not launching. First 3 records:");
  for (const r of records.slice(0, 3)) console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

console.log();
let started = 0, failed = 0;
for (const r of records) {
  try {
    const resp = await fetch(RUN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r.input),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error(`  ${r.label}: ${resp.status} — ${txt.slice(0, 200)}`);
      r.status = "KICKOFF_FAILED";
      failed++;
      continue;
    }
    const data = await resp.json();
    const run = data.data;
    r.runId = run.id;
    r.datasetId = run.defaultDatasetId;
    r.status = run.status;
    r.startedAt = run.startedAt;
    started++;
    process.stdout.write(`\r  started ${started}/${records.length}  (last: ${r.label})  `);
  } catch (e) {
    console.error(`\n  ${r.label}: ${e.message}`);
    r.status = "KICKOFF_ERROR";
    failed++;
  }
}
console.log();

writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2));
console.log(`\nStarted: ${started}, failed: ${failed}, saved to ${RUNS_PATH}`);
console.log(`Next: node scripts/poll-norway-runs.mjs`);
