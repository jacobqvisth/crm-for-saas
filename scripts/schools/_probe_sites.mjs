// Probe: how much contact data can actually be scraped off school websites?
// Fetches a sample of homepages, reports reachability and what a naive mailto/name
// extraction finds, so the real scraper is built against measured yield rather than hope.
import fs from "node:fs";
import path from "node:path";

const DATA = path.join(import.meta.dirname, "data");
const schools = JSON.parse(fs.readFileSync(path.join(DATA, "gymnasium.json"), "utf8")).schools;
const sample = schools.slice(0, 20);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function normUrl(u) {
  if (!u) return null;
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

for (const s of sample) {
  const url = normUrl(s.website);
  let status = "?";
  let html = "";
  try {
    const ctl = AbortSignal.timeout(15000);
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "sv" }, signal: ctl, redirect: "follow" });
    status = r.status;
    html = await r.text();
  } catch (e) {
    status = `ERR ${String(e.message).slice(0, 30)}`;
  }
  const emails = [...new Set((html.match(EMAIL) ?? []).map((e) => e.toLowerCase()))]
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e));
  // Links that look like they lead to staff / programme pages.
  const links = [...new Set([...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]))]
    .filter((h) => /kontakt|personal|medarbetare|larare|lärare|fordon|program|om-oss|sok-personal/i.test(h))
    .slice(0, 6);
  console.log(`\n${s.name} -> ${url}`);
  console.log(`  status=${status} bytes=${html.length} emails=${emails.length} ${emails.slice(0, 4).join(", ")}`);
  console.log(`  candidate links: ${links.slice(0, 4).join(" | ")}`);
}
