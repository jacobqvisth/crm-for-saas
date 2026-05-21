// One-shot orchestrator: polls active Apify runs AND retries KICKOFF_FAILED records
// every 30s. Exits when no records are RUNNING/READY and no KICKOFF_FAILED remain.
// Reloads no-runs.json each tick so it picks up records added by retry-pending.
//
// Usage: node scripts/orchestrate-norway-runs.mjs

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

const RUNS_PATH = join(__dirname, "no-runs.json");
const ACTOR_ID = "compass~crawler-google-places";
const RUN_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`;
const TERMINAL = new Set(["SUCCEEDED","FAILED","TIMED-OUT","TIMING-OUT","ABORTED","ABORTING"]);
const POLL_INTERVAL_MS = 30_000;
const RETRY_BATCH = 5; // launch up to N retries per tick

const fetchRun = async (runId) => {
  const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
  if (!r.ok) throw new Error(`Apify ${r.status}`);
  return (await r.json()).data;
};

const startedAt = Date.now();
let tick = 0;
while (true) {
  tick++;
  const records = JSON.parse(readFileSync(RUNS_PATH, "utf8"));

  // 1. Update RUNNING / READY records
  let pollErrors = 0;
  for (const r of records) {
    if (!r.runId) continue;
    if (TERMINAL.has(r.status)) continue;
    try {
      const run = await fetchRun(r.runId);
      r.status = run.status;
      r.finishedAt = run.finishedAt;
      r.stats = run.stats ? {
        runtimeSecs: run.stats.runtimeSecs,
        computeUnits: run.stats.computeUnits,
        datasetItemCount: run.stats.datasetItemCount,
      } : null;
    } catch { pollErrors++; }
  }

  // 2. Tally
  const counts = {};
  let totalItems = 0;
  for (const r of records) {
    counts[r.status || "UNKNOWN"] = (counts[r.status||"UNKNOWN"]||0) + 1;
    if (r.stats?.datasetItemCount) totalItems += r.stats.datasetItemCount;
  }
  const stillActive = records.filter((r) => r.runId && !TERMINAL.has(r.status)).length;
  const pending = records.filter((r) => !r.runId || ["KICKOFF_FAILED","KICKOFF_ERROR"].includes(r.status));
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  console.log(
    `[t${tick} ${elapsed}s] ` +
    Object.entries(counts).map(([s,n]) => `${s}=${n}`).join(" · ") +
    `  ·  items=${totalItems}  ·  active=${stillActive}  ·  pending-retry=${pending.length}`
  );

  // 3. Retry up to RETRY_BATCH pending if memory likely freed (active < ~25)
  let retried = 0;
  if (pending.length > 0 && stillActive < 28) {
    for (const r of pending.slice(0, RETRY_BATCH)) {
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
            console.log(`  memory limit hit at retry ${retried + 1} — backing off`);
            break;
          }
          r.status = "KICKOFF_FAILED";
          continue;
        }
        const data = await resp.json();
        const run = data.data;
        r.runId = run.id;
        r.datasetId = run.defaultDatasetId;
        r.status = run.status;
        r.startedAt = run.startedAt;
        retried++;
      } catch { /* ignore */ }
    }
    if (retried > 0) console.log(`  retried ${retried} (of ${pending.length} pending)`);
  }

  // 4. Persist
  writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2));

  // 5. Exit if nothing left
  const finalActive = records.filter((r) => r.runId && !TERMINAL.has(r.status)).length;
  const finalPending = records.filter((r) => !r.runId || ["KICKOFF_FAILED","KICKOFF_ERROR"].includes(r.status)).length;
  if (finalActive === 0 && finalPending === 0) break;

  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

const records = JSON.parse(readFileSync(RUNS_PATH, "utf8"));
const succeeded = records.filter((r) => r.status === "SUCCEEDED").length;
const failed = records.filter((r) => ["FAILED","TIMED-OUT","ABORTED"].includes(r.status)).length;
const totalItems = records.reduce((s,r) => s + (r.stats?.datasetItemCount||0), 0);
console.log(`\nDone. SUCCEEDED=${succeeded}  failed=${failed}  total items=${totalItems}`);
