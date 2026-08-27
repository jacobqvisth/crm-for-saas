/**
 * Emit the fault-code landing pages as a data file for the marketing site.
 *
 *   npx tsx --env-file=.env.local scripts/emit-fault-code-pages.mts [outfile]
 *
 * Reads the same diagnostics the DTC Codes dashboard reads, builds the landing
 * plan, renders every buildable code and family hub into one JSON bundle, and
 * refuses to write it if the bundle fails its own validation.
 *
 * The refusal matters more than it looks. The one rule the whole programme
 * rests on is that a manufacturer-specific code never gets a page of its own,
 * and the validator checks that at the last point before anything reaches disk.
 * A generator that silently emitted a bad bundle would put a confident wrong
 * answer on a few hundred indexed pages, which is the failure mode this design
 * exists to prevent.
 *
 * Rerunnable and deterministic: the output is a pure function of the diagnostics
 * plus the dictionary, so regenerating after a data refresh is the intended way
 * to keep the cluster current rather than a migration.
 */

import { writeFile } from "node:fs/promises";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { analyseDtcCodes } from "@/lib/ceo/dtc/analyse";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";
import { buildFaultCodeBundle, validateBundle } from "@/lib/landing/emit";
import { buildLandingPlan } from "@/lib/landing/plan";

const outfile = process.argv[2] ?? "fault-codes.json";

const diagnostics = await getDiagnosticsDrilldownList({
  range: resolveDashboardTimeRange("all_time"),
  includeInternal: false,
});

const analysis = analyseDtcCodes(diagnostics);
const plan = buildLandingPlan(analysis);

// Stamped rather than computed at read time, so a page can say how current its
// evidence is and a stale bundle is visible instead of merely old.
const generatedFor = new Date().toISOString().slice(0, 10);
const bundle = buildFaultCodeBundle(plan, analysis, generatedFor, diagnostics);

const problems = validateBundle(bundle);
if (problems.length > 0) {
  console.error(`Refusing to write. ${problems.length} problem(s):`);
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
  process.exit(1);
}

await writeFile(outfile, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

const byTier = new Map<string, number>();
for (const page of bundle.pages) {
  byTier.set(page.tier, (byTier.get(page.tier) ?? 0) + 1);
}

console.log(`Wrote ${outfile}`);
console.log(`  diagnostics read : ${diagnostics.length}`);
console.log(`  code pages       : ${bundle.pages.length}`);
for (const [tier, count] of [...byTier].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${tier.padEnd(12)} ${count}`);
}
console.log(`  family hubs      : ${bundle.families.length}`);
console.log(`  make hubs        : ${bundle.makes.length}`);
console.log(`  system hubs      : ${bundle.systems.length}`);
console.log(`  URLs per locale  : ${bundle.totals.urls}`);
console.log(`  not built        : ${plan.totals.belowFloor} below the floor, ${plan.totals.excluded} manufacturer-specific`);
