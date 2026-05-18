// Shared helpers for parsing SCB Företagsregistret exports (pre-extracted to JSON).
// Used by scripts/enrich-from-scb.mjs and scripts/import-scb-shops.mjs.
// Convert the xlsx with: pnpm exec tsx scripts/lib/scb-xlsx-to-json.ts <xlsx> <out.json>
// (or any tool — the JSON is a plain array of rows keyed by SCB Swedish column names.)

import { readFileSync } from "fs";

const REKLAM_OPT_OUT = /frånsagt sig reklam/i;
const REKLAM_NIX = /nix|telefonspärr/i;

const SIZE_BAND = {
  "0 anställda": "0",
  "1-4 anställda": "1-4",
  "5-9 anställda": "5-9",
  "10-19 anställda": "10-19",
  "20-49 anställda": "20-49",
  "50-99 anställda": "50-99",
  "100-199 anställda": "100-199",
  "200-499 anställda": "200-499",
  "500+ anställda": "500+",
};

function clean(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t === "" ? null : t;
}

function normalize(s) {
  if (!s) return null;
  return String(s).toLowerCase().trim();
}

function domainFromEmail(email) {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase().trim();
  return d || null;
}

function digits(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  return d || null;
}

function titleCase(s) {
  if (!s) return s;
  // Swedish company names in SCB are sometimes all-caps; preserve as-is unless all-caps then title-case.
  if (s === s.toUpperCase() && s.length > 3) {
    return s
      .toLowerCase()
      .split(/(\s+|-)/)
      .map((w) => (w.match(/^\s|^-/) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join("");
  }
  return s;
}

export function loadScb(jsonPath) {
  const rows = JSON.parse(readFileSync(jsonPath, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`Expected array in ${jsonPath}`);
  return rows.map(parseRow);
}

function parseRow(r) {
  const email = normalize(clean(r["E-post"]));
  const orgnr = digits(r["Organisationsnummer"]);
  const cfarnr = digits(r["CFARnr"]);
  const reklamstatus = clean(r["Reklamstatus"]) || "";
  const persondataflagga = clean(r["Persondataflagga"]) || "";
  const kontaktvarning = clean(r["Kontaktvarning"]) || "";
  const name = clean(r["Företagsnamn"]);
  const sizeRaw = clean(r["Storleksklass"]);
  const sizeBand = sizeRaw ? SIZE_BAND[sizeRaw] || sizeRaw.replace(/\s*anställda\s*/i, "").trim() : null;

  return {
    name,
    name_display: titleCase(name),
    name_norm: normalize(name),
    orgnr,
    cfarnr,
    address: clean(r["Besöksadress"]),
    address_display: titleCase(clean(r["Besöksadress"])),
    postal_code: clean(r["Besökspostnummer"]),
    city: clean(r["Besökspostort"]) || clean(r["Ort"]),
    phone: clean(r["Telefon"]),
    email,
    email_domain: domainFromEmail(email),
    sni_code: clean(r["SNI kod"]),
    sni_text: clean(r["SNI text"]),
    size_band: sizeBand,
    size_class_code: clean(r["Storleksklass kod"]),
    size_class_sme: clean(r["Storleksklass SME"]),
    legal_form: clean(r["Juridisk form"]),
    legal_form_code: clean(r["Juridisk form kod"]),
    arbetsstalle_status: clean(r["Arbetsställestatus"]),
    foretagsstatus: clean(r["Företagsstatus"]),
    reklamstatus,
    persondataflagga,
    kontaktvarning,
    marketing_opt_out: REKLAM_OPT_OUT.test(reklamstatus),
    nix_blocked:
      REKLAM_NIX.test(reklamstatus) || REKLAM_NIX.test(kontaktvarning),
    is_sole_proprietor: /fysisk person/i.test(persondataflagga) || /fysisk person/i.test(kontaktvarning),
    aregion: clean(r["ARegion"]),
    lan: clean(r["Län"]),
    lan_code: clean(r["Län kod"]),
    kommun: clean(r["Kommun"]),
    kommun_code: clean(r["Kommun kod"]),
    sektor: clean(r["Sektor"]),
    sektor_code: clean(r["Sektor kod"]),
  };
}

export function buildIndexes(rows) {
  const byName = new Map();
  const byDomain = new Map();
  const byCfar = new Map();
  for (const r of rows) {
    if (r.name_norm && !byName.has(r.name_norm)) byName.set(r.name_norm, r);
    if (r.email_domain && !byDomain.has(r.email_domain)) byDomain.set(r.email_domain, r);
    if (r.cfarnr) byCfar.set(r.cfarnr, r);
  }
  return { byName, byDomain, byCfar };
}
