#!/usr/bin/env node
// Phase B — read every vendor's reference pages and pull out the companies named there.
//
// This is where the prospect list actually comes from. A configurator vendor's customer
// page is a list of companies that have already bought a configurator, which is exactly
// the audience Animech wants: they are not being asked whether they need one, they are
// being asked whether theirs could be better.
//
// The extraction anchors on OUTBOUND LINKS rather than on text. A logo wall gives you
// `<a href="https://kinnarps.com"><img alt="Kinnarps"></a>`, and the href is the half
// that survives translation, image-only logos and marketing copy. Company names lifted
// from headings alone were tried first and produced things like "Read the case study"
// and "Our Customers" as company names.
//
//   node scripts/configurators/02_harvest_customers.mjs [--limit-pages N]
//
// Writes scripts/configurators/data/harvested_customers.json.

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "../schools/lib_skolverket.mjs";
import { fetchHtml, stripTags, normUrl } from "../schools/lib_scrape.mjs";
import { JUNK_HOST, registrable, countryFromHost } from "./lib_configurator.mjs";

const DATA = path.join(import.meta.dirname, "data");
const vendors = JSON.parse(fs.readFileSync(path.join(DATA, "verified_vendors.json"), "utf8")).vendors;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
};
const LIMIT_PAGES = arg("--limit-pages", 130);

// Vendors whose own domains must never be harvested as customers of themselves, plus
// the domains they redirect through.
const vendorHosts = new Set();
for (const v of vendors) {
  for (const u of [v.website, v.resolved_website]) {
    try { if (u) vendorHosts.add(registrable(new URL(u).hostname)); } catch { /* ignore */ }
  }
}

// Link text that is navigation, not a company.
const NOT_A_COMPANY =
  /^(read( more| the)?|learn more|see more|view( website| site)?|more|visit( website| site| us)?|company website|website|homepage|case stud(y|ies)|customer stor(y|ies)|success stor(y|ies)|home|back|next|previous|contact( us)?|about( us)?|book a demo|request a demo|get started|sign up|log ?in|download|watch|play|share|menu|close|search|cookie|privacy|terms|imprint|impressum|documentation|support|community|careers?|jobs?( &? ?karriere)?|blog|news|partners?|pricing|weiterlesen|mehr( erfahren)?|meer|lees meer|läs mer|en savoir plus|scopri|leggi|ver más|zum artikel|zur referenz|alle referenzen|alle cases|view all|show all|all customers|zur website|webseite|besuchen)$/i;

// Header, footer and nav carry the same links on every page. Removing them before
// extraction is what separates a customer logo wall from the site's own chrome; the
// first run without this produced Capterra, G2 and Revalize's own product portfolio as
// the 20 most-referenced "customers".
function stripChrome(html) {
  return String(html)
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<div[^>]*(class|id)\s*=\s*["'][^"']*(cookie|consent|site-header|site-footer|global-nav|main-nav|navbar|menu-main|breadcrumb)[^"']*["'][\s\S]{0,20000}?<\/div>/gi, " ");
}

function outboundCompanies(rawHtml, pageUrl) {
  const html = stripChrome(rawHtml);
  const found = new Map();
  const re = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = normUrl(m[1], pageUrl);
    if (!href) continue;
    let host;
    try { host = new URL(href).hostname; } catch { continue; }
    const dom = registrable(host);
    if (!dom || !dom.includes(".")) continue;
    if (vendorHosts.has(dom) || JUNK_HOST.test(`${host}.`)) continue;

    const inner = m[2];
    // The name, best source first: a logo image's alt text, then the link text, then
    // the title attribute.
    const alt = inner.match(/<img[^>]*\balt\s*=\s*["']([^"']{2,80})["']/i)?.[1];
    const text = stripTags(inner).replace(/\s+/g, " ").trim();
    const titleAttr = m[0].match(/\btitle\s*=\s*["']([^"']{2,80})["']/i)?.[1];
    let name = [alt, text, titleAttr].find((s) => s && s.length >= 2 && s.length <= 70 && !NOT_A_COMPANY.test(s) && !/^https?:/i.test(s));
    if (name) name = name.replace(/\s*(logo|logotype|logotyp|-?\s*case study|referenz)\s*$/i, "").trim();

    const prev = found.get(dom);
    if (!prev || (!prev.name && name)) found.set(dom, { domain: dom, name: name ?? null, url: `https://${dom}`, seen_on: pageUrl });
  }
  return [...found.values()];
}

