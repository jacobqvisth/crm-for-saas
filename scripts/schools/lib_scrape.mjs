// HTML fetching and person/inriktning extraction for school websites.
//
// School sites are mostly municipal CMSes. Measured on a 20-school sample: a homepage
// almost always yields exactly one generic address (kontakt@kommun.se) and named staff
// only ever live one click away, on /kontakt, /personal, /medarbetare or the programme
// page. So every site is crawled two levels deep and no further.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/gi;

// Assets and tracking ids routinely match the email shape; drop them.
const EMAIL_JUNK = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico)$/i;
const EMAIL_JUNK_DOMAIN = /(sentry|wixpress|example|sentry\.io|\.png|godaddy|w3\.org|schema\.org sentry)/i;

export function normUrl(u, base = null) {
  if (!u) return null;
  let s = String(u).trim();
  if (s.startsWith("mailto:") || s.startsWith("tel:") || s.startsWith("#") || s.startsWith("javascript:")) return null;
  try {
    if (base) return new URL(s, base).toString();
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    return new URL(s).toString();
  } catch { return null; }
}

export async function fetchHtml(url, { timeout = 15000 } = {}) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "sv-SE,sv;q=0.9", Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !/html|xml|text/i.test(ct)) return { ok: false, status: res.status, html: "", url: res.url };
    const html = await res.text();
    return { ok: true, status: res.status, html, url: res.url };
  } catch (e) {
    return { ok: false, status: `ERR:${String(e.name ?? e.message).slice(0, 24)}`, html: "", url };
  }
}

export function stripTags(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&auml;/gi, "ä").replace(/&ouml;/gi, "ö").replace(/&aring;/gi, "å")
    .replace(/&Auml;/gi, "Ä").replace(/&Ouml;/gi, "Ö").replace(/&Aring;/gi, "Å")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function extractEmails(html) {
  return [...new Set((html.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/\.$/, "")))]
    .filter((e) => !EMAIL_JUNK.test(e) && !EMAIL_JUNK_DOMAIN.test(e) && e.length < 80);
}

