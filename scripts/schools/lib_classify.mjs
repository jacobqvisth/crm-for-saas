// Decide whether an education programme title is about vehicles, and how close it is
// to the workshop trade Wrenchlane sells into.
//
// Tiers:
//   core      cars/vans: repair, service, diagnostics, bodywork, paint, electrics
//   adjacent  other powered machines: trucks, plant, marine, air, rail
//   transport driving and logistics roles that share the FT25 programme but never
//             touch a spanner
//
// The Swedish keyword space is full of false friends, so the negative list runs first:
//   motorik / motorisk     -> motor skills (child development, physiotherapy)
//   motorsåg               -> chainsaw (forestry)
//   bilddiagnostik         -> medical imaging ("bild" = image, not "bil" = car)
//   däcksbefäl / däckspersonal -> a ship's deck, not a tyre
//   mobil / stabil / bibliotek  -> substrings that contain "bil"
// Everything is matched on a normalised lowercase string with explicit compounds
// rather than bare stems, because bare "bil", "motor", "verkstad" and "diagnostik"
// each pull in large amounts of unrelated coursework.

const NEGATIVE = [
  /motori[sk]/, /motorik/, /motorisk/, /motorsåg/, /motorredskap\s*för\s*skog/,
  /bilddiagnostik/, /bildanalys/, /bildbehandling/, /bildkonst/, /bildlärare/,
  /däcksbefäl/, /däckspersonal/, /fartygsbefäl/, /däcksman/,
  /mobilapp/, /mobilutveckl/, /automobilhistor/,
  /biblioteks?/, /stabilitet/, /rehabilit/,
];

// [pattern, tier, human-readable reason]
//
// Order matters: the specific non-car vehicle families are tested FIRST, because
// "Spårfordonsteknik" and "Flygmotorteknik" both contain car-shaped stems
// ("fordonstekn", "motortekni") and would otherwise be mis-tiered as core.
const RULES = [
  // --- adjacent, matched first to win the stem collision ------------------------
  [/spårfordon|tågtekni|tågmekanik|järnvägstekni|lokförar|bantekniker/, "adjacent", "spårfordon"],
  [/flygtekni|flygmekanik|flygmotor|flygunderhåll/, "adjacent", "flygteknik"],
  [/marintekni|båtmekanik|marinmekanik|marinmotor|båttekni/, "adjacent", "marinteknik"],
  [/lastbilsmekanik|tunga\s*fordon|tungt?\s*fordon|lastbilstekni|bussmekanik|busstekniker/, "adjacent", "tunga fordon"],
  [/fordonsdesign|fordonskonceptdesign/, "adjacent", "fordonsdesign"],
  [/maskinmekanik|maskintekniker|entreprenadmaskin|anläggningsmaskin|arbetsmaskin|mobila\s*arbetsmaskin/, "adjacent", "maskiner"],
  [/lantbruksmaskin|skogsmaskin|traktor/, "adjacent", "lantbruks- och skogsmaskiner"],

  // --- core: cars and light vehicles -------------------------------------------
  [/fordonstekn|fordonsmekan|fordonsingenjör|fordonselektr|fordonselektron/, "core", "fordonsteknik"],
  [/fordonsvård|fordonsservice|fordonsreparat|fordonsanalys|fordonsdiagnos/, "core", "fordonsservice"],
  // "fordons-" catches the hyphenated compound in e.g. "Komvuxarbete fordons- och
  // transportprogrammet", which a \bfordon\b boundary misses.
  [/\bfordons?\b|fordons-|fordonsbransch|fordonsprogram|fordonsutbildning/, "core", "fordon"],
  // "bilsmekaniker" is the join in "personbilsmekaniker" -- the single most on-target
  // title in the whole dataset, and "bilmekanik" alone does not match it.
  [/bilmekanik|bilsmekanik|billmekanik|bilteknik|biltekniker|bilelektr|bilservice|bilreparat/, "core", "bilteknik"],
  [/bilskad|karosser|billack|bilplåt|plåt\s*och\s*lack|lackerare|billackering/, "core", "karosseri och lack"],
  [/bilvård|rekonditioner|bildemonter|bildelar|reservdel/, "core", "bilvård och delar"],
  [/däckverkstad|däcktekniker|hjulinställn|däckmontör/, "core", "däck"],
  // "transmissionsteknik" on its own is telecom ("Trådlös transmissionsteknik"), so
  // the drivetrain sense has to be spelled out.
  [/motorbransch|motortekni|förbränningsmotor|drivlina|växellåd|fordonstransmission/, "core", "motorteknik"],
  [/elbil|elfordon|laddinfrastruktur|laddstation|hybridfordon|högvoltstekni/, "core", "elektrifierade fordon"],
  [/motorcykel|mc-mekanik|mopedmekanik|fritidsfordon|husvagn|husbil/, "core", "MC och fritidsfordon"],
  [/servicetekniker\s*(fordon|bil|motor)/, "core", "servicetekniker fordon"],

  // --- transport: driving and logistics ----------------------------------------
  [/yrkesförare|lastbilsförare|bussförare|taxiförare|godstransport/, "transport", "yrkesförare"],
  [/transportledare|transportlogistik|transportplaner|åkeri|speditör|spedition/, "transport", "transportledning"],
  [/\blogistiker|logistikutveckl|logistiksamordn|lagerlogistik|logistikplaner/, "transport", "logistik"],
  [/truckförare|truckutbildn|terminalarbet|godshanter/, "transport", "gods och terminal"],
  [/maskinförare|hjullastarförare|grävmaskinförare|kranförare/, "transport", "maskin- och kranförare"],
];

export function normalise(s) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Returns { tier, reason } — tier is null when the title is not vehicle-related.
export function classify(title, extra = "") {
  const text = normalise(`${title} ${extra}`);
  if (!text) return { tier: null, reason: null };
  for (const n of NEGATIVE) if (n.test(text)) return { tier: null, reason: null };
  for (const [re, tier, reason] of RULES) if (re.test(text)) return { tier, reason };
  return { tier: null, reason: null };
}

export const TIER_ORDER = { core: 0, adjacent: 1, transport: 2 };
