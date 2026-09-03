#!/usr/bin/env node
// Phase 1 — every Swedish gymnasium school unit that plans a vehicle programme.
//
// Two API calls per school: the education-events sweep tells us *which* schools and
// *which* programmes, the school-unit detail gives the contact record (email, phone,
// web, org number, huvudman, coordinates).
//
// Writes scripts/schools/data/gymnasium.json.

import fs from "node:fs";
import path from "node:path";
import {
  API, GY_PROGRAMS, getJson, fetchComplete, mapPool, pickAddress, countyFromAreaCode,
} from "./lib_skolverket.mjs";

const DATA = path.join(import.meta.dirname, "data");
const REGIONS = JSON.parse(fs.readFileSync(path.join(DATA, "regions.json"), "utf8"));
const KOMMUNER = Object.keys(REGIONS).filter((k) => k.length === 4).sort();

async function main() {
  // One request per programme code. Each code's result set fits in a single page
  // except FT25, which fetchComplete re-fetches partitioned by kommun — paging this
  // API across multiple pages loses ~30% of rows (see lib_skolverket.mjs).
  console.log("Fetching vehicle programmes by study-path code...");
  const wanted = [];
  for (const code of Object.keys(GY_PROGRAMS)) {
    const { rows, total, partitioned } = await fetchComplete(
      `${API}/education-events?studyPathCode=${code}`,
      "educationEvents",
      KOMMUNER,
      (e) => e.id,
    );
    if (rows.length !== total) throw new Error(`${code}: got ${rows.length} of ${total}`);
    wanted.push(...rows);
    console.log(`  ${code.padEnd(10)} ${String(total).padStart(4)}${partitioned ? "  (partitioned by kommun)" : ""}  ${GY_PROGRAMS[code].label}`);
  }
  console.log(`  ${wanted.length} vehicle-programme events across ${new Set(wanted.map((e) => e.schoolUnitCode)).size} school units`);

  const unitCodes = [...new Set(wanted.map((e) => e.schoolUnitCode))].sort();
  console.log(`Fetching ${unitCodes.length} school-unit detail records...`);
  let done = 0;
  const details = await mapPool(unitCodes, 8, async (code) => {
    const doc = await getJson(`${API}/school-units/${code}`);
    if (++done % 25 === 0) console.log(`  ${done}/${unitCodes.length}`);
    return doc?.body ?? null;
  });

  const byCode = new Map();
  unitCodes.forEach((code, i) => byCode.set(code, details[i]));

  const schools = unitCodes.map((code) => {
    const d = byCode.get(code) ?? {};
    const ci = d.contactInfo ?? {};
    const visiting = pickAddress(ci.addresses, "VISITING_ADDRESS");
    const postal = pickAddress(ci.addresses, "POSTAL_ADDRESS") ?? visiting;
    const events = wanted.filter((e) => e.schoolUnitCode === code);
    const areaCode = d.geographicalAreaCode ?? events[0]?.geographicalAreaCode ?? null;

    return {
      source: "skolverket-planned-educations-v3",
      school_unit_code: code,
      name: d.name ?? events[0]?.schoolUnitName ?? null,
      school_types: [...new Set(events.map((e) => e.typeOfSchooling?.code).filter(Boolean))],
      principal_organizer_type: d.principalOrganizerType ?? null,
      corporation_name: d.corporationName ?? null,
      org_number: d.organisationRegistryNumber ?? null,
      school_orientation: d.schoolOrientation ?? null,
      email: ci.email ?? null,
      phone: ci.telephone ?? null,
      website: ci.web ?? null,
      address: visiting?.street ?? null,
      postal_code: (postal?.zipCode ?? visiting?.zipCode ?? null),
      city: visiting?.city ?? events[0]?.visitingAddressCity ?? null,
      municipality_code: areaCode,
      municipality: areaCode ? (REGIONS[areaCode] ?? null) : null,
      county: countyFromAreaCode(areaCode),
      latitude: d.wgs84_Lat ? Number(d.wgs84_Lat) : null,
      longitude: d.wgs84_Long ? Number(d.wgs84_Long) : null,
      programs: events
        .map((e) => ({
          education_event_id: e.id ?? `edu-event-${code}-${e.studyPathCode}`,
          program_code: e.studyPathCode,
          program_name: e.studyPathName ?? GY_PROGRAMS[e.studyPathCode].label,
          program_kind: GY_PROGRAMS[e.studyPathCode].kind,
          relevance_tier: GY_PROGRAMS[e.studyPathCode].tier,
          program_category: e.studyPathCategory ?? null,
          school_form: e.typeOfSchooling?.code ?? null,
          school_form_label: e.typeOfSchooling?.displayName ?? null,
          start_date: e.startDate ? e.startDate.slice(0, 10) : null,
          admission_points_min: e.admissionPointsMin ?? null,
          admission_points_average: e.admissionPointsAverage ?? null,
          admission_points_semester: e.admissionPointsSemester ?? null,
          // Skolverket does not expose FT25 inriktningar; Phase 3 fills these from the
          // school's own site. Empty array here means "not yet looked up".
          orientations: [],
        }))
        .sort((a, b) => a.program_code.localeCompare(b.program_code)),
    };
  });

  // Highest tier wins: a school with FT25 is "core" even if it also runs Flygteknik.
  for (const s of schools) {
    s.relevance_tier = s.programs.some((p) => p.relevance_tier === "core") ? "core" : "adjacent";
    s.has_national_program = s.programs.some((p) => p.program_kind === "national");
  }

  fs.writeFileSync(
    path.join(DATA, "gymnasium.json"),
    JSON.stringify({ fetched_at: new Date().toISOString(), count: schools.length, schools }, null, 2),
  );

  const missing = schools.filter((s) => !s.email && !s.phone && !s.website).length;
  console.log(`\nWrote ${schools.length} schools -> data/gymnasium.json`);
  console.log(`  core: ${schools.filter((s) => s.relevance_tier === "core").length}, adjacent: ${schools.filter((s) => s.relevance_tier === "adjacent").length}`);
  console.log(`  with email: ${schools.filter((s) => s.email).length}, with website: ${schools.filter((s) => s.website).length}, no contact data at all: ${missing}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
