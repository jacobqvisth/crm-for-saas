// Job titles worth having at a company that already runs a configurator.
//
// This is a different buying committee from the trade-association one in
// scripts/orgs/lib_org_roles.mjs. There the target was whoever speaks for the body; here
// it is whoever owns the configurator. On a manufacturer that is almost never the CEO:
// it is e-commerce, digital, marketing or product, with IT as the technical veto and
// sales as the budget. Animech's own note says a buying committee of five to eight
// people over three to nine months, so the point of the priority is to keep the people
// who can start that conversation and drop the ones who cannot.
//
// Ordered longest-first within each group so "head of e-commerce" is tested before
// "commerce" and "chief digital officer" before "digital".

// [matcher, canonical role, priority]. Lower priority survives the per-company cap.
export const PROSPECT_ROLE_RULES = [
  // --- owns the configurator, and is the single best person to reach ------------
  [/head of (e-?commerce|ecommerce|digital commerce|online)|e-?commerce (director|manager|lead|chef|leiter)|ecommerce|e-handelschef|e-handel|online[- ]?(shop )?manager|webshop manager|digital (commerce|sales) (director|manager|lead)/i, "E-commerce", 1],
  [/chief digital officer|\bcdo\b|head of digital|digital (director|manager|lead|transformation)|digitalisering(schef|sansvarig)?|leiter digitalisierung|digitaal/i, "Digital", 1],
  [/product (owner|manager|director|lead)|produktchef|produktmanager|produktansvarig|productmanager|responsable produit|product marketing/i, "Product", 2],
  [/head of marketing|marketing (director|manager|lead|chef|leiter)|marknadschef|markedschef|markkinointijohtaja|marketingleiter|directeur marketing|direttore marketing|\bcmo\b/i, "Marketing", 2],

  // --- decides and pays ---------------------------------------------------------
  [/sales (director|manager|lead)|head of sales|försäljningschef|salgschef|salgsdirektør|myyntijohtaja|vertriebsleiter|leiter vertrieb|directeur commercial|direttore commerciale|director comercial|verkoopdirecteur|\bcso\b|\bcro\b/i, "Sales", 3],
  [/chief executive|\bceo\b|managing director|verkställande direktör|\bvd\b|adm\.? direktør|administrerende direktør|toimitusjohtaja|geschäftsführer|gérant|amministratore delegato|directeur général|algemeen directeur|genel müdür/i, "CEO", 3],
  [/\bcoo\b|operations director|driftschef|betriebsleiter/i, "Operations", 5],

  // --- the technical veto -------------------------------------------------------
  [/chief technology officer|\bcto\b|technical director|teknisk chef|technischer leiter|directeur technique|direttore tecnico|teknologijohtaja|head of (it|engineering)|it-?(chef|manager|leiter|johtaja)|\bcio\b/i, "Technology", 4],
  [/\bcad\b|konstruktionsleiter|konstruktionschef|design engineer|konstrukt(ör|eur)|r&d (manager|director)|utvecklingschef|entwicklungsleiter/i, "Engineering", 4],

  // --- useful, but not the opener ------------------------------------------------
  [/communication|kommunikation|press|presse|pr manager/i, "Communications", 6],
  [/purchas|inköp|einkauf|achats|acquisti/i, "Purchasing", 6],
  [/customer (service|support|success)|kundservice|kundenservice|kundtjänst|service client/i, "Customer service", 7],
  [/\bcfo\b|finance (director|manager)|ekonomichef|finanzleiter/i, "Finance", 7],
];

// Flat list handed to extractPeople so it can find the nearest title in the window.
export const PROSPECT_TITLES = [
  "head of e-commerce", "head of ecommerce", "head of digital commerce", "head of online",
  "e-commerce director", "e-commerce manager", "ecommerce manager", "ecommerce director",
  "e-handelschef", "webshop manager", "online shop manager", "online manager",
  "chief digital officer", "head of digital", "digital director", "digital manager",
  "digital transformation", "digitaliseringschef", "leiter digitalisierung",
  "product owner", "product manager", "product director", "produktchef",
  "produktmanager", "produktansvarig", "productmanager", "responsable produit",
  "head of marketing", "marketing director", "marketing manager", "marknadschef",
  "markedschef", "markkinointijohtaja", "marketingleiter", "directeur marketing",
  "direttore marketing", "cmo",
  "sales director", "sales manager", "head of sales", "försäljningschef", "salgschef",
  "salgsdirektør", "myyntijohtaja", "vertriebsleiter", "leiter vertrieb",
  "directeur commercial", "direttore commerciale", "director comercial",
  "chief executive officer", "managing director", "verkställande direktör",
  "administrerende direktør", "toimitusjohtaja", "geschäftsführer",
  "amministratore delegato", "directeur général", "algemeen directeur", "ceo", "vd",
  "chief technology officer", "technical director", "teknisk chef",
  "technischer leiter", "directeur technique", "direttore tecnico", "cto", "cio",
  "it manager", "it-chef", "head of it", "head of engineering",
  "konstruktionsleiter", "konstruktionschef", "design engineer", "konstruktör",
  "r&d manager", "utvecklingschef", "entwicklungsleiter",
  "communications manager", "kommunikationschef", "pr manager",
  "purchasing manager", "inköpschef", "einkaufsleiter",
  "customer service manager", "kundservice", "kundenservice",
  "cfo", "finance director", "ekonomichef",
];

// Returns { role, priority }. A person with no recognisable title is kept, low priority:
// on a small manufacturer the only published address is often the one that matters.
export function prospectRoleFor(title) {
  if (!title) return { role: null, priority: 8 };
  for (const [re, role, priority] of PROSPECT_ROLE_RULES) if (re.test(title)) return { role, priority };
  return { role: null, priority: 8 };
}

// Contact and team page paths, in the languages these manufacturers write in.
export const PROSPECT_CONTACT_LINK_RE =
  /kontakt|contact|contatti|contacto|contato|kontakty|iletisim|yhteystiedot|about|om-oss|om-os|over-ons|ueber-uns|über-uns|qui-sommes|chi-siamo|sobre|team|teams|staff|personal|medarbeider|medarbejdere|medewerkers|mitarbeiter|people|management|ledning|ledelse|direktion|vorstand|geschaeftsleitung|geschäftsleitung|organisation|impressum|imprint|mentions-legales|legal-notice|presse|press/i;