// Swedish school job titles, longest-first so "biträdande rektor" wins over "rektor".
const TITLES = [
  "biträdande rektor", "bitr. rektor", "bitr rektor", "tf rektor", "rektor",
  "studie- och yrkesvägledare", "studie och yrkesvägledare", "syv", "studievägledare",
  "programansvarig", "programrektor", "utbildningsledare", "utbildningschef",
  "arbetslagsledare", "verkstadschef", "verksamhetschef", "skolchef", "skolledare",
  "yrkeslärare", "karaktärsämneslärare", "lärare", "instruktör", "handledare",
  "skoladministratör", "administratör", "skolassistent", "expedition", "reception",
  "kurator", "specialpedagog", "mentor", "praktiksamordnare", "apl-samordnare",
];
const TITLE_RE = new RegExp(`(${TITLES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i");

// A Swedish personal name: two or three capitalised words, allowing å/ä/ö and hyphens.
const NAME_RE = /\b([A-ZÅÄÖ][a-zåäöéü]{1,20}(?:-[A-ZÅÄÖ][a-zåäöéü]{1,20})?)\s+([A-ZÅÄÖ][a-zåäöéü]{1,20}(?:-[A-ZÅÄÖ][a-zåäöéü]{1,20})?)(?:\s+([A-ZÅÄÖ][a-zåäöéü]{1,20}))?\b/g;

// Words that look like names by shape but never are, in this context.
const NOT_A_NAME = /^(Vara|Våra|Till|Här|Mer|Läs|Om|För|Den|Det|Vi|Du|Alla|Sök|Kontakta|Kontakt|Mejl|Telefon|Besök|Postadress|Nästa|Före|Efter|Ansök|Anmäl|Skicka|Cookie|Cookies|Integritet|Nyheter|Aktuellt|Start|Hem|Meny|Stäng|Öppna|Läsår|Program|Gymnasiet|Gymnasieskolan|Skolan|Kommun|Kommunen|Utbildning|Elev|Elever|Lediga|Jobb|Personuppgifter|Behandling|Svenska|Engelska|Sidan|Denna|Detta|Andra|Samma|Norra|Södra|Västra|Östra)$/i;

function looksLikeName(a, b) {
  if (!a || !b) return false;
  if (NOT_A_NAME.test(a) || NOT_A_NAME.test(b)) return false;
  if (a.length < 2 || b.length < 2) return false;
  return true;
}

// Strip a leading/trailing job title that got swept into a name ("Rektor Erika",
// "Samuelsson Rektor") before the name is considered at all.
const TITLE_WORD = /^(rektor|bitr\.?|biträdande|tf|yrkeslärare|lärare|mentor|kurator|syv|studievägledare|expedition|reception|administratör|skoladministratör|specialpedagog|programansvarig|programrektor|utbildningsledare|utbildningschef|verksamhetschef|skolchef|arbetslagsledare|verkstadschef|instruktör|handledare|teknikprogrammet|vuxenutbildning|resultatenhetschef)$/i;

function trimTitleWords(tokens) {
  const out = [...tokens];
  while (out.length && TITLE_WORD.test(out[0])) out.shift();
  while (out.length && TITLE_WORD.test(out[out.length - 1])) out.pop();
  return out;
}

// Fold Swedish characters the way an email local part does, so a scraped name can be
// checked against the address: "Östling" -> "ostling", "Anne-Maj" -> "annemaj".
export function foldForEmail(s) {
  return String(s).toLowerCase()
    .replace(/å|ä|à|á/g, "a").replace(/ö|ø|ó|ò/g, "o").replace(/é|è|ê/g, "e")
    .replace(/ü|ú/g, "u").replace(/[^a-z]/g, "");
}

// Does a scraped name actually belong to this address? Staff directories list many
// people in a row, so a name lifted from the markup near a mailto link is frequently
// the PREVIOUS person's. Requiring the name to appear in the local part removes that
// whole class of error -- measured on the first crawl, names like "Anne-Maj Videnord"
// were being attached to petra.smith@uppsala.se.
export function nameMatchesEmail(name, email) {
  if (!name || !email) return false;
  const local = foldForEmail(email.split("@")[0]);
  if (!local) return false;
  const parts = String(name).split(/\s+/).map(foldForEmail).filter((p) => p.length >= 2);
  if (parts.length < 2) return false;
  // Both the given name and the family name must be present in the local part.
  return parts.filter((p) => local.includes(p)).length >= 2;
}

// Pull person records out of a page by anchoring on each mailto: link.
//
// Confidence order for the name:
//   1. the link text itself, when it is a name ("<a href=mailto:..>Erika Östling</a>")
//   2. a name in the tight surrounding window that the email local part corroborates
// Anything else is left null and filled from the address at import time.
export function extractPeople(html, pageUrl, contexts = null) {
  const people = new Map();
  const re = /<a[^>]*href\s*=\s*["']mailto:([^"'?>\s]+)[^>]*>([\s\S]{0,200}?)<\/a>|mailto:([^"'?>\s]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] ?? m[3];
    const email = decodeURIComponent(raw).toLowerCase().trim().replace(/[.,;]$/, "");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || EMAIL_JUNK.test(email)) continue;

    const linkText = m[2] ? stripTags(m[2]).trim() : "";
    // Tight windows. The first crawl used 700 chars back and reliably crossed into the
    // neighbouring person's record in staff tables.
    const before = stripTags(html.slice(Math.max(0, m.index - 260), m.index));
    const after = stripTags(html.slice(m.index, Math.min(html.length, m.index + 160)));
    const ctx = `${before}\n${after}`;
    if (contexts) contexts.push({ email, page: pageUrl, link_text: linkText.slice(0, 120), ctx: ctx.slice(0, 700) });

    let name = null;
    // 1. Link text is a name.
    const ltTokens = trimTitleWords(linkText.split(/[\s,|·—–]+/).filter(Boolean));
    if (ltTokens.length >= 2 && looksLikeName(ltTokens[0], ltTokens[1]) && !/@/.test(linkText)) {
      name = ltTokens.slice(0, 2).join(" ");
    }
    // 2. Otherwise a corroborated name from the window.
    if (!name) {
      NAME_RE.lastIndex = 0;
      const found = [];
      let n;
      while ((n = NAME_RE.exec(ctx)) !== null) found.push(n);
      for (const cand of found.reverse()) {
        const toks = trimTitleWords([cand[1], cand[2], cand[3]].filter(Boolean));
        if (toks.length < 2 || !looksLikeName(toks[0], toks[1])) continue;
        const joined = toks.slice(0, 2).join(" ");
        if (nameMatchesEmail(joined, email)) { name = joined; break; }
      }
    }
    // Corroboration is required unconditionally, including for link text. Without this
    // a role mailbox picks up whatever its link said: arbetsutskottet@svalov.se became
    // "Kommunstyrelsens arbetsu" and btkemi-info@svalov.se became "BT Kemi".
    if (name && !nameMatchesEmail(name, email)) name = null;

    // Title: the closest title word to the link, within the tight window only.
    let title = null;
    let bestDist = Infinity;
    for (const t of TITLES) {
      const i = ctx.toLowerCase().lastIndexOf(t);
      if (i === -1) continue;
      const dist = Math.abs(i - before.length);
      if (dist < bestDist) { bestDist = dist; title = t; }
    }

    const prev = people.get(email);
    const rec = {
      email,
      name: name ?? prev?.name ?? null,
      title: title ?? prev?.title ?? null,
      source_url: prev?.source_url ?? pageUrl,
    };
    if (!prev || (!prev.name && rec.name) || (!prev.title && rec.title)) people.set(email, rec);
  }
  return [...people.values()];
}

// FT25 inriktningar as named in Skolverket's programme structure. Skolverket's API does
// not expose which ones a school actually runs, so they are read off the school's own
// programme page instead.
const ORIENTATIONS = [
  ["personbil", /personbil(?!sförare)|personbilsteknik|personbilsmekaniker/i],
  ["lastbil och mobila maskiner", /lastbil och mobila maskiner|mobila maskiner|lastbilsteknik|maskinteknik.{0,20}lastbil/i],
  ["karosseri och lackering", /karosseri|lackering|billack|skadeteknik/i],
  ["transport", /\btransport(?!program|styrelsen)/i],
  ["godshantering", /godshantering/i],
];

export function extractOrientations(text) {
  const out = [];
  for (const [name, re] of ORIENTATIONS) if (re.test(text)) out.push(name);
  return out;
}

export const CONTACT_LINK_RE = /kontakt|personal|medarbetare|anstalld|anställd|l[aä]rare|om-oss|om_oss|omoss|sok-personal|hitta-personal|vara-larare|ledning|expedition/i;
export const PROGRAM_LINK_RE = /fordon|transportprogram|ft-program|yrkesprogram|vara-program|våra-program|program/i;

export function pickLinks(html, baseUrl) {
  const hrefs = [...new Set([...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
  const contact = [];
  const program = [];
  for (const h of hrefs) {
    const abs = normUrl(h, baseUrl);
    if (!abs) continue;
    let host;
    try { host = new URL(abs).host; } catch { continue; }
    // Stay on the school's own host (or its municipality parent) to avoid crawling out.
    const baseHost = new URL(baseUrl).host;
    const sameSite = host === baseHost
      || host.endsWith(`.${baseHost.replace(/^www\./, "")}`)
      || baseHost.endsWith(`.${host.replace(/^www\./, "")}`);
    if (!sameSite) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|zip|docx?|xlsx?|pptx?)$/i.test(abs)) continue;
    if (/fordon/i.test(abs)) program.unshift(abs);
    else if (PROGRAM_LINK_RE.test(abs)) program.push(abs);
    if (CONTACT_LINK_RE.test(abs)) contact.push(abs);
  }
  return {
    contact: [...new Set(contact)].slice(0, 6),
    program: [...new Set(program)].slice(0, 4),
  };
}
