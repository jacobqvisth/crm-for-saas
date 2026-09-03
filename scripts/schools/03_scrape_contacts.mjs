#!/usr/bin/env node
// Phase 3 — enrich each school with named contact people and the FT25 inriktningar.
//
// Skolverket gives one address per school unit and no staff at all, and it does not
// expose which inriktningar (Personbil / Lastbil och mobila maskiner / Karosseri och
// lackering / Transport) a school actually runs. Both come off the school's own site.
//
// Crawl shape per site: homepage -> up to 6 contact-ish pages + up to 4 programme
// pages. Results are cached per site so the crawl can be resumed and re-run cheaply.
//
// Writes scripts/schools/data/enrichment.json.

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "./lib_skolverket.mjs";
import {
  fetchHtml, stripTags, extractEmails, extractPeople, extractOrientations,
  pickLinks, normUrl,
} from "./lib_scrape.mjs";

const DATA = path.join(import.meta.dirname, "data");
const OUT = path.join(DATA, "enrichment.json");

const gym = JSON.parse(fs.readFileSync(path.join(DATA, "gymnasium.json"), "utf8")).schools;
const adult = JSON.parse(fs.readFileSync(path.join(DATA, "adult.json"), "utf8")).programs;

// One crawl target per distinct site. Adult providers are keyed by provider+site
// because several providers share a domain (e.g. all the kommun-run ones).
const targets = new Map();
for (const s of gym) {
  const url = normUrl(s.website);
  if (!url) continue;
  targets.set(`gy:${s.school_unit_code}`, { key: `gy:${s.school_unit_code}`, kind: "gymnasium", name: s.name, url });
}
for (const p of adult) {
  const url = normUrl(p.website);
  if (!url) continue;
  const key = `ad:${p.education_event_id}`;
  targets.set(key, { key, kind: "adult", name: p.provider_name ?? p.program_name, url });
}

const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { results: {} };
const results = cache.results ?? {};
const force = process.argv.includes("--force");

const CTX_PATH = path.join(DATA, "scrape_contexts.json");
const ctxStore = !force && fs.existsSync(CTX_PATH) ? JSON.parse(fs.readFileSync(CTX_PATH, "utf8")) : {};

async function crawl(t) {
  if (!force && results[t.key]?.done) return;

  const home = await fetchHtml(t.url);
  const pages = [];
  if (home.ok) pages.push({ url: home.url, html: home.html, role: "home" });

  if (home.ok) {
    const { contact, program } = pickLinks(home.html, home.url);
    const toFetch = [...contact.map((u) => [u, "contact"]), ...program.map((u) => [u, "program"])];
    const fetched = await mapPool(toFetch, 3, async ([u, role]) => {
      const r = await fetchHtml(u);
      return r.ok ? { url: r.url, html: r.html, role } : null;
    });
    pages.push(...fetched.filter(Boolean));
  }

  const people = new Map();
  const emails = new Set();
  const orientations = new Set();
  // Keep the markup window around each address so the name/title heuristics can be
  // re-tuned later without re-crawling 600 sites.
  const contexts = [];

  for (const p of pages) {
    for (const person of extractPeople(p.html, p.url, contexts)) {
      const prev = people.get(person.email);
      if (!prev || (!prev.name && person.name) || (!prev.title && person.title)) {
        people.set(person.email, { ...prev, ...person });
      }
    }
    for (const e of extractEmails(p.html)) emails.add(e);
    // Only read inriktningar off pages that are actually about the vehicle programme —
    // a school's generic "our programmes" index lists every trade and would otherwise
    // claim the school runs all four.
    if (/fordon/i.test(p.url) || (p.role === "program" && /fordons?-?\s*och\s*transport|fordonsprogram/i.test(stripTags(p.html).slice(0, 4000)))) {
      for (const o of extractOrientations(stripTags(p.html))) orientations.add(o);
    }
  }

  results[t.key] = {
    key: t.key,
    kind: t.kind,
    name: t.name,
    url: t.url,
    done: true,
    reachable: home.ok,
    status: home.status,
    pages_crawled: pages.length,
    people: [...people.values()],
    emails: [...emails].slice(0, 60),
    orientations: [...orientations],
    crawled_at: new Date().toISOString(),
  };
  ctxStore[t.key] = contexts.slice(0, 400);
}

async function main() {
  const list = [...targets.values()];
  const todo = force ? list : list.filter((t) => !results[t.key]?.done);
  console.log(`${list.length} sites total, ${todo.length} to crawl`);

  let done = 0;
  await mapPool(todo, 6, async (t) => {
    try { await crawl(t); } catch (e) { results[t.key] = { key: t.key, kind: t.kind, name: t.name, url: t.url, done: true, reachable: false, status: `ERR:${e.message?.slice(0, 40)}`, people: [], emails: [], orientations: [] }; }
    if (++done % 20 === 0) {
      console.log(`  ${done}/${todo.length}`);
      fs.writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), results }, null, 2));
  fs.writeFileSync(CTX_PATH, JSON.stringify(ctxStore));
    }
  });

  fs.writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), results }, null, 2));
  fs.writeFileSync(CTX_PATH, JSON.stringify(ctxStore));

  const all = Object.values(results);
  const gy = all.filter((r) => r.kind === "gymnasium");
  const named = (rs) => rs.filter((r) => r.people?.some((p) => p.name)).length;
  console.log(`\nWrote ${all.length} site results -> data/enrichment.json`);
  console.log(`  reachable: ${all.filter((r) => r.reachable).length}/${all.length}`);
  console.log(`  gymnasium sites with >=1 named person: ${named(gy)}/${gy.length}`);
  console.log(`  total people found: ${all.reduce((n, r) => n + (r.people?.length ?? 0), 0)}`);
  console.log(`  with a job title: ${all.reduce((n, r) => n + (r.people?.filter((p) => p.title).length ?? 0), 0)}`);
  console.log(`  gymnasium sites with inriktningar: ${gy.filter((r) => r.orientations?.length).length}/${gy.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
