#!/usr/bin/env node
// Phase D — pull named contacts and phone numbers off each prospect's own site.
//
// Same two-level crawl as the schools and orgs passes, with the vocabulary swapped for
// the buying committee at a manufacturer (lib_prospect_roles.mjs) rather than the staff
// of a trade association.
//
// One rule matters more here than in either earlier crawl: ONLY the company's own domain
// counts. Manufacturers link to their dealers, their group companies and their agency,
// and every one of those would otherwise arrive as an employee. The orgs pass learned
// this the expensive way -- 45 of MRF's 47 "contacts" worked somewhere else.
//
// Sites flagged `blocked` refuse automated requests. They stay in the dataset with their
// website and configurator link, and are simply not crawled.
//
//   node scripts/configurators/04_scrape_contacts.mjs           # resume
//   node scripts/configurators/04_scrape_contacts.mjs --force   # recrawl everything

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "../schools/lib_skolverket.mjs";
import { fetchHtml, extractPeople, extractEmails, normUrl, stripTags } from "../schools/lib_scrape.mjs";
import { PROSPECT_TITLES, PROSPECT_CONTACT_LINK_RE } from "./lib_prospect_roles.mjs";
import { registrable } from "./lib_configurator.mjs";

const DATA = path.join(import.meta.dirname, "data");
const OUT = path.join(DATA, "prospect_enrichment.json");

const verified = JSON.parse(fs.readFileSync(path.join(DATA, "verified_prospects.json"), "utf8")).prospects;
const targets = verified.filter((p) => p.verified && !p.blocked);
console.log(
  `${verified.length} verified, ${targets.length} crawlable ` +
  `(${verified.filter((p) => p.blocked).length} blocked, ${verified.filter((p) => !p.verified).length} unresolved)`,
);

const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { results: {} };
const results = cache.results ?? {};
const force = process.argv.includes("--force");

const PHONE_RE = /(?:\+\d{1,3}[\s\-.]?)?(?:\(?\d{1,4}\)?[\s\-.]?){2,5}\d{2,4}/g;

function pickContactLinks(html, baseUrl) {
  const hrefs = [...new Set([...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
  const out = [];
  let baseHost;
  try { baseHost = new URL(baseUrl).host; } catch { return out; }
  for (const h of hrefs) {
    const abs = normUrl(h, baseUrl);
    if (!abs) continue;
    let host;
    try { host = new URL(abs).host; } catch { continue; }
    if (registrable(host) !== registrable(baseHost)) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|pptx?|mp4|webp|svg)$/i.test(abs)) continue;
    if (PROSPECT_CONTACT_LINK_RE.test(abs)) out.push(abs.replace(/#.*$/, ""));
  }
  // Shortest first: /contact before /contact/regional-offices/norway.
  return [...new Set(out)].sort((a, b) => a.length - b.length).slice(0, 8);
}

async function crawl(p) {
  if (!force && results[p.domain]?.done) return;

  const start = p.resolved_website ?? p.website;
  const home = await fetchHtml(start, { timeout: 20000 });
  const pages = home.ok ? [{ url: home.url, html: home.html }] : [];

  if (home.ok) {
    const links = pickContactLinks(home.html, home.url);
    const got = await mapPool(links, 3, async (u) => {
      const r = await fetchHtml(u, { timeout: 20000 });
      return r.ok ? { url: r.url, html: r.html } : null;
    });
    pages.push(...got.filter(Boolean));
  }

  const people = new Map();
  // People found on the company's pages who work somewhere else: dealers, group
  // companies, the agency that built the site. Kept, but never filed as employees.
  const affiliated = new Map();
  const emails = new Set();
  const phones = new Set();

  let ownDomain = null;
  try { ownDomain = registrable(new URL(start).host); } catch { /* leave null */ }

  for (const page of pages) {
    for (const person of extractPeople(page.html, page.url, null, PROSPECT_TITLES)) {
      const dom = registrable(person.email.split("@")[1] ?? "");
      const bucket = !ownDomain || dom === ownDomain ? people : affiliated;
      const prev = bucket.get(person.email);
      if (!prev || (!prev.name && person.name) || (!prev.title && person.title)) {
        bucket.set(person.email, { ...prev, ...person, domain: dom });
      }
    }
    for (const e of extractEmails(page.html)) {
      if (!ownDomain || registrable(e.split("@")[1] ?? "") === ownDomain) emails.add(e);
    }
  }

  // Fallback for sites that print an address in text but wire no mailto link.
  if (people.size === 0) {
    for (const e of emails) people.set(e, { email: e, name: null, title: null, source_url: start, domain: ownDomain });
  }

  // Phones only from the homepage, where the switchboard number lives. Deeper pages
  // produce dates, article numbers and postcodes that match the same shape.
  if (home.ok) {
    const txt = stripTags(home.html);
    for (const m of (txt.match(PHONE_RE) ?? [])) {
      const digits = m.replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) phones.add(m.trim());
    }
  }

  results[p.domain] = {
    domain: p.domain,
    name: p.name,
    country_code: p.country_code,
    done: true,
    reachable: home.ok,
    status: String(home.status),
    pages_crawled: pages.length,
    people: [...people.values()],
    affiliated: [...affiliated.values()].slice(0, 40),
    emails: [...emails].slice(0, 40),
    phones: [...phones].slice(0, 5),
    crawled_at: new Date().toISOString(),
  };
}

const todo = force ? targets : targets.filter((p) => !results[p.domain]?.done);
console.log(`crawling ${todo.length}...`);
let done = 0;

// A hard ceiling per site. AbortSignal.timeout covers a slow response but not every
// stalled socket, and the orgs run ended with two unsettled promises without this.
const withDeadline = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`deadline ${label}`)), ms))]);

await mapPool(todo, 5, async (p) => {
  try { await withDeadline(crawl(p), 90000, p.domain); }
  catch (e) {
    results[p.domain] = {
      domain: p.domain, name: p.name, done: true, reachable: false,
      status: `ERR:${String(e.message).slice(0, 40)}`, people: [], emails: [], phones: [],
    };
  }
  if (++done % 25 === 0) {
    console.log(`  ${done}/${todo.length}`);
    fs.writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), results }, null, 2));
  }
});
fs.writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), results }, null, 2));

const all = Object.values(results);
console.log(`\nWrote ${all.length} results -> data/prospect_enrichment.json`);
console.log(`  reachable: ${all.filter((r) => r.reachable).length}/${all.length}`);
console.log(`  companies with >=1 person: ${all.filter((r) => r.people?.length).length}`);
console.log(`  companies with >=1 NAMED person: ${all.filter((r) => r.people?.some((p) => p.name)).length}`);
console.log(`  companies with a phone: ${all.filter((r) => r.phones?.length).length}`);
console.log(`  total people: ${all.reduce((n, r) => n + (r.people?.length ?? 0), 0)}`);
console.log(`  with a title: ${all.reduce((n, r) => n + (r.people?.filter((p) => p.title).length ?? 0), 0)}`);
