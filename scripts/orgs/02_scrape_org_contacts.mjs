#!/usr/bin/env node
// Phase C — pull named contacts and org details off each association / fair / media site.
//
// Same two-level crawl as the schools pass, with three differences:
//   * the title vocabulary is multilingual (lib_org_roles.mjs)
//   * contact-page link matching covers the languages these sites are written in
//   * an org's own domain is the only accepted contact domain, which matters more here
//     because association sites link out to every one of their members
//
// Sites flagged `blocked` in the seed refuse automated requests. They stay in the
// dataset with their website and are simply not crawled.
//
//   node scripts/orgs/02_scrape_org_contacts.mjs           # resume
//   node scripts/orgs/02_scrape_org_contacts.mjs --force   # recrawl everything

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "../schools/lib_skolverket.mjs";
import { fetchHtml, extractPeople, extractEmails, normUrl, stripTags } from "../schools/lib_scrape.mjs";
import { ORG_TITLES, ORG_CONTACT_LINK_RE } from "./lib_org_roles.mjs";

const DATA = path.join(import.meta.dirname, "data");
const OUT = path.join(DATA, "org_enrichment.json");

const verified = JSON.parse(fs.readFileSync(path.join(DATA, "verified_orgs.json"), "utf8")).orgs;
const targets = verified.filter((o) => o.verified && !o.blocked);
console.log(`${verified.length} seeded, ${targets.length} crawlable (${verified.filter((o) => o.blocked).length} blocked, ${verified.filter((o) => !o.verified).length} unresolved)`);

const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { results: {} };
const results = cache.results ?? {};
const force = process.argv.includes("--force");

const registrable = (h) => h.replace(/^www\./i, "").split(".").slice(-2).join(".");

// Phone numbers in international or local form, near a contact block.
const PHONE_RE = /(?:\+\d{1,3}[\s\-.]?)?(?:\(?\d{1,4}\)?[\s\-.]?){2,5}\d{2,4}/g;

function pickOrgLinks(html, baseUrl) {
  const hrefs = [...new Set([...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
  const out = [];
  let baseHost;
  try { baseHost = new URL(baseUrl).host; } catch { return out; }
  for (const h of hrefs) {
    const abs = normUrl(h, baseUrl);
    if (!abs) continue;
    let host;
    try { host = new URL(abs).host; } catch { continue; }
    // Association sites link to every member; staying on-domain keeps the members
    // out of the association's own contact list.
    if (registrable(host) !== registrable(baseHost)) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|pptx?|mp4)$/i.test(abs)) continue;
    if (ORG_CONTACT_LINK_RE.test(abs)) out.push(abs);
  }
  return [...new Set(out)].slice(0, 8);
}

async function crawl(o) {
  if (!force && results[o.website]?.done) return;

  const start = o.resolved_website ?? o.website;
  const home = await fetchHtml(start, { timeout: 20000 });
  const pages = home.ok ? [{ url: home.url, html: home.html }] : [];

  if (home.ok) {
    const links = pickOrgLinks(home.html, home.url);
    const got = await mapPool(links, 3, async (u) => {
      const r = await fetchHtml(u, { timeout: 20000 });
      return r.ok ? { url: r.url, html: r.html } : null;
    });
    pages.push(...got.filter(Boolean));
  }

  const people = new Map();
  // Off-domain people found on the org's pages. MRF's regional-board page lists the
  // chairs of its branches, and every one of them works at a member dealership
  // (bilia.se, vw.se, bilbolaget.nu): 45 of MRF's 47 "contacts" were other companies'
  // staff. They are not association employees and must not be filed as such. They are
  // kept separately because a regional chair of the dealer federation is a genuinely
  // good prospect in his own right.
  const affiliated = new Map();
  const emails = new Set();
  const phones = new Set();

  let orgDomain = null;
  try { orgDomain = registrable(new URL(start).host); } catch { /* leave null */ }

  for (const p of pages) {
    for (const person of extractPeople(p.html, p.url, null, ORG_TITLES)) {
      const dom = registrable((person.email.split("@")[1] ?? ""));
      const bucket = !orgDomain || dom === orgDomain ? people : affiliated;
      const prev = bucket.get(person.email);
      if (!prev || (!prev.name && person.name) || (!prev.title && person.title)) {
        bucket.set(person.email, { ...prev, ...person, domain: dom });
      }
    }
    for (const e of extractEmails(p.html)) {
      if (!orgDomain || registrable(e.split("@")[1] ?? "") === orgDomain) emails.add(e);
    }
  }

  // Fallback for the 26 sites that publish an address in text but wire no mailto link.
  if (people.size === 0) {
    for (const e of emails) people.set(e, { email: e, name: null, title: null, source_url: start, domain: orgDomain });
  }

  // Phones only from the homepage, where the switchboard number lives. Deeper pages
  // produce dates and postcodes that match the same shape.
  if (home.ok) {
    const txt = stripTags(home.html);
    for (const m of (txt.match(PHONE_RE) ?? [])) {
      const digits = m.replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) phones.add(m.trim());
    }
  }

  results[o.website] = {
    website: o.website,
    name: o.name,
    country_code: o.country_code,
    done: true,
    reachable: home.ok,
    status: String(home.status),
    pages_crawled: pages.length,
    people: [...people.values()],
    affiliated: [...affiliated.values()].slice(0, 80),
    emails: [...emails].slice(0, 40),
    phones: [...phones].slice(0, 5),
    crawled_at: new Date().toISOString(),
  };
}

const todo = force ? targets : targets.filter((o) => !results[o.website]?.done);
console.log(`crawling ${todo.length}...`);
let done = 0;
// A hard ceiling per site. AbortSignal.timeout covers a slow response but not every
// stalled socket, and two sites left the run with an unsettled promise.
const withDeadline = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`deadline ${label}`)), ms))]);

await mapPool(todo, 5, async (o) => {
  try { await withDeadline(crawl(o), 90000, o.website); }
  catch (e) { results[o.website] = { website: o.website, name: o.name, done: true, reachable: false, status: `ERR:${e.message?.slice(0, 40)}`, people: [], emails: [], phones: [] }; }
  if (++done % 15 === 0) {
    console.log(`  ${done}/${todo.length}`);
    fs.writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), results }, null, 2));
  }
});
fs.writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), results }, null, 2));

const all = Object.values(results);
console.log(`\nWrote ${all.length} results -> data/org_enrichment.json`);
console.log(`  reachable: ${all.filter((r) => r.reachable).length}/${all.length}`);
console.log(`  orgs with >=1 person: ${all.filter((r) => r.people?.length).length}`);
console.log(`  orgs with >=1 NAMED person: ${all.filter((r) => r.people?.some((p) => p.name)).length}`);
console.log(`  total people: ${all.reduce((n, r) => n + (r.people?.length ?? 0), 0)}`);
console.log(`  with a title: ${all.reduce((n, r) => n + (r.people?.filter((p) => p.title).length ?? 0), 0)}`);
console.log(`  affiliated people at member companies (kept separate): ${all.reduce((n, r) => n + (r.affiliated?.length ?? 0), 0)}`);