const pageBudget = vendors.reduce((n, v) => n + Math.min(v.reference_pages?.length ?? 0, LIMIT_PAGES), 0);
console.log(`Harvesting ${pageBudget} reference pages across ${vendors.filter((v) => v.reference_pages?.length).length} vendors...`);

let pagesDone = 0;
const byDomain = new Map();

// Paths worth trying when phase A found almost nothing. Roomle, Expivi, Combeenation
// and pCon all render their case lists client-side, so the homepage carries no link to
// them and the sitemap does not name them -- but the pages are there, at the obvious
// address, in the site's own language.
const PROBE_PATHS = [
  "/customers", "/customer-stories", "/cases", "/case-studies", "/success-stories",
  "/references", "/showcase", "/portfolio", "/our-work", "/clients",
  "/en/customers", "/en/cases", "/en/case-studies", "/en/references", "/en/showcase",
  "/referenzen", "/kunden", "/de/referenzen", "/de/kunden", "/anwenderberichte",
  "/klanten", "/referenties", "/nl/klanten", "/nl/referenties", "/klantcases",
  "/kunder", "/referenser", "/kundcase", "/asiakkaat", "/referencer", "/referanser",
  "/references-clients", "/clients-cas", "/fr/references", "/clienti", "/it/clienti",
  "/casi-studio", "/clientes", "/es/clientes", "/klienci", "/pl/klienci",
];

