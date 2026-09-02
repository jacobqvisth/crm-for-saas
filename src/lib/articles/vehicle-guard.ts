// A deterministic check that an article does not name a vehicle we never had.
//
// WHY THIS EXISTS RATHER THAN JUST A BETTER PROMPT
// On 2026-09-01 the Autopilot published "A 2016 Ford rolled into a German
// workshop" and four paragraphs about a "2.0 EcoBlue" engine, on a diagnostic
// whose car_make and car_model were both null. The prompt already forbade
// inventing facts and the model still did it, and its own claims list did not
// flag the invention. The prompt is now fixed too, but a rule enforced only by
// the thing it constrains is not enforced at all: this runs after generation,
// in code, and cannot be talked out of it.
//
// SCOPE, deliberately narrow
// It fires only when the source data has NO manufacturer. When we do know the
// marque, an article may legitimately mention others ("this behaves differently
// on a Volvo"), and a stats story is about the whole fleet by definition. So the
// check applies to case studies with a nameless vehicle, which is exactly the
// shape that produced the bug, and is silent everywhere else.

/**
 * Marques that are unambiguous as words.
 *
 * Drawn from the manufacturers that actually appear in our diagnostics, minus
 * the ones that are ordinary English: Smart, Mini, Ram, MG, DS, Lotus, Nordic
 * and Thule would all fire on innocent prose ("a smart approach", "ram air",
 * "a mini service"). Missing an invented Smart is a far cheaper error than
 * blocking a correct article about a ram air intake, so the list is
 * deliberately incomplete in that direction.
 */
const MARQUES = [
  "Volkswagen",
  "Volvo",
  "BMW",
  "Audi",
  "Mercedes-Benz",
  "Mercedes",
  "Ford",
  "Renault",
  "Saab",
  "Peugeot",
  "Toyota",
  "Nissan",
  "Skoda",
  "Land Rover",
  "Kia",
  "Hyundai",
  "Opel",
  "Chevrolet",
  "Citroen",
  "Citroën",
  "Porsche",
  "Seat",
  "Fiat",
  "Mazda",
  "Subaru",
  "Honda",
  "Alfa Romeo",
  "Jaguar",
  "Jeep",
  "Vauxhall",
  "Dodge",
  "Dacia",
  "Mitsubishi",
  "Iveco",
  "Suzuki",
  "Tesla",
  "Polestar",
  "Lexus",
  "Isuzu",
  "Cadillac",
  "Lancia",
  "GMC",
  "Abarth",
  "Maxus",
  "SsangYong",
  "Pontiac",
  "Acura",
  "Cupra",
  "Maserati",
  "Chrysler",
  "Aixam",
  "Ferrari",
];

/**
 * Marketing engine-family names.
 *
 * These are as specific as a model name and just as inventable: "2.0 EcoBlue"
 * names a Ford engine as surely as the word Ford does. Only unambiguous strings
 * are listed, for the same reason as above.
 */
const ENGINE_FAMILIES = [
  "EcoBlue",
  "EcoBoost",
  "EcoTec",
  "BlueHDi",
  "BlueTEC",
  "SkyActiv",
  "MultiJet",
  "CRDi",
  "dCi",
  "TDI",
  "TSI",
  "TFSI",
  "HDi",
  "CDTi",
  "SIDI",
  "VTEC",
  "D-4D",
  "JTD",
  "CDI",
];

export interface VehicleGuardSnapshot {
  carMake?: string | null;
  carModel?: string | null;
}

export interface VehicleGuardInput {
  sourceKind: string | null;
  snapshot: VehicleGuardSnapshot | null;
  title: string | null;
  body: string;
}

export interface VehicleGuardResult {
  ok: boolean;
  /** The invented terms, in the order found. Empty when ok. */
  offences: string[];
  /** One line naming what went wrong, for the run log and the toast. */
  reason: string | null;
}

/** Whole-word, case-insensitive. Escaped so "Mercedes-Benz" cannot act as a range. */
function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b does not work against a trailing "ë" or a leading digit boundary the way
  // we want, so the edges are spelled out: not preceded or followed by a letter.
  const re = new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "iu");
  return re.test(haystack);
}

function present(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

/**
 * Does this article name a vehicle the source data did not have?
 *
 * Returns ok:true for everything it does not cover, so a caller can run it
 * unconditionally.
 */
export function checkVehicleClaims(input: VehicleGuardInput): VehicleGuardResult {
  const ok = { ok: true, offences: [], reason: null } as VehicleGuardResult;

  // Only case studies about one real vehicle. A stats story is about the whole
  // fleet and names marques by design.
  if (input.sourceKind !== "diagnostic") return ok;

  const haystack = `${input.title ?? ""}\n${input.body}`;
  const offences: string[] = [];

  // Knowing the marque makes naming marques legitimate, including other ones.
  if (!present(input.snapshot?.carMake)) {
    for (const marque of MARQUES) {
      if (mentions(haystack, marque)) offences.push(marque);
    }
  }

  if (!present(input.snapshot?.carModel)) {
    for (const engine of ENGINE_FAMILIES) {
      if (mentions(haystack, engine)) offences.push(engine);
    }
  }

  if (!offences.length) return ok;

  // "Mercedes-Benz" also matches "Mercedes"; report the longest form only, so
  // the message names one invention rather than appearing to find two.
  const deduped = offences.filter(
    (a) => !offences.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase())),
  );

  return {
    ok: false,
    offences: deduped,
    reason:
      `The article names ${deduped.join(", ")}, but the diagnostic behind it has no ` +
      `${present(input.snapshot?.carMake) ? "model" : "manufacturer"} recorded. ` +
      `That is an invented vehicle, so it was not published.`,
  };
}
