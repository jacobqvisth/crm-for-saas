#!/usr/bin/env node
// Phase 2 — post-gymnasium and adult vehicle education: Yrkeshögskola (YH), komvux
// yrkespaket, nationell yrkesutbildning, arbetsmarknadsutbildning, folkhögskola and
// university programmes.
//
// Recall strategy. The adult endpoint has the same unstable-paging defect as the
// gymnasium one (see lib_skolverket.mjs), so nothing is paged. Instead:
//
//   1. Sweep every (typeOfSchool x kommun) slice. Verified lossless: for `ny` the
//      kommun union reproduced all 78 rows exactly.
//   2. A kommun slice that still overflows the 100-row cap (only the biggest cities
//      do, e.g. yh/Stockholm = 515) is re-fetched partitioned by directionIds. That
//      recovers 512 of 515 -- the 3 stragglers carry no direction tag at all.
//   3. A vehicle-keyword searchTerm net runs across every type, unscoped by kommun,
//      to catch exactly those direction-less rows by their text.
//
// The union of (1)+(2)+(3) is the recall net; `classify()` is the precision filter.
// Writes scripts/schools/data/adult.json.

import fs from "node:fs";
import path from "node:path";
import { API, getJson, mapPool, pickAddress, countyFromAreaCode } from "./lib_skolverket.mjs";
import { classify } from "./lib_classify.mjs";

const DATA = path.join(import.meta.dirname, "data");
const REGIONS = JSON.parse(fs.readFileSync(path.join(DATA, "regions.json"), "utf8"));
const KOMMUNER = Object.keys(REGIONS).filter((k) => k.length === 4).sort();
const AREAS = JSON.parse(fs.readFileSync(path.join(DATA, "areas.json"), "utf8")).body.areas;
const DIRECTIONS = [...new Set(AREAS.flatMap((a) => (a.directions ?? []).map((d) => d.directionId)))];

const BASE = `${API}/adult-education-events`;
const LIST_KEY = "listedAdultEducationEvents";

// Every adult school form that can plausibly carry a vehicle programme. `vuxgy` (the
// 82k individual komvux subject courses) is deliberately excluded as a full sweep --
// it is courses, not programmes. Vehicle-tagged komvux courses still arrive through
// the directionIds and keyword nets below.
const TYPES = {
  yh: "Yrkeshögskoleutbildning",
  ny: "Nationell yrkesutbildning",
  komvuxcoursepackage: "Komvux yrkespaket",
  aub: "Arbetsmarknadsutbildning",
  fhs: "Folkhögskola",
  fhsaub: "Folkhögskola (arbetsmarknadsutbildning)",
  forberutb: "Förberedande utbildning",
  programbasic: "Högskola, program grundnivå",
  programadvanced: "Högskola, program avancerad nivå",
};

// searchTerm matches title and description, which is how direction-less rows get found.
const KEYWORDS = [
  "fordon", "fordonsteknik", "fordonstekniker", "fordonsingenjör", "fordonselektronik",
  "bil", "bilteknik", "bilmekaniker", "bilskada", "bilskadereparatör", "billackerare",
  "mekaniker", "motor", "motorbransch", "karosseri", "lackering", "lackerare",
  "verkstad", "servicetekniker", "reparatör", "diagnostik", "eftermarknad",
  "lastbil", "tunga fordon", "maskinmekaniker", "entreprenadmaskin", "anläggningsmaskin",
  "elbil", "elfordon", "hybrid", "drivlina", "batteri", "laddinfrastruktur",
  "däck", "hjul", "reservdelar", "bildelar", "husvagn", "husbil",
  "motorcykel", "moped", "båtmekaniker", "marinteknik", "flygteknik", "flygmekaniker",
  "tågteknik", "spårfordon", "truck", "traktor", "yrkesförare", "transportledare",
];

const seen = new Map(); // educationEventId -> raw list row
const stats = [];

async function slice(qs) {
  const doc = await getJson(`${BASE}?${qs}&size=100&page=0`);
  const body = doc?.body ?? {};
  const rows = body?._embedded?.[LIST_KEY] ?? [];
  return { rows, total: body?.page?.totalElements ?? rows.length };
}

function keep(rows) {
  for (const r of rows) if (r?.educationEventId) seen.set(r.educationEventId, r);
}

async function sweepType(code) {
  const { total: advertised } = await slice(`typeOfSchool=${code}`);
  let overflowed = 0;
  let residual = 0;
  const before = seen.size;

  await mapPool(KOMMUNER, 8, async (area) => {
    const s = await slice(`typeOfSchool=${code}&geographicalAreaCode=${area}`);
    if (s.total <= 100) { keep(s.rows); return; }
    overflowed += 1;
    // Too big for one page: split by direction, then note what direction-less rows remain.
    const got = new Set();
    await mapPool(DIRECTIONS, 8, async (dir) => {
      const d = await slice(`typeOfSchool=${code}&geographicalAreaCode=${area}&directionIds=${dir}`);
      keep(d.rows);
      for (const r of d.rows) got.add(r.educationEventId);
    });
    residual += Math.max(0, s.total - got.size);
  });

  stats.push({ type: code, advertised, kommunOverflowSlices: overflowed, directionlessResidual: residual, newRows: seen.size - before });
  console.log(`  ${code.padEnd(20)} advertised ${String(advertised).padStart(5)}  overflow-slices ${overflowed}  direction-less residual ~${residual}`);
}

