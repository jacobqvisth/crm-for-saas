// Normalize raw brreg `underenhet` records into the shape consumed by import-brreg-no-shops.mjs.
//
// brreg field reference (abbreviated underenhet payload):
//   organisasjonsnummer, navn, organisasjonsform.{kode}, registreringsdatoEnhetsregisteret,
//   naeringskode1.{kode,beskrivelse}, antallAnsatte, overordnetEnhet,
//   epostadresse, telefon, mobil, hjemmeside, oppstartsdato,
//   beliggenhetsadresse.{land, landkode, postnummer, poststed, adresse[], kommune, kommunenummer},
//   postadresse.{...}, slettedato, underAvvikling

import { readFileSync } from "fs";

// Norwegian + global personal email domains (informational tag, not a drop signal)
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.no", "live.no", "live.com", "outlook.com",
  "yahoo.no", "yahoo.com", "icloud.com", "me.com",
  "online.no", "frisurf.no", "c2i.net", "start.no", "broadpark.no",
  "getmail.no", "lyse.net", "bbnett.no", "altibox.no",
]);

// Parent-org → chain mapping (from 2026-05-21 survey of brreg dataset).
// `out_of_icp: true` means all underenheter under this parent are excluded at import.
const PARENT_CHAIN_MAP = {
  "985758220": { chain: "carglass", out_of_icp: true, reason: "auto glass" },
  "879263662": { chain: "scania", out_of_icp: true, reason: "truck/heavy" },
  "826342552": { chain: "bertel-o-steen-lb", out_of_icp: true, reason: "truck/heavy" },
  "987554282": { chain: "trucknor", out_of_icp: true, reason: "truck/heavy" },
  "979463332": { chain: "nordic-last-buss", out_of_icp: true, reason: "truck/heavy" },
  // Chain tags (in-ICP)
  "920377068": { chain: "meko-group" },                // Mekonomen/MECA/BilXtra/Fixus parent
  "987372540": { chain: "naf-senter" },
  "971585188": { chain: "snap-drive" },
  "946930342": { chain: "team-verksted" },
  "880252372": { chain: "werksta" },
  "997433173": { chain: "tesla-bodyshop" },
  "946549770": { chain: "nordvik" },
  "976023188": { chain: "bilia" },
  "960804953": { chain: "hedin-bmw" },
  "921979436": { chain: "riis-montasje" },
  "983666280": { chain: "bil-i-nord" },
  "977047684": { chain: "kverneland-bil" },
  "921679610": { chain: "yes-eu" },
  "958315120": { chain: "wist" },
  "975933601": { chain: "bil-service" },
};

const norwegianize = (s) => (s || "").trim().toLowerCase();

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 8) return `+47${digits}`;       // domestic 8-digit
  if (digits.length === 10 && digits.startsWith("47")) return `+${digits}`;
  if (digits.startsWith("47") && digits.length >= 10) return `+${digits}`;
  return raw; // fallback
}

function titleCaseNo(s) {
  if (!s) return s;
  // brreg returns most names in SHOUTY UPPERCASE. Title-case unless they have an apostrophe
  // or are obviously an acronym (AS, ASA, ANS, ENK).
  const small = new Set(["og", "i", "av", "for", "til", "på"]);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, idx) => {
      const u = w.toUpperCase();
      // preserve org-form suffixes uppercase
      if (["AS", "ASA", "ANS", "ENK", "DA", "AB"].includes(u)) return u;
      // small words mid-name lowercase
      if (idx > 0 && small.has(w)) return w;
      // capitalize first letter, keeping rest as-is
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

export function parseBrreg(r) {
  const orgnr = r.organisasjonsnummer;
  const parent = r.overordnetEnhet || null;
  const name = r.navn || "";
  const email = r.epostadresse ? r.epostadresse.toLowerCase().trim() : null;
  const emailDomain = email ? (email.match(/@([^\s>]+)/)?.[1] || null) : null;
  const isPersonalEmail = emailDomain ? PERSONAL_EMAIL_DOMAINS.has(emailDomain) : false;

  const addr = r.beliggenhetsadresse || r.postadresse || {};
  const address = Array.isArray(addr.adresse) ? addr.adresse.filter(Boolean).join(", ") : null;

  const phoneRaw = r.telefon || null;
  const mobilRaw = r.mobil || null;
  const phone = normalizePhone(phoneRaw || mobilRaw);

  const chainTag = parent && PARENT_CHAIN_MAP[parent] ? PARENT_CHAIN_MAP[parent].chain : null;
  const outOfIcp = !!(parent && PARENT_CHAIN_MAP[parent]?.out_of_icp);
  const exclusionReason = outOfIcp ? PARENT_CHAIN_MAP[parent].reason : null;

  return {
    orgnr,
    parent_orgnr: parent,
    name,
    name_norm: norwegianize(name),
    name_display: titleCaseNo(name),
    email,
    email_domain: emailDomain,
    is_personal_email: isPersonalEmail,
    phone,
    mobile: normalizePhone(mobilRaw),
    website: r.hjemmeside || null,
    address,
    postal_code: addr.postnummer || null,
    city: addr.poststed || null,
    kommune: addr.kommune || null,
    kommune_code: addr.kommunenummer || null,
    chain: chainTag,
    out_of_icp: outOfIcp,
    exclusion_reason: exclusionReason,
    started_at: r.registreringsdatoEnhetsregisteret || null,
    operational_start: r.oppstartsdato || null,
    org_form: r.organisasjonsform?.kode || null,
    naerings_code: r.naeringskode1?.kode || null,
    naerings_text: r.naeringskode1?.beskrivelse || null,
    slettet: !!r.slettedato,
    under_avvikling: !!r.underAvvikling,
  };
}

export function loadBrreg(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return raw.map(parseBrreg);
}

export function buildIndexes(rows) {
  const byName = new Map();
  const byDomain = new Map();
  const byOrgnr = new Map();
  const byParent = new Map();
  for (const r of rows) {
    if (r.name_norm) byName.set(r.name_norm, r);
    if (r.email_domain) byDomain.set(r.email_domain, r);
    if (r.orgnr) byOrgnr.set(r.orgnr, r);
    if (r.parent_orgnr) {
      const arr = byParent.get(r.parent_orgnr) || [];
      arr.push(r);
      byParent.set(r.parent_orgnr, arr);
    }
  }
  return { byName, byDomain, byOrgnr, byParent };
}
