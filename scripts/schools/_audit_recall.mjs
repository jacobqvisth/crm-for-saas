// Recall audit: scan the cached 90k-row pool for titles that LOOK vehicle-related on a
// deliberately loose net, but that classify() rejected. Anything real in this list is a
// classifier miss and needs a rule.
import fs from "node:fs";
import path from "node:path";
import { classify, normalise } from "./lib_classify.mjs";

const DATA = path.join(import.meta.dirname, "data");
const pool = JSON.parse(fs.readFileSync(path.join(DATA, "adult_pool.json"), "utf8")).rows;

// Loose net — intentionally over-broad, includes the known false-friend stems.
const LOOSE = /fordon|\bbil|motor|mekanik|verkstad|lacker|däck|hjul|reservdel|chassi|kaross|drivlin|växellåd|diagnos|servicetekn|eftermarknad|automotive|truck|maskin|transport|logistik|förare/;

const misses = new Map();
for (const r of pool) {
  const t = normalise(r.titleSv);
  if (!t || !LOOSE.test(t)) continue;
  if (classify(r.titleSv).tier) continue;
  misses.set(t, (misses.get(t) ?? 0) + 1);
}

console.log(`pool: ${pool.length}, loose-net hits rejected by classify(): ${[...misses.values()].reduce((a, b) => a + b, 0)} rows / ${misses.size} distinct titles\n`);
for (const [t, n] of [...misses].sort((a, b) => b[1] - a[1]).slice(0, 140)) {
  console.log(String(n).padStart(4), t.slice(0, 110));
}