async function keywordNet() {
  const before = seen.size;
  await mapPool(KEYWORDS, 6, async (term) => {
    const s = await slice(`searchTerm=${encodeURIComponent(term)}`);
    if (s.total <= 100) { keep(s.rows); return; }
    await mapPool(KOMMUNER, 6, async (area) => {
      const k = await slice(`searchTerm=${encodeURIComponent(term)}&geographicalAreaCode=${area}`);
      keep(k.rows);
    });
  });
  console.log(`  keyword net added ${seen.size - before} rows`);
}

async function directionNet() {
  const before = seen.size;
  await mapPool(DIRECTIONS, 8, async (dir) => {
    const s = await slice(`directionIds=${dir}`);
    if (s.total <= 100) { keep(s.rows); return; }
    await mapPool(KOMMUNER, 6, async (area) => {
      const k = await slice(`directionIds=${dir}&geographicalAreaCode=${area}`);
      keep(k.rows);
    });
  });
  console.log(`  direction net added ${seen.size - before} rows`);
}

async function main() {
  // The recall net is ~90k rows and slow to rebuild, while the classifier gets tuned
  // repeatedly. Cache the pool so re-running only re-classifies. Pass --refresh to
  // rebuild it from the API.
  const poolPath = path.join(DATA, "adult_pool.json");
  if (!process.argv.includes("--refresh") && fs.existsSync(poolPath)) {
    const cached = JSON.parse(fs.readFileSync(poolPath, "utf8"));
    for (const r of cached.rows) seen.set(r.educationEventId, r);
    stats.push(...(cached.stats ?? []));
    console.log(`Reusing cached recall pool: ${seen.size} rows (--refresh to rebuild)`);
  } else {
    console.log("Sweeping adult education by type x kommun...");
    for (const code of Object.keys(TYPES)) await sweepType(code);

    console.log("Running vehicle keyword net across all types...");
    await keywordNet();
    console.log("Running full direction net across all types...");
    await directionNet();

    fs.writeFileSync(poolPath, JSON.stringify({ built_at: new Date().toISOString(), stats, rows: [...seen.values()] }));
    console.log(`Cached recall pool -> data/adult_pool.json (${seen.size} rows)`);
  }

  console.log(`\nRecall net: ${seen.size} candidate rows. Classifying...`);
  const candidates = [...seen.values()].filter((r) => classify(`${r.titleSv ?? ""}`).tier);
  console.log(`  ${candidates.length} vehicle-related after title classification`);

  console.log(`Fetching ${candidates.length} detail records (contact info + programme URL)...`);
  let done = 0;
  const details = await mapPool(candidates, 8, async (r) => {
    const doc = await getJson(`${BASE}/${encodeURIComponent(r.educationEventId)}`);
    if (++done % 50 === 0) console.log(`  ${done}/${candidates.length}`);
    return doc?.body ?? null;
  });

  const programs = candidates.map((r, i) => {
    const d = details[i] ?? {};
    const ci = d.contactInfo ?? {};
    const visiting = pickAddress(ci.addresses, "VISITING_ADDRESS");
    const area = r.geographicalAreaCode ?? d.geographicalAreaCode ?? null;
    const cls = classify(`${r.titleSv ?? ""}`);

    return {
      source: "skolverket-planned-educations-v3-adult",
      education_event_id: r.educationEventId,
      program_name: r.titleSv ?? d.studyPathName ?? null,
      relevance_tier: cls.tier,
      relevance_reason: cls.reason,
      school_form: r.typeOfSchool ?? d.typeOfSchool ?? null,
      provider_name: r.providerName ?? d.providerName ?? null,
      organizer_name: d.organizerName ?? null,
      credits: r.credits ?? d.credits ?? null,
      credits_system: r.creditsSystem ?? d.creditsSystem ?? null,
      pace_of_study: r.paceOfStudy ?? d.paceOfStudy ?? null,
      distance: r.distance ?? d.distance ?? null,
      start_date: r.semesterStartFrom ?? d.semesterStartFrom ?? null,
      contractor: r.contractor ?? d.contractor ?? null,
      description: d.educationEventDescription ?? null,
      requirements: d.requirements ?? null,
      email: ci.email ?? null,
      phone: ci.telephone ?? null,
      website: ci.web ?? null,
      address: visiting?.street ?? null,
      postal_code: visiting?.zipCode ?? null,
      city: visiting?.city ?? r.town ?? r.contactInfoAddressCity ?? null,
      municipality: r.municipality ?? d.municipality ?? (area ? REGIONS[area] : null),
      municipality_code: area,
      county: r.county ?? countyFromAreaCode(area),
    };
  });

  fs.writeFileSync(
    path.join(DATA, "adult.json"),
    JSON.stringify({ fetched_at: new Date().toISOString(), stats, candidates_scanned: seen.size, count: programs.length, programs }, null, 2),
  );

  const byForm = {};
  const byTier = {};
  for (const p of programs) {
    byForm[p.school_form] = (byForm[p.school_form] ?? 0) + 1;
    byTier[p.relevance_tier] = (byTier[p.relevance_tier] ?? 0) + 1;
  }
  console.log(`\nWrote ${programs.length} programmes -> data/adult.json`);
  console.log("  by school form:", byForm);
  console.log("  by tier:", byTier);
  console.log(`  distinct providers: ${new Set(programs.map((p) => p.provider_name)).size}`);
  console.log(`  with email: ${programs.filter((p) => p.email).length}, with website: ${programs.filter((p) => p.website).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
