#!/usr/bin/env node
// Phase C — for every harvested company: does the site exist, where is its configurator,
// and what is running behind it.
//
// The link to the live configurator is the point of the whole exercise. Axel's brief is
// to open with "we looked at yours", and an outreach that cannot name the page it is
// talking about is just another cold email. So a company with no configurator URL is
// kept but flagged, and never presented as if the link had been found.
//
// Three sources of evidence, in descending order of trust:
//
//   1. A platform fingerprint in the configurator page's own HTML. If the page loads
//      roomle.js then it IS a Roomle configurator, whatever any marketing page claims.
//   2. A platform fingerprint on the homepage.
//   3. The vendor that named this company as a customer. Weakest, because vendors leave
//      churned logos up for years -- which is itself a selling point for Animech, but
//      not something to state as current fact.
//
// This phase also demotes the vendors that came through as their own customers. A
// company whose homepage sells configurators is a competitor, not a prospect, and
// shipping Zakeke to Animech as a lead would be embarrassing.
//
//   node scripts/configurators/03_verify_prospects.mjs [--limit N]
//
// Writes scripts/configurators/data/verified_prospects.json.

import fs from "node:fs";
import path from "node:path";
import { mapPool } from "../schools/lib_skolverket.mjs";
import { fetchHtml, stripTags, normUrl, extractEmails } from "../schools/lib_scrape.mjs";
import { inferCountry, detectPlatforms, scoreConfiguratorLink, registrable } from "./lib_configurator.mjs";