// A vendor's case index links to one page per customer. Following those children is
// where Roomle's two discovered pages become thirty: the index is a grid of tiles and
// the customer's own site is linked from the tile's page, not from the grid.
function childPages(html, pageUrl, origin) {
  const out = new Set();
  const base = new URL(pageUrl).pathname.replace(/\/+$/, "");
  const re = /<a[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = normUrl(m[1], pageUrl);
    if (!href || !href.startsWith(origin)) continue;
    const clean = href.replace(/[#?].*$/, "").replace(/\/+$/, "");
    const p = clean.slice(origin.length);
    if (!p || p === base) continue;
    // A child of the index path, one segment deeper. Not two: that is pagination and
    // tag pages, which cost fetches and add nothing.
    if (base && p.startsWith(`${base}/`) && p.slice(base.length + 1).split("/").length === 1) out.add(clean);
  }
  return [...out];
}

for (const v of vendors) {
  if (!v.verified && !v.blocked) continue;
  let pages = (v.reference_pages ?? []).slice(0, LIMIT_PAGES);

  // Probe only when discovery came up nearly empty; on a vendor with 60 known case
  // pages these 37 extra fetches would buy nothing.
  if (pages.length < 6 && v.resolved_website) {
    const origin = new URL(v.resolved_website).origin;
    const hits = await mapPool(PROBE_PATHS, 6, async (p) => {
      const res = await fetchHtml(origin + p, { timeout: 15000 });
      return res.ok && res.html.length > 2000 ? res.url : null;
    });
    const found = [...new Set(hits.filter(Boolean))].filter((u) => !pages.includes(u));
    if (found.length) console.log(`  ${v.name}: probing found ${found.length} more index pages`);
    pages = [...pages, ...found];
  }
  if (!pages.length) continue;

  const level1 = await mapPool(pages, 5, async (p) => {
    const res = await fetchHtml(p, { timeout: 20000 });
    pagesDone++;
    return res.ok ? { url: res.url, html: res.html } : null;
  });

  // Expand one level into the per-customer pages, bounded so a big vendor cannot eat
  // the whole run.
  const origin = v.resolved_website ? new URL(v.resolved_website).origin : null;
  const seen = new Set(pages);
  const children = [];
  if (origin) {
    for (const p of level1) {
      if (!p) continue;
      for (const c of childPages(p.html, p.url, origin)) {
        if (!seen.has(c) && children.length < 90) { seen.add(c); children.push(c); }
      }
    }
  }
  if (children.length) console.log(`  ${v.name}: following ${children.length} case pages`);

  const level2 = await mapPool(children, 5, async (p) => {
    const res = await fetchHtml(p, { timeout: 20000 });
    if (++pagesDone % 100 === 0) console.log(`  ${pagesDone} pages read`);
    return res.ok ? { url: res.url, html: res.html } : null;
  });

  const results = [...level1, ...level2].map((p) => (p ? outboundCompanies(p.html, p.url) : []));

  // How many of THIS vendor's pages each domain appeared on. A customer is named on one
  // case study; a sibling product, a partner badge or a review-site link is on all of
  // them. Anything on more than a third of a vendor's pages (and on more than three) is
  // chrome that survived stripChrome, and is dropped for this vendor.
  const perDomainPages = new Map();
  for (const page of results) for (const d of new Set(page.map((h) => h.domain))) perDomainPages.set(d, (perDomainPages.get(d) ?? 0) + 1);
  const chrome = new Set(
    [...perDomainPages].filter(([, n]) => n > 3 && n / results.length > 0.33).map(([d]) => d),
  );
  if (chrome.size) console.log(`  ${v.name}: dropped ${chrome.size} chrome domains`);

  for (const hit of results.flat()) {
    if (chrome.has(hit.domain)) continue;
    const existing = byDomain.get(hit.domain);
    if (existing) {
      if (!existing.vendors.includes(v.name)) existing.vendors.push(v.name);
      if (!existing.name && hit.name) existing.name = hit.name;
      existing.mentions++;
      if (existing.seen_on.length < 4) existing.seen_on.push(hit.seen_on);
    } else {
      const [country, code] = countryFromHost(hit.domain);
      byDomain.set(hit.domain, {
        domain: hit.domain,
        name: hit.name,
        website: hit.url,
        country,
        country_code: code,
        vendors: [v.name],
        vendor_kinds: [],
        mentions: 1,
        seen_on: [hit.seen_on],
      });
    }
  }
}

const kindOf = new Map(vendors.map((v) => [v.name, v.kind]));
for (const c of byDomain.values()) c.vendor_kinds = [...new Set(c.vendors.map((n) => kindOf.get(n)).filter(Boolean))];

// Everything that survives the junk list and the per-vendor chrome filter is kept, even
// when the link text was generic. On a case-study page the customer is frequently linked
// as "Company website", so a missing name means the anchor was unhelpful, not that the
// row is junk -- siemens.com came through exactly that way. The name is filled from the
// site's own title in phase C.
const all = [...byDomain.values()];
const keep = all;

// Cited by several independent vendors first: that is a company that has changed
// configurator at least once, and is the single best signal in this dataset.
keep.sort(
  (a, b) => b.vendors.length - a.vendors.length || b.mentions - a.mentions || a.domain.localeCompare(b.domain),
);

fs.writeFileSync(
  path.join(DATA, "harvested_customers.json"),
  JSON.stringify({ harvested_at: new Date().toISOString(), pages: pagesDone, count: keep.length, customers: keep }, null, 2),
);

console.log(`\n${pagesDone} pages read`);
console.log(`${all.length} distinct domains, ${keep.length} kept (named or seen more than once)`);
const byCountry = {};
for (const c of keep) byCountry[c.country ?? "(unknown from TLD)"] = (byCountry[c.country ?? "(unknown from TLD)"] ?? 0) + 1;
console.log("by country (from TLD):", Object.fromEntries(Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 25)));
console.log("\nTop vendors by references harvested:");
const perVendor = {};
for (const c of keep) for (const v of c.vendors) perVendor[v] = (perVendor[v] ?? 0) + 1;
for (const [n, k] of Object.entries(perVendor).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(k).padStart(4)}  ${n}`);
