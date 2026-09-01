// Ops script: prove src/lib/articles/generate.ts can write a publishable draft
// on EACH provider, from a real-shaped diagnostic.
//
// WHY THIS EXISTS
// ---------------
// The Articles Autopilot publishes unattended, so the generator is the one AI
// call site where a provider problem turns into either silence or a bad page on
// wrenchlane.com. It is also the hardest call in the codebase to serve: a cached
// multi-block system prompt, a 16k output budget, and a deep Zod schema (hooks,
// claims with provenance, SEO). A generic provider test passing says nothing
// about whether THIS schema survives the round trip.
//
// So this runs the real generateArticle() against each provider in turn and
// checks the parts that have to be right before anything is published: a
// non-empty body, hooks, and claims that carry a provenance tag.
//
// Usage:
//   npx tsx scripts/test-article-generator.mts              # both providers
//   npx tsx scripts/test-article-generator.mts --gemini     # Gemini only
//
// Needs GEMINI_API_KEY and/or ANTHROPIC_API_KEY in the environment. To use
// .env.local:
//   GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env.local | cut -d= -f2-) \
//     npx tsx scripts/test-article-generator.mts --gemini

import { generateArticle } from "../src/lib/articles/generate.ts";
import { DEFAULT_ARTICLE_OPTIONS } from "../src/lib/articles/generation-options.ts";
import { EMPTY_IMPACT, type ArticleDiagnosticSnapshot } from "../src/lib/articles/types.ts";

const GEMINI_ONLY = process.argv.includes("--gemini");

/**
 * A realistic diagnostic: the Autopilot's well only serves rows with a described
 * problem, >=2 ranked causes and >=1 DTC, so the fixture matches that bar.
 */
const diagnostic: ArticleDiagnosticSnapshot = {
  diagnosticId: "test-fixture-0001",
  carMake: "Volvo",
  carModel: "V60",
  carYear: 2017,
  mileage: 148000,
  description:
    "Owner reports the engine stumbling under load when cold, worse in damp weather, and a flashing engine light on a motorway slip road. Cleared once and it came back within two days.",
  dtcs: ["P0301", "P0302", "P0171"],
  symptoms: ["rough idle when cold", "hesitation under load", "flashing engine light"],
  country: "SE",
  causes: [
    {
      name: "Failing ignition coil on cylinder 1",
      probability: 0.62,
      severity: "high",
      description: "Misfire codes concentrated on adjacent cylinders with a lean bank-1 trim.",
      suggestedTests: ["Swap coil 1 and 2 and see if the misfire follows", "Check secondary resistance"],
    },
    {
      name: "Vacuum leak on the intake manifold gasket",
      probability: 0.24,
      severity: "medium",
      description: "Lean trim on bank 1 with cold-start dependence points at a leak that seals as it warms.",
      suggestedTests: ["Smoke test the intake", "Read short-term fuel trim at idle vs 2500 rpm"],
    },
    {
      name: "Fouled spark plugs",
      probability: 0.14,
      severity: "low",
      description: "Consistent with mileage if plugs are past their interval.",
      suggestedTests: ["Pull and inspect plugs 1 and 2"],
    },
  ],
  createdAt: "2026-08-28T09:14:00.000Z",
};

async function run(label: string, primary: "anthropic" | "gemini") {
  process.env.AI_PRIMARY_PROVIDER = primary;
  // No cross-cover: a pass has to mean THIS provider served it.
  process.env.AI_FALLBACK_DISABLED = "1";

  const started = Date.now();
  const result = await generateArticle({
    format: "linkedin_post",
    options: { ...DEFAULT_ARTICLE_OPTIONS, language: "en" },
    impact: EMPTY_IMPACT,
    diagnostic,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    console.log(`FAIL  ${label.padEnd(10)} kind=${result.kind} ${result.reason.slice(0, 160)}`);
    return false;
  }

  const a = result.article;
  const problems: string[] = [];
  if (!a.body.trim()) problems.push("empty body");
  if (a.hooks.length === 0) problems.push("no hooks");
  if (a.claims.length === 0) problems.push("no claims");
  if (a.claims.some((c) => !c.source)) problems.push("a claim has no provenance");
  // The long-dash rule is enforced by a post-processor, so a survivor here means
  // the repair is not running on every field.
  if (/[–—]/.test(a.body + a.hooks.join(" "))) problems.push("a long dash survived");

  if (problems.length) {
    console.log(`FAIL  ${label.padEnd(10)} ${problems.join("; ")}`);
    return false;
  }

  console.log(
    `OK    ${label.padEnd(10)} ${secs}s  model=${a.model}${a.usedFallbackModel ? " (fallback)" : ""}  ` +
      `${a.body.length} chars, ${a.hooks.length} hooks, ${a.claims.length} claims`,
  );
  console.log(`      hook: ${a.hooks[0].slice(0, 110)}`);
  console.log(`      seo : ${a.seo.metaTitle ?? "(none)"}`);
  return true;
}

const results: boolean[] = [];
if (!GEMINI_ONLY && process.env.ANTHROPIC_API_KEY) {
  results.push(await run("anthropic", "anthropic"));
}
if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) {
  results.push(await run("gemini", "gemini"));
}

if (results.length === 0) {
  console.error("No provider key in the environment, nothing was tested.");
  process.exit(1);
}

const allOk = results.every(Boolean);
console.log(`\n${allOk ? "PASS" : "FAIL"}: article generator on ${results.length} provider(s)`);
process.exit(allOk ? 0 : 1);