const DATA = path.join(import.meta.dirname, "data");
const harvest = JSON.parse(fs.readFileSync(path.join(DATA, "harvested_customers.json"), "utf8")).customers;
const li = process.argv.indexOf("--limit");
const candidates = li === -1 ? harvest : harvest.slice(0, Number(process.argv[li + 1]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Language a site sells a configurator in tells you very little; language it describes
// ITSELF in tells you whether it is a vendor. These phrases only appear on a company
// that sells configuration software to other companies.
const VENDOR_SELF_DESCRIPTION =
  /(configurator (software|platform|solution)|cpq (software|platform|solution)|product configurator (software|platform)|konfigurator[-\s]?(software|plattform|l[öo]sung)|configuratie(software|platform)|logiciel de configurat|software di configurazione|we (build|create|develop) (3d )?configurators|configurator development|our configurator platform|visual commerce platform)/i;

// Paths to try when the site links to its configurator from a menu that only exists
// after JavaScript runs. Cheap: one HEAD-ish GET each, only when no link was found.
const CONFIG_PROBE = [
  "/configurator", "/konfigurator", "/configurateur", "/configuratore", "/configurador",
  "/en/configurator", "/de/konfigurator", "/fr/configurateur", "/it/configuratore",
  "/product-configurator", "/produktkonfigurator", "/3d-konfigurator", "/3d-configurator",
  "/planner", "/planer", "/raumplaner", "/room-planner", "/online-planner",
  "/build-your-own", "/design-your-own", "/customize", "/customizer", "/samenstellen",
  "/bygg-din", "/konfigurera", "/konfigurator.html", "/configurator.html",
];

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? stripTags(m[1]).replace(/\s+/g, " ").trim().slice(0, 160) : null;
}

function metaDescription(html) {
  const m = html.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']{0,400})["']/i)
    ?? html.match(/<meta[^>]+content\s*=\s*["']([^"']{0,400})["'][^>]*name\s*=\s*["']description["']/i);
  return m ? stripTags(m[1]).replace(/\s+/g, " ").trim().slice(0, 300) : null;
}

// A phone number on the homepage, taken from tel: links first because free-text phone
// numbers on a European site are written eight different ways.
function firstPhone(html) {
  const tel = html.match(/href\s*=\s*["']tel:([^"']{6,30})["']/i)?.[1];
  if (tel) return tel.replace(/[^\d+]/g, "").replace(/^00/, "+");
  const m = stripTags(html).match(/(\+\d{1,3}[\s\-().]?(?:\d[\s\-().]?){7,13}\d)/);
  return m ? m[1].replace(/[^\d+]/g, "") : null;
}

async function fetchRetry(url, attempts = 2) {
  let res = { ok: false, status: "unattempted", html: "", url };
  for (let i = 0; i < attempts; i++) {
    res = await fetchHtml(url, { timeout: 20000 });
    if (res.ok || String(res.status) === "403") return res;
    await sleep(1200 * (i + 1));
  }
  return res;
}

function configuratorLinks(html, pageUrl, origin) {
  const scored = [];
  const re = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = normUrl(m[1], pageUrl);
    if (!href) continue;
    // A configurator often lives on a subdomain or a vendor-hosted domain
    // (configurator.acme.de, acme.roomle.com), so same-origin is not required -- but the
    // registrable domain must still relate to the company or to a known platform.
    const text = stripTags(m[2]).replace(/\s+/g, " ").trim().slice(0, 80);
    const score = scoreConfiguratorLink(href, text);
    if (!score) continue;
    let sameOrg = href.startsWith(origin);
    try { sameOrg = sameOrg || registrable(new URL(href).hostname) === registrable(new URL(origin).hostname); } catch { /* keep */ }
    scored.push({ url: href.replace(/#.*$/, ""), text, score: sameOrg ? score : Math.round(score * 0.8) });
  }
  const best = new Map();
  for (const s of scored) if (!best.has(s.url) || best.get(s.url).score < s.score) best.set(s.url, s);
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}

console.log(`Verifying ${candidates.length} candidate companies...`);
let done = 0;

const rows = await mapPool(candidates, 6, async (c) => {
  const home = await fetchRetry(c.website);
  const blocked = String(home.status) === "403";
  const out = {
    ...c,
    verified: home.ok,
    blocked,
    http_status: String(home.status),
    resolved_website: home.ok ? home.url : null,
    page_title: null,
    description: null,
    phone: null,
    email: null,
    is_vendor: false,
    platforms: [],
    platform_source: null,
    configurator_url: null,
    configurator_score: 0,
    country_source: null,
    configurator_candidates: [],
  };

  if (home.ok) {
    const origin = new URL(home.url).origin;
    out.page_title = titleOf(home.html);
    out.description = metaDescription(home.html);
    out.phone = firstPhone(home.html);
    out.email = extractEmails(home.html).find((e) => e.endsWith(`@${c.domain}`) || e.includes(c.domain.split(".")[0])) ?? null;

    const blurb = `${out.page_title ?? ""} ${out.description ?? ""}`;
    out.is_vendor = VENDOR_SELF_DESCRIPTION.test(blurb) || VENDOR_SELF_DESCRIPTION.test(stripTags(home.html).slice(0, 6000));

    const homePlatforms = detectPlatforms(home.html);
    let links = configuratorLinks(home.html, home.url, origin);

    if (!links.length) {
      const hits = await mapPool(CONFIG_PROBE, 5, async (p) => {
        const r = await fetchHtml(origin + p, { timeout: 12000 });
        return r.ok && r.html.length > 1500 ? r.url : null;
      });
      links = [...new Set(hits.filter(Boolean))].map((u) => ({ url: u, text: "(probed)", score: 55 }));
    }

    out.configurator_candidates = links.map((l) => ({ url: l.url, text: l.text, score: l.score }));

    // Confirm the best candidate actually loads, and read the platform off the page that
    // is running it. This is the evidence that outranks everything else.
    for (const cand of links.slice(0, 2)) {
      const page = await fetchHtml(cand.url, { timeout: 20000 });
      if (!page.ok) continue;
      const p = detectPlatforms(page.html);
      out.configurator_url = page.url;
      out.configurator_score = cand.score;
      if (p.length) { out.platforms = p; out.platform_source = "configurator page"; break; }
      if (!out.platforms.length && homePlatforms.length) { out.platforms = homePlatforms; out.platform_source = "homepage"; }
      break;
    }
    if (!out.platforms.length && homePlatforms.length) { out.platforms = homePlatforms; out.platform_source = "homepage"; }
    if (!out.platforms.length) { out.platforms = c.vendors.slice(0, 3); out.platform_source = "vendor reference page"; }

    const [country, code, how] = inferCountry({ domain: c.domain, phone: out.phone, html: home.html });
    if (country) { out.country = country; out.country_code = code; out.country_source = how; }
  }

  if (++done % 40 === 0) console.log(`  ${done}/${candidates.length}`);
  return out;
});

fs.writeFileSync(
  path.join(DATA, "verified_prospects.json"),
  JSON.stringify({ checked_at: new Date().toISOString(), count: rows.length, prospects: rows }, null, 2),
);

const live = rows.filter((r) => r.verified || r.blocked);
const prospects = live.filter((r) => !r.is_vendor);
console.log(`\n${live.length}/${rows.length} sites live (${rows.filter((r) => r.blocked).length} blocked but real)`);
console.log(`${live.length - prospects.length} reclassified as configurator vendors, not prospects`);
console.log(`${prospects.filter((r) => r.configurator_url).length}/${prospects.length} prospects have a configurator URL`);
console.log(`${prospects.filter((r) => r.platform_source === "configurator page").length} platforms confirmed from the configurator page itself`);
console.log(`${prospects.filter((r) => r.phone).length} with a phone, ${prospects.filter((r) => r.email).length} with an email on the homepage`);

const byCountry = {};
for (const r of prospects) byCountry[r.country ?? "(unknown)"] = (byCountry[r.country ?? "(unknown)"] ?? 0) + 1;
console.log("\nby country:", Object.fromEntries(Object.entries(byCountry).sort((a, b) => b[1] - a[1])));

const byPlatform = {};
for (const r of prospects) for (const p of r.platforms) byPlatform[p] = (byPlatform[p] ?? 0) + 1;
console.log("\nby detected platform:", Object.fromEntries(Object.entries(byPlatform).sort((a, b) => b[1] - a[1]).slice(0, 30)));
