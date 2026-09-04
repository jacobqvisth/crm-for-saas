// Job titles at European automotive trade associations, fairs and trade press.
//
// The schools crawl needed one language. This one spans 23 countries, so a Swedish-only
// vocabulary would find the Swedish bodies' staff and nobody else's. Each entry maps a
// local-language title to a canonical role, so the CRM shows one consistent set of roles
// regardless of which country a contact came from.
//
// Ordered longest-first within each group: "vice verkställande direktör" has to be tested
// before "verkställande direktör", and "hauptgeschäftsführer" before "geschäftsführer".

// [matcher, canonical role, priority]. Priority drives who survives the per-org cap:
// the people who decide, then the people who speak for the body, then the rest.
export const ORG_ROLE_RULES = [
  // --- top of the house -------------------------------------------------------
  [/hauptgeschäftsführer|generalsekreterare|generalsekretær|generalsekretaer|secretary[- ]general|secrétaire général|segretario generale|secretario general|secretaris-generaal|pääsihteeri/i, "Generalsekreterare", 1],
  [/verkställande direktör|\bvd\b|adm\.? direktør|administrerende direktør|toimitusjohtaja|chief executive|\bceo\b|managing director|director general|directeur général|direttore generale|directeur-generaal|geschäftsführer|dyrektor generalny|genel müdür/i, "VD", 1],
  [/förbundsdirektör|forbundsdirektør|branschchef|kanslichef|head of office|office manager|bureauchef/i, "Kanslichef", 1],
  [/ordförande|formand|formann|puheenjohtaja|président|presidente|presidente|voorzitter|präsident|chairman|chairwoman|\bchair\b|prezes|başkan/i, "Ordförande", 2],
  [/vice vd|deputy (chief|director|secretary)|vice[- ]?president|stellvertretender|adjoint|vicepresidente/i, "Vice VD", 2],

  // --- the ones who answer a cold email ---------------------------------------
  [/kommunikationschef|kommunikasjonssjef|kommunikationsdirektør|head of communication|communications manager|responsable communication|pressesprecher|presschef|press officer|pressekontakt|presskontakt|viestintäpäällikkö|woordvoerder|addetto stampa/i, "Kommunikationschef", 3],
  [/public affairs|näringspolitisk|samfundskontakt|policy (director|manager|officer|adviser|advisor)|policy|lobby|regulatory affairs|referent/i, "Public affairs", 3],
  [/teknisk chef|technical (director|manager|officer)|technischer leiter|directeur technique|direttore tecnico|director técnico|tekninen johtaja|fagsjef|teknisk rådgivare/i, "Teknisk chef", 3],
  [/utbildningsansvarig|utbildningschef|head of training|training manager|responsable formation|bildungsreferent|opleiding/i, "Utbildningsansvarig", 3],
  [/branschutvecklare|business development|affärsutvecklare|market(ing)? (director|manager)|marknadschef|marketingleiter/i, "Affärsutveckling", 4],
  [/medlemsansvarig|membership|medlemschef|mitgliederservice/i, "Medlemsansvarig", 4],

  // --- media and events --------------------------------------------------------
  [/chefredaktör|chefredaktør|editor[- ]in[- ]chief|redaktionschef|chefredakteur|rédacteur en chef|direttore responsabile|hoofdredacteur|päätoimittaja/i, "Chefredaktör", 2],
  [/redaktör|redaktør|\beditor\b|redakteur|journalist|reporter|toimittaja/i, "Redaktör", 4],
  [/mässansvarig|show director|event (director|manager)|projektledare|project manager|messeleiter|directeur du salon|exhibition manager/i, "Mässansvarig", 3],
  [/utställarkontakt|sales manager|försäljningschef|salgschef|vertrieb|commercial(e)? (director|manager)/i, "Försäljning", 4],

  // --- everything else ---------------------------------------------------------
  [/ekonomichef|\bcfo\b|finance (director|manager)|finanzen/i, "Ekonomichef", 5],
  [/jurist|legal counsel|rättslig|justitiar|advokat/i, "Jurist", 5],
  [/assistent|sekreterare|sekretær|receptionist|kontor|office/i, "Assistent", 6],
];

// Flat list handed to extractPeople so it can find the nearest title in the window.
export const ORG_TITLES = [
  "hauptgeschäftsführer", "generalsekreterare", "generalsekretær", "secretary general",
  "secrétaire général", "segretario generale", "secretario general", "pääsihteeri",
  "verkställande direktör", "administrerende direktør", "adm. direktør", "toimitusjohtaja",
  "chief executive officer", "chief executive", "managing director", "director general",
  "directeur général", "direttore generale", "geschäftsführer", "genel müdür", "ceo",
  "förbundsdirektör", "kanslichef", "branschchef",
  "ordförande", "formand", "formann", "puheenjohtaja", "président", "presidente",
  "voorzitter", "präsident", "chairman", "chair", "prezes", "başkan",
  "vice vd", "vice president", "vicepresidente", "stellvertretender",
  "kommunikationschef", "kommunikasjonssjef", "communications manager",
  "head of communications", "responsable communication", "pressesprecher",
  "presschef", "press officer", "pressekontakt", "presskontakt", "viestintäpäällikkö",
  "woordvoerder", "public affairs", "näringspolitisk", "policy manager",
  "policy officer", "policy director", "regulatory affairs", "referent",
  "teknisk chef", "technical director", "technical manager", "technischer leiter",
  "directeur technique", "direttore tecnico", "director técnico", "fagsjef",
  "utbildningsansvarig", "utbildningschef", "training manager", "head of training",
  "branschutvecklare", "affärsutvecklare", "business development", "marknadschef",
  "marketing manager", "medlemsansvarig", "membership manager",
  "chefredaktör", "chefredaktør", "editor-in-chief", "chefredakteur",
  "rédacteur en chef", "hoofdredacteur", "päätoimittaja", "redaktör", "editor",
  "journalist", "reporter",
  "mässansvarig", "show director", "event manager", "event director", "projektledare",
  "project manager", "exhibition manager",
  "försäljningschef", "sales manager", "salgschef",
  "ekonomichef", "cfo", "finance director", "jurist", "legal counsel",
  "assistent", "sekreterare", "receptionist",
];

// Returns { role, priority } or null when the title is one we deliberately skip.
export function orgRoleFor(title) {
  if (!title) return { role: null, priority: 7 };
  for (const [re, role, priority] of ORG_ROLE_RULES) if (re.test(title)) return { role, priority };
  return { role: null, priority: 7 };
}

// Contact-ish page paths in the languages these sites are written in.
export const ORG_CONTACT_LINK_RE =
  /kontakt|contact|contatti|contacto|contato|kontakty|iletisim|yhteystiedot|about|om-oss|over-ons|ueber-uns|über-uns|qui-sommes|chi-siamo|team|staff|personal|medarbeider|medewerkers|mitarbeiter|people|organisation|organization|styrelse|board|bestyrelse|vorstand|direction|presse|press|media|impressum|imprint|mentions-legales/i;
