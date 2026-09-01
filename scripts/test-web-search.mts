// Ops script: prove the two web-search enrichment call sites work on each
// provider, against real businesses.
//
// WHY THIS EXISTS
// ---------------
// find-website and find-phone were the last Anthropic-only AI features, because
// Anthropic's server-side web_search does the whole job in one call and Gemini
// cannot. The Gemini path is therefore a different algorithm (ground, then
// extract: see src/lib/ai/grounded.ts), and the thing that can go wrong is
// specific and quiet: Gemini will happily answer a "look this up" question
// WITHOUT searching, producing a confident, fabricated phone number or URL.
//
// A mock cannot catch that. So this runs the real functions against real
// businesses and checks the answers are plausible, per provider.
//
// Usage:
//   npx tsx scripts/test-web-search.mts                 # both providers
//   npx tsx scripts/test-web-search.mts --gemini        # Gemini only
//   npx tsx scripts/test-web-search.mts --website       # website only
//   npx tsx scripts/test-web-search.mts --phone         # phone only
//
// Needs GEMINI_API_KEY and/or ANTHROPIC_API_KEY in the environment. Uses live
// search quota and makes real HTTP requests to the candidate sites.

import { findWebsite } from "../src/lib/enrich/find-website.ts";
import { findPhones } from "../src/lib/enrich/find-phone.ts";

const args = process.argv.slice(2);
const GEMINI_ONLY = args.includes("--gemini");
const WEBSITE_ONLY = args.includes("--website");
const PHONE_ONLY = args.includes("--phone");

/**
 * The actual shape of a discovered_shops row: a legal or trading name, a town,
 * and a trade. Deliberately not household names, so a correct answer means it
 * searched rather than recalled.
 *
 * An earlier version of this file asserted a second real brand (Bilmetro
 * Uppsala) and both providers "failed" it. They were right and the fixture was
 * wrong: that business was acquired in 2021 and its domain is gone. Pinning
 * expected domains rots, so there is one positive case and one NEGATIVE
 * CONTROL, which is the assertion that actually matters here.
 */
const CASES: Array<{
  label: string;
  input: Parameters<typeof findWebsite>[0];
  /** A plausible answer contains one of these. Omit for a must-not-find case. */
  expectHostContains?: string[];
  /** True when the correct answer is "no site found". */
  expectNotFound?: boolean;
}> = [
  {
    label: "Motorkonsult Nykoping",
    input: {
      name: "Motorkonsult i Nyköping AB",
      city: "Nyköping",
      country: "Sweden",
      category: "auto repair",
    },
    expectHostContains: ["motorkonsult"],
  },
  {
    // NEGATIVE CONTROL. This business does not exist. The Gemini path is two
    // calls (ground, then extract) precisely because Gemini will answer a
    // "look this up" question without searching, and a confident fabricated URL
    // on a real contact row is worse than no answer. If this case ever returns
    // found=true, grounding has stopped being enforced.
    label: "invented workshop (must NOT find)",
    input: {
      name: "Kvarnbergs Turbo & Kaross Specialisten AB",
      city: "Lycksele",
      country: "Sweden",
      category: "auto repair",
    },
    expectNotFound: true,
  },
];

