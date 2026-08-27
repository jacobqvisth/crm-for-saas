/**
 * Emit the flagship fault-code pages as Webflow CMS item payloads.
 *
 *   npx tsx --env-file=.env.local scripts/emit-webflow-flagship.mts [outfile]
 *
 * The flagship tier only. The point of the Webflow batch is to find out whether
 * the live domain indexes these pages at all, months before the Astro cluster
 * can ship at the DNS cutover. A small batch answers that; a large one would
 * just be the same question asked more expensively, on a CMS that is the wrong
 * shape for several hundred items.
 */

import { writeFile } from "node:fs/promises";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { analyseDtcCodes } from "@/lib/ceo/dtc/analyse";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";
import { buildFaultCodeBundle, validateBundle } from "@/lib/landing/emit";
import { buildLandingPlan } from "@/lib/landing/plan";
import { webflowItemFor } from "@/lib/landing/webflow-body";

const outfile = process.argv[2] ?? "webflow-flagship.json";

const diagnostics = await getDiagnosticsDrilldownList({
  range: resolveDashboardTimeRange("all_time"),
  includeInternal: false,
});
const analysis = analyseDtcCodes(diagnostics);
const generatedFor = new Date().toISOString().slice(0, 10);
const bundle = buildFaultCodeBundle(
  buildLandingPlan(analysis),
  analysis,
  generatedFor,
);

const problems = validateBundle(bundle);
if (problems.length > 0) {
  console.error(`Refusing to emit. ${problems.length} problem(s).`);
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
  process.exit(1);
}

const flagship = bundle.pages.filter((page) => page.tier === "flagship");
// Only these eight exist on the target site, so only these may be linked.
const published = new Set(flagship.map((page) => page.slug));
const items = flagship.map((page) =>
  webflowItemFor(page, generatedFor, published),
);

await writeFile(outfile, `${JSON.stringify(items, null, 2)}\n`, "utf8");
console.log(`Wrote ${outfile}: ${items.length} flagship items`);
for (const item of items) {
  console.log(`  ${item.code}  ${item.slug}  body ${item.body.length} chars`);
}
