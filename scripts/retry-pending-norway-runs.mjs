// Re-kick records in no-runs.json that have status=KICKOFF_FAILED (likely due to
// Apify account memory limit). Designed to be looped — run, poll until some active
// runs finish, run again, etc.
//
// Usage: node scripts/retry-pending-norway-runs.mjs [--max N]

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const p of [join(__dirname, "../.env.local"), join(__dirname, "../../../../.env.local")]) {
  if (!dotenv.config({ path: p }).error) break;
}
const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) { console.error("Missing APIFY_TOKEN"); process.exit(1); }

const MAX_ARG = process.argv.indexOf("--max");
const MAX = MAX_ARG > -1 ? parseInt(process.argv[MAX_ARG + 1], 10) : Infinity;

const RUNS_PATH = join(__dirname, "no-runs.json");
const records = JSON.parse(readFileSync(RUNS_PATH, "utf8"));

const pending = records.filter((r) => !r.runId || ["KICKOFF_FAILED","KICKOFF_ERROR"].includes(r.status));
console.log(`${pending.length} pending records, retrying up to ${MAX === Infinity ? "all" : MAX}.`);

const ACTOR_ID = "compass~crawler-google-places";
const RUN_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`;

let started = 0, stillBlocked = 0, errors = 0;
for (const r of pending) {
  if (started >= MAX) break;
  try {
    const resp = await fetch(RUN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r.input),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      if (txt.includes("actor-memory-limit-exceeded")) {
        r.status = "KICKOFF_FAILED";
        stillBlocked++;
        // Memory limit — bail out, no point trying more right now
        console.log(`  memory limit hit at ${started + stillBlocked} — stopping`);
        break;
      }
      console.error(`  ${r.label}: ${resp.status} — ${txt.slice(0, 200)}`);
      r.status = "KICKOFF_FAILED";
      errors++;
      continue;
    }
    const data = await resp.json();
    const run = data.data;
    r.runId = run.id;
    r.datasetId = run.defaultDatasetId;
    r.status = run.status;
    r.startedAt = run.startedAt;
    started++;
    process.stdout.write(`\r  started ${started}/${Math.min(MAX, pending.length)}  (last: ${r.label})  `);
  } catch (e) {
    console.error(`\n  ${r.label}: ${e.message}`);
    r.status = "KICKOFF_ERROR";
    errors++;
  }
}
console.log();
writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2));
console.log(`\nStarted: ${started}, still-blocked: ${stillBlocked}, errors: ${errors}.`);