async function runWebsite(providerLabel: string, primary: "anthropic" | "gemini") {
  process.env.AI_PRIMARY_PROVIDER = primary;
  // No cross-cover, so a pass means THIS provider did the work.
  process.env.AI_FALLBACK_DISABLED = "1";

  let passes = 0;
  for (const c of CASES) {
    const started = Date.now();
    const r = await findWebsite(c.input);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const label = c.label.padEnd(32);

    if (c.expectNotFound) {
      const ok = !r.found || !r.website;
      console.log(
        `  ${ok ? "OK  " : "FAIL"} ${label} ${secs}s  ` +
          (ok ? "correctly found nothing" : `FABRICATED ${r.website}`),
      );
      if (ok) passes++;
      else console.log(`       reasoning: ${r.reasoning.slice(0, 110)}`);
      continue;
    }

    if (!r.found || !r.website) {
      console.log(`  MISS ${label} ${secs}s  ${r.reasoning.slice(0, 80)}`);
      continue;
    }

    const host = new URL(r.website).hostname.replace(/^www\./, "");
    const plausible = (c.expectHostContains ?? []).some((frag) => host.includes(frag));
    console.log(
      `  ${plausible ? "OK  " : "??  "} ${label} ${secs}s  ${host}  ` +
        `conf=${r.confidence} src=${r.source}`,
    );
    if (!plausible) console.log(`       reasoning: ${r.reasoning.slice(0, 110)}`);
    if (plausible) passes++;
  }
  console.log(`  ${providerLabel}: ${passes}/${CASES.length}`);
  // The negative control is the one that must never regress: a fabricated URL
  // written onto a real contact row is worse than an empty field. Web search
  // itself is fuzzy, so a positive miss is tolerated and reported, not failed.
  return passes >= 1;
}

const results: Array<{ name: string; ok: boolean }> = [];

if (!PHONE_ONLY) {
  console.log("findWebsite:");
  if (!GEMINI_ONLY && process.env.ANTHROPIC_API_KEY) {
    results.push({ name: "website/anthropic", ok: await runWebsite("anthropic", "anthropic") });
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) {
    results.push({ name: "website/gemini", ok: await runWebsite("gemini", "gemini") });
  }
}

/**
 * findPhones on a real workshop, with no website supplied so the web-search leg
 * is the one that has to do the work (the scrape and Google-Maps legs are
 * skipped or come up empty without a site / Maps key).
 */
async function runPhone(providerLabel: string, primary: "anthropic" | "gemini") {
  process.env.AI_PRIMARY_PROVIDER = primary;
  process.env.AI_FALLBACK_DISABLED = "1";

  const started = Date.now();
  const r = await findPhones({
    companyName: "Motorkonsult i Nyköping AB",
    city: "Nyköping",
    country: "Sweden",
    countryCode: "SE",
    category: "auto repair",
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const fromSearch = r.phones.filter((p) => p.source === "web-search");
  // Every number must be E.164 by the time it leaves the finder: the dialer and
  // the dedupe key both depend on it.
  const malformed = r.phones.filter((p) => !/^\+[1-9]\d{6,14}$/.test(p.number));

  console.log(
    `  ${fromSearch.length > 0 && malformed.length === 0 ? "OK  " : "MISS"} ` +
      `${providerLabel.padEnd(10)} ${secs}s  ${r.phones.length} total, ` +
      `${fromSearch.length} from web-search, turns=${r.debug?.webSearchTurns ?? "?"}`,
  );
  for (const p of r.phones.slice(0, 4)) {
    console.log(`       ${p.number}  ${p.label ?? "-"}  ${p.source}  conf=${p.confidence}`);
  }
  if (malformed.length) console.log(`       MALFORMED: ${malformed.map((p) => p.number).join(", ")}`);
  if (r.debug?.searchError) console.log(`       searchError: ${r.debug.searchError.slice(0, 110)}`);
  if (!r.phones.length) console.log(`       reasoning: ${(r.reasoning ?? "").slice(0, 110)}`);

  return fromSearch.length > 0 && malformed.length === 0;
}

if (!WEBSITE_ONLY) {
  console.log("\nfindPhones:");
  if (!GEMINI_ONLY && process.env.ANTHROPIC_API_KEY) {
    results.push({ name: "phone/anthropic", ok: await runPhone("anthropic", "anthropic") });
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) {
    results.push({ name: "phone/gemini", ok: await runPhone("gemini", "gemini") });
  }
}

if (results.length === 0) {
  console.error("No provider key in the environment, nothing was tested.");
  process.exit(1);
}

console.log("");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
