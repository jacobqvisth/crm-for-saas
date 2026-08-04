import type { DiagnosticListItem } from "@/lib/ceo/data/diagnostics";

/**
 * Analysis of the free-text `description` field that technicians fill in when
 * they start a diagnostic in the WrenchLane app.
 *
 * `dashboard_diagnostics.metadata->>'description'` is the ONLY free-text field
 * the core_app S3 export actually populates — the sibling `symptoms` and
 * `user_actions` arrays exist in the schema and the UI but ship empty on every
 * row, so everything on this page is derived from `description` alone.
 *
 * Text is majority Swedish (~52%) and English (~33%), with a long tail of IT /
 * DE / RO / SK / DA / BG / PL / RU / UK. Every keyword set below therefore
 * carries Swedish + English terms first and adds other languages where the
 * phrasing is common enough to matter. Buckets are deliberately MULTI-LABEL:
 * "motorlampa lyser, bilen tappar kraft" counts under both warning-lamp and
 * power-loss, so bucket counts sum to more than the entry count.
 */

export type SearchTermExample = {
  diagnosticId: string;
  text: string;
  language: string | null;
  country: string | null;
  car: string | null;
  createdAt: string | null;
};

export type SearchTermBucket = {
  key: string;
  label: string;
  hint: string;
  count: number;
  /** Share of entries that have description text (0-1). */
  share: number;
  examples: SearchTermExample[];
};

export type TermFrequency = {
  term: string;
  /** Number of distinct entries the term appears in. */
  entries: number;
  /** Total occurrences across all entries. */
  occurrences: number;
};

export type VerbatimGroup = {
  text: string;
  count: number;
  languages: string[];
};

export type LanguageBreakdown = {
  language: string;
  entries: number;
  share: number;
  avgChars: number;
  medianChars: number;
};

export type LengthBand = {
  key: string;
  label: string;
  hint: string;
  count: number;
  share: number;
};

export type MonthlyPoint = {
  month: string;
  total: number;
  described: number;
  coverage: number;
};

export type SearchTermsAnalysis = {
  totals: {
    diagnostics: number;
    described: number;
    coverage: number;
    distinctTexts: number;
    repeatedTexts: number;
    avgChars: number;
    medianChars: number;
    p90Chars: number;
    maxChars: number;
    avgWords: number;
  };
  lengthBands: LengthBand[];
  complaints: SearchTermBucket[];
  systems: SearchTermBucket[];
  phrasing: SearchTermBucket[];
  uncategorised: SearchTermBucket;
  /**
   * Of the uncategorised entries, how many are two words or fewer — i.e. text
   * that carries no complaint to recognise in the first place. The remainder is
   * the real keyword gap worth closing.
   */
  uncategorisedTooShort: number;
  languages: LanguageBreakdown[];
  verbatims: VerbatimGroup[];
  unigrams: TermFrequency[];
  bigrams: TermFrequency[];
  quotedCodes: TermFrequency[];
  monthly: MonthlyPoint[];
};

type BucketDefinition = {
  key: string;
  label: string;
  hint: string;
  patterns: string[];
};

/**
 * What the vehicle is doing wrong — the complaint, in the technician's words.
 */
const COMPLAINT_BUCKETS: BucketDefinition[] = [
  {
    key: "warning-lamp",
    label: "Warning lamp is on",
    hint: "Engine/check-engine/MIL or any dashboard lamp named as the reason for the visit.",
    patterns: [
      "motorlampa",
      "motorlampan",
      "varningslampa",
      "varningslampor",
      "lampa lyser",
      "lampan lyser",
      "lyser",
      "lampa tänd",
      "lampan tänd",
      "service erfordras",
      "servicelampan",
      "varnar",
      "indikerar",
      "check engine",
      "engine light",
      "engine management light",
      " mil on",
      " mil är",
      " mil tänd",
      " eml ",
      " eml on",
      " epc ",
      "warning light",
      "light is on",
      "light on",
      "lights on",
      "dash light",
      "service light",
      "light comes on",
      "comes up on the dash",
      "keep coming up",
      "keeps coming up",
      "flickering",
      "check vehicle",
      "check emissions",
      "motorkontrollleuchte",
      "warnleuchte",
      "leuchtet",
      " spia ",
      "spia motore",
      "martor",
      "kontrolka",
      "горит",
      "свети",
      " лампа",
    ],
  },
  {
    key: "wont-start",
    label: "Won't start / crank no start",
    hint: "Engine cranks but does not fire, or nothing happens at all.",
    patterns: [
      "startar inte",
      "startar ej",
      "startar inte alls",
      "går inte att starta",
      "går ej att starta",
      "inte att starta",
      "starta ej",
      "ingen start",
      "ej start",
      "crank no start",
      "cranks but",
      "crank but",
      "cranks and",
      "won t start",
      "wont start",
      "will not start",
      "does not start",
      "doesn t start",
      "no start",
      "not starting",
      "fails to start",
      "startet nicht",
      "springt nicht an",
      "non parte",
      "nie odpala",
      "nu porneste",
      "nu pornește",
      "не запускается",
      "не заводится",
    ],
  },
  {
    key: "hard-starting",
    label: "Hard / slow starting",
    hint: "Starts eventually, but badly — long crank, only when warm, only sometimes.",
    patterns: [
      "startar dåligt",
      "svårstartad",
      "svår att starta",
      "startar trögt",
      "startade ibland",
      "startar ibland",
      "lång startmotor",
      "hard to start",
      "hard starting",
      "difficult to start",
      "difficulty starting",
      "struggled to start",
      "struggles to start",
      "slow to start",
      "long crank",
      "cranks a long",
      "takes a while to start",
    ],
  },
  {
    key: "rough-running",
    label: "Misfire / rough running",
    hint: "Misfire, judder, shaking, uneven idle — the classic driveability complaint.",
    patterns: [
      "misständ",
      "misstand",
      "missfyr",
      "misfire",
      "misfiring",
      "hackar",
      "rycker",
      "ryck ",
      "ryckigt",
      "skakar",
      // Idle vibration reads as a misfire complaint; vibration in general is
      // counted under noise/vibration instead.
      "vibrerar på tomgång",
      "vibbrationer på tomgång",
      "ojämn",
      "ojamn",
      "går ojämnt",
      "går orent",
      "orent",
      "går dåligt",
      "går illa",
      // "roug" also catches the common "rougj" / "rouch" typos.
      "roug",
      "rough idle",
      "juddering",
      "judders",
      "stumbles",
      "shakes",
      "shaking",
      "hesitates",
      "hesitation",
      "läuft unrund",
      "telepie",
      "dziwnie chodzi",
      "pulsuje",
      "pätkii",
      "trhne",
      "saltella",
      "троит",
      "прекъсване на запалването",
    ],
  },
  {
    key: "power-loss",
    label: "Power loss / limp mode",
    hint: "Reduced performance, limp home, engine derate.",
    patterns: [
      "limp",
      "limphome",
      "nödprogram",
      "nodprogram",
      "haltprogram",
      "orkeslös",
      "orkeslos",
      "tappar kraft",
      "tappar effekt",
      "ingen kraft",
      "dålig effekt",
      "svag motor",
      "drar inte",
      "lost power",
      "loss of power",
      "lack of power",
      "low power",
      "no power when",
      "reduced power",
      "restricted performance",
      "engine performance fault",
      "derate",
      "sluggish",
      "underboost",
      "under boost",
      "doesn t boost",
      "boost properly",
      "stop accelerating",
      "won t accelerate",
      "poor performance",
      "svag motor",
      "den är svag",
      "leistungsverlust",
      "notlauf",
      "wenig leistung",
      "perde potenza",
      "non spinge",
      "non sale di giri",
      "mancata accelerazione",
      "pierde putere",
      "straciło moc",
      "straci moc",
      "потеря мощности",
    ],
  },
  {
    key: "stalls",
    label: "Stalls / cuts out while driving",
    hint: "Dies under way or at idle — the safety-critical intermittent.",
    patterns: [
      "dör ",
      "dog ",
      "dör under",
      "dog under",
      "stannar",
      "tjuvstannar",
      "slår av sig",
      "stänger av sig",
      "cuts out",
      "cut out",
      "stalls",
      "stalling",
      "shuts off",
      "shuts down",
      "dies while",
      "dies when",
      "came to a stand still",
      "geht aus",
      "si spegne",
      "se opreste",
      "гаснет",
    ],
  },
  {
    key: "warning-message",
    label: "Warning message / text in cluster",
    hint: "A named message on the display rather than just a lamp.",
    patterns: [
      "felmeddelande",
      "meddelande",
      "visar meddelande",
      "visar text",
      "text i display",
      "warning message",
      "fault message",
      "error message",
      "message on the dash",
      "displays a",
      "message appears",
      "injection fault",
      "fehlermeldung",
      "messaggio",
      "mesaj",
      "сообщение",
    ],
  },
  {
    key: "function-dead",
    label: "A function simply doesn't work",
    hint: "Component or feature inoperative — no symptom beyond \"it doesn't work\".",
    patterns: [
      "fungerar inte",
      "fungerar ej",
      "funkar inte",
      "funkar ej",
      "ur funktion",
      "slutat fungera",
      "fungerar dåligt",
      "ingen funktion",
      "not working",
      "does not work",
      "doesn t work",
      "won t work",
      "stopped working",
      "no function",
      "inoperative",
      "not functioning",
      "funktioniert nicht",
      "non funziona",
      "nie działa",
      "nie dziala",
      "nu functioneaza",
      "nu funcționează",
      "не работает",
      "не работи",
      "nedarbojas",
      "dont work",
      "är döda",
      "är död",
      "slocknade",
      "helt svart",
      "pärstāj darboties",
    ],
  },
  {
    key: "no-supply",
    label: "No power or signal at a component",
    hint: "The technician has already probed and found nothing arriving — no voltage, no ground, a short or a broken wire. Usually the most advanced entries on the list.",
    patterns: [
      "ingen spänning",
      "får ingen ström",
      "ingen ström",
      "ingen signal",
      "kortslut",
      "kabelbrott",
      "no power to",
      "no voltage",
      "no signal",
      "no output",
      "no supply",
      "no injector pulse",
      "open circuit to",
      "kein strom",
      "zwarcie",
      "нет питания",
    ],
  },
  {
    key: "fault-named",
    label: "Names a fault area, no symptom",
    hint: "\"Airbag fel\", \"felkoder på egr\", \"airbag system fault analysis\" — a system plus the word fault, with nothing about what the car actually does.",
    patterns: [
      "fel$",
      "-fel$",
      "^felkod",
      "felkod på",
      "felkoder på",
      "fault codes",
      "fault analysis",
      "felkodsanalys",
      "system fault$",
      "usterka",
      "eroare",
    ],
  },
  {
    key: "noise-vibration",
    label: "Noise / vibration",
    hint: "Knock, rattle, whine, whistle, squeal, vibration.",
    patterns: [
      "missljud",
      "oljud",
      "ljud från",
      "konstigt ljud",
      "knack",
      "knackar",
      "skrap",
      "gnissl",
      "vissl",
      "vinande",
      "buller",
      "smäller",
      "noise",
      "noisy",
      "knocking",
      "rattle",
      "rattling",
      "whistling",
      "whistle",
      "whining",
      "whine",
      "squeal",
      "squeak",
      "grinding",
      "vibration",
      "vibrationer",
      "vibbration",
      "vibrerar",
      "vibrating",
      "vibra",
      "sounds like",
      "dragging sound",
      "geräusch",
      "rumore",
      " suono",
      "zgomot",
      "стук",
      "гремит",
      "piszczy",
      "stuka",
      "cvaká",
      "klepot",
      " zvuk",
    ],
  },
  {
    key: "leak-smell-smoke",
    label: "Leak, smell or smoke",
    hint: "Fluid loss, burning/exhaust smell, visible smoke.",
    patterns: [
      "läcker",
      "lacker",
      "läckage",
      "oljeläck",
      "luktar",
      "lukt av",
      "ryker",
      "rök ",
      "röker",
      "drar olja",
      "förbrukar olja",
      "leak",
      "leaking",
      "leaks",
      "smoke",
      "smoking",
      "smell",
      "smells",
      "burning oil",
      "oil consumption",
      "undicht",
      "perdita",
      "scurgeri",
      "течь",
      "mizne",
    ],
  },
  {
    key: "overheating",
    label: "Overheating / coolant loss",
    hint: "Temperature climbing, coolant disappearing, fan behaviour.",
    patterns: [
      "överhett",
      "overhett",
      "kokar",
      "för varm",
      "temp går upp",
      "hög temperatur",
      "kylvatten försvinner",
      "tappar kylvatten",
      "overheat",
      "overheating",
      "running hot",
      "temperature rises",
      "coolant loss",
      "losing coolant",
      "loses water",
      "überhitzt",
      "surriscalda",
      "supraincalzire",
      "перегрев",
    ],
  },
  {
    key: "no-heat-no-cold",
    label: "No heat / no cold air",
    hint: "Climate output complaint — cabin heat or A/C not delivering.",
    patterns: [
      "ingen värme",
      "ingen kyla",
      "dålig värme",
      "dålig kyla",
      "ger ej kyla",
      "ger inte kyla",
      "blir inte varm",
      "kyler inte",
      "värmer inte",
      "svag värme",
      "svag kyla",
      "no heat",
      "no hot air",
      "no cold air",
      "not cooling",
      "not blowing cold",
      "blows warm",
      "no aircon",
      "poor a c cooling",
      "poor cooling",
      "intermittent heat",
      "clima dont work",
      "keine kühlung",
      "non raffredda",
      "nu raceste",
    ],
  },
  {
    key: "shifting",
    label: "Shifting / clutch problem",
    hint: "Won't shift, harsh or jerky shifts, slipping, gear stuck.",
    patterns: [
      "växlar inte",
      "växlar ej",
      "växlar dåligt",
      "att växla",
      "växelspak",
      "hugger",
      "slirar",
      "rycker vid växling",
      "hoppar ur växel",
      "får ingen växel",
      "ligger kvar i",
      "won t shift",
      "wont shift",
      "not shifting",
      "not changing",
      "gear change",
      "harsh shift",
      "jerky shift",
      "slipping",
      "slips",
      "stuck in gear",
      "no drive",
      "no gears",
      "torque converter",
      "convertitore di coppia",
      "schaltet nicht",
      "non cambia",
      "nu schimba",
      "коробка передач",
    ],
  },
  {
    key: "no-communication",
    label: "Can't communicate with the ECU",
    hint: "Tool/scan-level failure — no comms, no read-out, adaptation aborts.",
    patterns: [
      "ingen kommunikation",
      "får ingen kontakt",
      "går ej att läsa",
      "går inte att läsa av",
      "ingen kontakt med",
      "kan ej kommunicera",
      "kommunikationsfel",
      "no communication",
      "communication lost",
      "cannot communicate",
      "can t communicate",
      "no comms",
      "won t connect",
      "unable to connect",
      "not responding",
      "keine kommunikation",
      "ei kommunikointia",
      "通信丢失",
      "avbrott",
    ],
  },
  {
    key: "battery-charging",
    label: "Battery drain / not charging",
    hint: "Flat battery, parasitic drain, charging-system fault.",
    patterns: [
      "urladdning",
      "urladdat",
      "laddar inte",
      "laddar ej",
      "batteriet dör",
      "tomt batteri",
      "dålig laddning",
      "battery drain",
      "battery goes flat",
      "flat battery",
      "not charging",
      "no charge",
      "charging fault",
      "parasitic",
      "batterie leer",
      "batteria scarica",
      "не заряжает",
    ],
  },
  {
    key: "high-consumption",
    label: "High consumption",
    hint: "Fuel, oil or AdBlue being used faster than expected.",
    patterns: [
      "hög förbrukning",
      "drar mycket",
      "hög bränsleförbrukning",
      "förbrukar mycket",
      "high consumption",
      "using a lot of",
      "uses too much",
      "excessive consumption",
      "fuel consumption",
      "hoher verbrauch",
      "consumo elevato",
      "consum mare",
    ],
  },
  {
    key: "calibration-coding",
    label: "Calibration, coding or software",
    hint: "Not a fault report — help completing a basic setting, adaptation, coding or update.",
    patterns: [
      "grundinställning",
      "grundinstall",
      "kalibrer",
      "kodning",
      "koda ",
      "programmer",
      "adaption",
      "anpassning",
      "mjukvara",
      "mjukvaruuppdatering",
      "uppdatering",
      "calibration",
      "calibrate",
      "coding",
      "adaptation",
      "basic setting",
      "software update",
      "reprogram",
      "flash",
      "relearn",
      "grundeinstellung",
      "codifica",
      "codare",
    ],
  },
  {
    key: "code-definition",
    label: "Pasted fault-code definition",
    hint: "The text is the scan tool's own wording for a code — \"Fuel Rail Pressure Sensor Circuit Range/Performance\", \"insugsspjäll fast i öppet läge\". Copy-paste rather than an observed symptom, so the AI gets no context the code didn't already carry.",
    patterns: [
      "range performance",
      "circuit high",
      "circuit low",
      "high input",
      "low input",
      "signal low",
      "signal high",
      "open circuit",
      "circuit open",
      "circuit range",
      "below threshold",
      "above threshold",
      "implausible",
      "malfunction",
      "stuck open",
      "stuck closed",
      "stuck off",
      "correlation",
      "performance or",
      "flow low",
      "underboost condition",
      "algoritmfel",
      "fast i öppet läge",
      "fast i stängt läge",
      "krets öppen",
      "kretsfel",
      "sygnał niski",
      "sygnał wysoki",
      "pod prahovou hodnotou",
      "correlazione",
      "operazione non conforme",
      "sorveglianza",
    ],
  },
  {
    key: "code-only",
    label: "Fault code with no description",
    hint: "The whole entry is one or more fault codes (\"p0420\", \"p0017,p0014,p0089\"). Nothing for the AI to reason from beyond what the scan already read.",
    patterns: [
      "^[pbuc][0-9][0-9a-f]{2,6}$",
      "^[pbuc][0-9]{3,4}( [pbuc][0-9]{3,4})+$",
      "^dtc code",
      "^felkod [pbuc][0-9]",
      "^fehlercode",
      "^kod [pbuc][0-9]",
    ],
  },
  {
    key: "info-lookup",
    label: "Asking for specs or a procedure",
    hint: "Not a fault at all — torque figures, fluid capacities, fuse locations, wiring colours, step-by-step replacement. Demand for a repair-info product sitting inside the diagnosis field.",
    patterns: [
      "how to",
      "how do i",
      "step by step",
      "procedure",
      "wiring diagram",
      "kopplingsschema",
      "åtdragningsmoment",
      "hur mycket",
      "hur hårt",
      "vilken placering",
      "var sitter",
      "vad är värdena",
      "värden för",
      "location of",
      "colors of the wires",
      "colours of the wires",
      "which fuse",
      "torque spec",
      "capacity",
      "ryms",
      "specifikation",
      "specification",
      "diagram",
      "behöver veta",
      "need to know",
    ],
  },
  {
    key: "planned-job",
    label: "Planned repair or service job",
    hint: "A job already decided on, looking for guidance rather than a diagnosis — \"byte av värmeväxlare\", \"vi ska byta turbo\", \"skall göra en oljeservice\".",
    patterns: [
      "^byte ",
      "^byte av",
      "ska byta",
      "skall byta",
      "vill byta",
      "skall göra",
      "ska göra",
      "planerar",
      "oljeservice",
      "inför besiktning",
      "going to replace",
      "want to replace",
      "need to replace",
      "replacing the",
    ],
  },
  {
    key: "inspection",
    label: "Inspection or emissions test",
    hint: "Failed or preparing for a roadworthiness/emissions test — besiktning, MOT, TÜV, CO reading.",
    patterns: [
      "besiktning",
      "besiktig",
      "co halt",
      "check emissions",
      "emission error",
      "emissions test",
      " mot test",
      " mot fail",
      "tüv",
      "roadworthy",
      "inspection",
      "itp ",
      "revizie",
    ],
  },
  {
    key: "keys-locking",
    label: "Keys, locking & immobiliser",
    hint: "Key not recognised, central locking, immobiliser, alarm.",
    patterns: [
      "centrallås",
      "nyckel",
      "nyckeln",
      "startspärr",
      "larmet",
      "låser inte",
      "central locking",
      "key not found",
      "no key",
      "key not recognised",
      "immobiliser",
      "immobilizer",
      "keyless",
      "alarm goes off",
      "wegfahrsperre",
      "chiave",
      "cheie",
    ],
  },
];

/**
 * Which part of the car the text points at.
 */
const SYSTEM_BUCKETS: BucketDefinition[] = [
  {
    key: "engine-mech",
    label: "Engine mechanical",
    hint: "Compression, timing, valvetrain, pistons, head.",
    patterns: [
      "kompression",
      "kamkedja",
      "kamrem",
      "kamaxel",
      "vevaxel",
      "topplock",
      "ventil ",
      "ventiler",
      "kolv",
      "lager i motor",
      "motorhaveri",
      "compression",
      "timing chain",
      "timing belt",
      "camshaft",
      "crankshaft",
      "cylinder head",
      "piston",
      "valve clearance",
      "head gasket",
      "engine failure",
      "engine damage",
      "steuerkette",
      "distributie",
    ],
  },
  {
    key: "fuel-injection",
    label: "Fuel & injection",
    hint: "Injectors, pumps, rail pressure, tank, filters.",
    patterns: [
      "spridare",
      "spridarna",
      "insprutning",
      "bränsletryck",
      "bransletryck",
      "bränslepump",
      "högtryckspump",
      "hogtryckspump",
      "bränslefilter",
      "bränsle",
      "diesel",
      "bensin",
      "injector",
      "injectors",
      "injection",
      "fuel pressure",
      "fuel rail",
      "fuel pump",
      "fuel filter",
      "common rail",
      "lift pump",
      "einspritz",
      "iniettori",
      "injectoare",
      "форсунк",
    ],
  },
  {
    key: "emissions",
    label: "Emissions & aftertreatment",
    hint: "DPF, EGR, AdBlue/SCR, NOx, lambda, catalyst, swirl flaps.",
    patterns: [
      " dpf",
      "partikelfilter",
      " egr",
      "adblue",
      " scr",
      " nox",
      "lambda",
      "lamda",
      "katalysator",
      "catalytic",
      "catalyst",
      "virvelspjäll",
      "swirl",
      " sot ",
      "soot",
      "regenerer",
      "regeneration",
      "avgas",
      "exhaust",
      "abgas",
      "emission",
    ],
  },
  {
    key: "air-boost",
    label: "Air, boost & intake",
    hint: "Turbo, boost pressure, intake leaks, MAF/MAP, vacuum.",
    patterns: [
      "turbo",
      "laddtryck",
      "insug",
      "insuget",
      "intercooler",
      "luftmassemätare",
      "luftmassa",
      "vakuum",
      "vevhusventilation",
      "boost",
      "charge pressure",
      "intake",
      "manifold",
      "maf ",
      " map ",
      "vacuum",
      "air leak",
      "unmetered air",
      "ladedruck",
      "supraalim",
    ],
  },
  {
    key: "ignition",
    label: "Ignition",
    hint: "Coils, plugs, glow plugs, ignition signal.",
    patterns: [
      "tändspole",
      "tändstift",
      "tändning",
      "glödstift",
      "glödtsift",
      "ignition coil",
      "spark plug",
      "glow plug",
      "ignition",
      "zündspule",
      "candele",
      "bujii",
    ],
  },
  {
    key: "cooling",
    label: "Cooling system",
    hint: "Radiator, coolant, thermostat, water pump, fans.",
    patterns: [
      "kylare",
      "kylvatten",
      "kylmedel",
      "kylsystem",
      "termostat",
      "vattenpump",
      "expansionskärl",
      "expanzn",
      "kylfläkt",
      "coolant",
      "radiator",
      "thermostat",
      "water pump",
      "cooling fan",
      "chladi",
      "kühl",
      "raffreddamento",
    ],
  },
  {
    key: "transmission",
    label: "Transmission & driveline",
    hint: "Gearbox, mechatronic, DSG, clutch, diffs, driveshafts.",
    patterns: [
      "växellåd",
      "vaxellad",
      "automatlåda",
      "mekatronik",
      "mechatronic",
      " dsg",
      "transmission",
      "gearbox",
      "koppling",
      "clutch",
      " cvt",
      "differential",
      "drivaxel",
      "kardan",
      "torque converter",
      "getriebe",
      "cambio",
      "cutie de viteze",
    ],
  },
  {
    key: "electrical-wiring",
    label: "Electrical & wiring",
    hint: "Harness, shorts, grounds, voltage, fuses, relays, connectors.",
    patterns: [
      "kabel",
      "kablage",
      "kablar",
      "kortslut",
      "spänning",
      "spanning",
      " volt",
      "jordfel",
      "jordning",
      "säkring",
      "relä",
      "kontaktstift",
      "kontaktdon",
      "wiring",
      "harness",
      "short circuit",
      "open circuit",
      "circuit",
      "voltage",
      "ground",
      "earth fault",
      "fuse",
      "relay",
      "connector",
      "pinout",
      "kabelbaum",
      "cablaj",
    ],
  },
  {
    key: "sensors",
    label: "Sensors & actuators",
    hint: "Any givare/sensor/solenoid/actuator named in the text.",
    patterns: [
      "givare",
      "givaren",
      "givarna",
      "sensor",
      "sensorn",
      "aktuator",
      "actuator",
      "magnetventil",
      "solenoid",
      "geber",
      "senzor",
      "датчик",
    ],
  },
  {
    key: "starting-charging",
    label: "Starting & charging",
    hint: "Battery, alternator, starter motor.",
    patterns: [
      "batteri",
      "generator",
      "startmotor",
      "laddning",
      "battery",
      "alternator",
      "starter motor",
      "starter",
      "charging",
      "lichtmaschine",
      "alternatore",
      "аккумулятор",
    ],
  },
  {
    key: "brakes-abs",
    label: "Brakes, ABS & stability",
    hint: "Brakes, ABS, ESP/ASR/TCS, brake fluid, handbrake.",
    patterns: [
      "broms",
      "bromsar",
      "bromsvätska",
      "handbroms",
      "brake",
      "brakes",
      "braking",
      " abs",
      " esp",
      " asr",
      " tcs",
      " ebd",
      "stability",
      "traction control",
      "bremse",
      "frana",
      "freni",
    ],
  },
  {
    key: "steering-suspension",
    label: "Steering & suspension",
    hint: "Power steering, rack, air suspension, dampers, bearings.",
    patterns: [
      "styrservo",
      "servostyr",
      "styrväxel",
      "ratt",
      "fjädring",
      "luftfjädring",
      "stötdämpare",
      "hjullager",
      "spindelled",
      "länkarm",
      "power steering",
      "steering rack",
      "steering",
      "suspension",
      "air suspension",
      "damper",
      "shock absorber",
      "wheel bearing",
      "ride height",
      "дорожного просвета",
      "lenkung",
    ],
  },
  {
    key: "climate",
    label: "Climate & A/C",
    hint: "A/C circuit, compressor, blower, heater, auxiliary heater.",
    patterns: [
      " ac ",
      "a c kompressor",
      "aircon",
      "air con",
      "klimat",
      "climate",
      "kupefläkt",
      "kupeflakt",
      "värmepaket",
      "extravärmare",
      "heater",
      "blower",
      "compressor",
      "kompressor",
      "refrigerant",
      "köldmedel",
      "klimaanlage",
      "clima",
    ],
  },
  {
    key: "safety-srs",
    label: "Airbag & safety systems",
    hint: "SRS, airbags, belt pretensioners.",
    patterns: [
      "airbag",
      " srs",
      "krockkudde",
      "bältesförsträckare",
      "seat belt",
      "pretension",
      "sicherheitsgurt",
    ],
  },
  {
    key: "body-comfort",
    label: "Body, locks & comfort",
    hint: "Doors, tailgate, windows, mirrors, sunroof, seats.",
    patterns: [
      "baklucka",
      "dörr",
      "dörrar",
      "fönsterhiss",
      "ruta ",
      "spegel",
      "taklucka",
      "stol ",
      "säte",
      "centrallås",
      "tailgate",
      "boot lid",
      "door",
      "window",
      "mirror",
      "sunroof",
      "seat ",
      "central locking",
      "heckklappe",
      "portbagaj",
    ],
  },
  {
    key: "lighting",
    label: "Lighting",
    hint: "Headlights, indicators, xenon/LED, exterior lamps.",
    patterns: [
      "strålkastare",
      "halvljus",
      "helljus",
      "blinkers",
      "xenon",
      " led ",
      "bakljus",
      "headlight",
      "head light",
      "indicator",
      "turn signal",
      "tail light",
      "fog light",
      "scheinwerfer",
      "faruri",
    ],
  },
  {
    key: "infotainment",
    label: "Infotainment",
    hint: "Radio, screen, navigation, audio, connectivity.",
    patterns: [
      "radio",
      "navigation",
      "display",
      "skärm",
      "ljudanläggning",
      "högtalare",
      "screen",
      "head unit",
      "speaker",
      "bluetooth",
      "carplay",
      "android auto",
      "infotainment",
      "sound stopped",
    ],
  },
  {
    key: "driver-assist",
    label: "Driver assistance",
    hint: "Cruise control, parking sensors, cameras, radar, lane systems.",
    patterns: [
      "farthållare",
      "cruise kontroll",
      "cruise control",
      "adaptive cruise",
      "parkeringssensor",
      "parkeringshjälp",
      "parking sensor",
      "kamera",
      "camera",
      "radar",
      "lane assist",
      "lane departure",
      "blind spot",
      " adas",
      "distronic",
      "abstandsregel",
    ],
  },
  {
    key: "ev-hybrid",
    label: "EV & hybrid",
    hint: "Traction battery, inverter, high-voltage, electric drive.",
    patterns: [
      "elmotor",
      "elmotorn",
      "hybrid",
      "högvolt",
      "drivbatteri",
      "elbil",
      "laddbox",
      "high voltage",
      "traction battery",
      "inverter",
      "electric motor",
      "hochvolt",
      "elektrisk vatten pump",
    ],
  },
];

/**
 * Not what is broken — HOW the technician writes it up. This is the part that
 * tells us what the AI prompt actually receives.
 */
const PHRASING_BUCKETS: BucketDefinition[] = [
  {
    key: "prior-work",
    label: "Lists repairs already tried",
    hint: "\"vi har bytt…\", \"we replaced…\" — the entry is a troubleshooting history, not just a symptom. These are the hardest cases and the ones where a wrong answer wastes real money.",
    patterns: [
      "bytt",
      "bytte",
      "byter",
      "byte av",
      "bytts",
      "har bytt",
      "replaced",
      "changed",
      "renewed",
      "fitted a new",
      "new fitted",
      "swapped",
      "gewechselt",
      "ersetzt",
      "vymen",
      "wymien",
      "schimbat",
      "inlocuit",
      "sostituit",
      "заменен",
      "заменил",
    ],
  },
  {
    key: "prior-work-no-change",
    label: "…and says it changed nothing",
    hint: "Explicitly states the replaced part did not fix it. The clearest signal of a case the workshop is stuck on.",
    patterns: [
      "utan förändring",
      "ingen förändring",
      "ingen skillnad",
      "gjorde ingen skillnad",
      "samma fel",
      "felet kvarstår",
      "kvarstår",
      "återkom",
      "aterkom",
      "kommer tillbaka",
      "no change",
      "no difference",
      "made no difference",
      "still the same",
      "same fault",
      "same problem",
      "problem remains",
      "with no joy",
      "no joy",
      "didn t help",
      "did not help",
      "bez zmeny",
      "bez zmiany",
      "problema rimane",
      "проблема осталась",
    ],
  },
  {
    key: "quotes-code",
    label: "Quotes a fault code",
    hint: "A P/B/U/C code typed into the text, on top of whatever the scan already captured.",
    patterns: ["\\b[pbuc][0-9]{4}\\b"],
  },
  {
    key: "no-codes",
    label: "States there are no fault codes",
    hint: "\"inga felkoder\" — the technician has nothing to go on and is asking the AI to reason from symptoms alone.",
    patterns: [
      "inga felkoder",
      "ingen felkod",
      "inga koder",
      "utan felkod",
      "finns inga fel",
      "no fault codes",
      "no fault code",
      "no codes",
      "no dtc",
      "without codes",
      "keine fehler",
      "nessun errore",
    ],
  },
  {
    key: "measurements",
    label: "Includes measured values",
    hint: "Bar, volts, ohms, rpm, degrees — real test data pasted in.",
    patterns: [
      "\\d+\\s?bar",
      "\\d+\\s?v ",
      "\\d+\\s?volt",
      "\\d+\\s?ohm",
      "\\d+\\s?mv",
      "\\d+\\s?rpm",
      "\\d+\\s?varv",
      "\\d+\\s?grader",
      "\\d+\\s?c ",
      "\\d+\\s?amp",
      "\\d+\\s?ma ",
      "\\d+\\s?procent",
      "\\d+\\s?psi",
    ],
  },
  {
    key: "conditions",
    label: "Gives operating conditions",
    hint: "When it happens — cold start, under load, at idle, above a certain rpm. The context that makes a diagnosis possible.",
    patterns: [
      "vid kallstart",
      "kall motor",
      "när den är varm",
      "vid tomgång",
      "på tomgång",
      "under belastning",
      "vid belastning",
      "vid gaspådrag",
      "i högre varv",
      "över \\d",
      "vid körning",
      "under färd",
      "efter ca",
      "when cold",
      "when hot",
      "at idle",
      "under load",
      "when driving",
      "while driving",
      "on acceleration",
      "above \\d",
      "after \\d",
      "at speed",
      "kaltstart",
      "la peste",
      "pod zatazou",
    ],
  },
  {
    key: "intermittent",
    label: "Notes it's intermittent",
    hint: "Comes and goes — the fault class hardest to reproduce on the lift.",
    patterns: [
      "ibland",
      "intermittent",
      "sporadisk",
      "kommer och går",
      "periodvis",
      "slumpmäss",
      "då och då",
      "occasional",
      "occasionally",
      "sometimes",
      "now and then",
      "comes and goes",
      "on and off",
      "manchmal",
      "a volte",
      "uneori",
    ],
  },
  {
    key: "asks-question",
    label: "Asks the AI a direct question",
    hint: "Ends in a question or asks for suggestions — treating the field as a chat prompt rather than a symptom slot.",
    patterns: [
      "\\?",
      "hur ",
      "vad kan",
      "vad är",
      "varför",
      "varfor",
      "vilken ",
      "kan det vara",
      "how do",
      "how can",
      "how to",
      "what could",
      "what is",
      "what would",
      "why ",
      "any idea",
      "any ideas",
      "please help",
      "hjälp",
      "förslag",
      "suggestions",
      "advice",
    ],
  },
  {
    key: "customer-reported",
    label: "Frames it as customer-reported",
    hint: "\"kunden säger…\", \"customer states…\" — second-hand symptom, unverified by the technician.",
    patterns: [
      "kunden",
      "kunden säger",
      "kunden uppger",
      "enligt kund",
      "customer states",
      "customer says",
      "customer reports",
      "customer complains",
      "owner says",
      "kunde ",
      "clientul",
      "il cliente",
    ],
  },
  {
    key: "towed-in",
    label: "Car arrived towed / undriveable",
    hint: "Bärgad / recovered — the highest-urgency jobs in the queue.",
    patterns: [
      "bärgad",
      "bargad",
      "bärgades",
      "bogserad",
      "towed",
      "recovered",
      "recovery truck",
      "abgeschleppt",
    ],
  },
  {
    key: "test-entry",
    label: "Looks like a test entry",
    hint: "Junk or placeholder text (\"test\", \"asd\", \"aaa\", digits only). Worth excluding before drawing conclusions.",
    patterns: [
      "^test$",
      "^testar$",
      "^testing$",
      "^test test",
      "^asd",
      "^aaa+$",
      "^qwe",
      "^[0-9]+$",
      // Punctuation-only text normalizes to nothing, so match the empty string.
      "^$",
      "^abc",
      "^hej$",
      "^hello$",
      "^x+$",
    ],
  },
];

/**
 * Bands are mutually exclusive and cover every described entry: anything of two
 * words or fewer lands in "keyword" regardless of length, the rest split by
 * character count.
 */
const LENGTH_BANDS: {
  key: string;
  label: string;
  hint: string;
  test: (entry: { chars: number; words: number }) => boolean;
}[] = [
  {
    key: "keyword",
    label: "1-2 words",
    hint: 'Barely a prompt — "motorlampa", "airbag", "misfire".',
    test: (entry) => entry.words <= 2,
  },
  {
    key: "short",
    label: "Short phrase (≤ 25 chars)",
    hint: "One symptom, no context.",
    test: (entry) => entry.words > 2 && entry.chars <= 25,
  },
  {
    key: "sentence",
    label: "One sentence (26-80 chars)",
    hint: "Symptom plus a little context.",
    test: (entry) => entry.words > 2 && entry.chars > 25 && entry.chars <= 80,
  },
  {
    key: "detailed",
    label: "Detailed (81-300 chars)",
    hint: "Symptom, conditions, and usually what has already been checked.",
    test: (entry) => entry.words > 2 && entry.chars > 80 && entry.chars <= 300,
  },
  {
    key: "narrative",
    label: "Full case history (300+ chars)",
    hint: "Multi-step troubleshooting narrative — the richest input the AI gets.",
    test: (entry) => entry.words > 2 && entry.chars > 300,
  },
];

/**
 * Stopwords across the languages present in the data. Deliberately excludes
 * automotive words that look like filler ("fel", "kod") — those are signal.
 */
const STOPWORDS = new Set([
  // Swedish
  "och", "att", "det", "den", "som", "har", "för", "inte", "med", "vid", "man",
  "men", "var", "där", "när", "på", "ett", "är", "till", "om", "så", "de", "du",
  "jag", "sig", "kan", "ska", "vill", "blir", "kom", "vara", "efter", "samt",
  "eller", "bara", "mer", "mycket", "helt", "vet", "från", "under", "kommer",
  "även", "får", "alla", "upp", "denna", "detta", "dessa", "utan", "samma",
  "finns", "igen", "lite", "över", "ner", "här", "sedan", "sen", "vi", "ej",
  "hade", "blev", "går", "gick", "gör", "göra", "gjort", "andra", "något", "några",
  "nåt", "sitter", "ligger", "vilket", "vilken", "hela", "både", "innan",
  "medan", "själv", "annat", "annan", "ingen", "inga", "inget", "man",
  // English
  "the", "and", "has", "have", "was", "are", "not", "but", "for", "with",
  "this", "that", "from", "you", "all", "can", "were", "been", "its", "out",
  "get", "got", "they", "when", "then", "after", "also", "only", "than",
  "into", "over", "off", "there", "which", "what", "will", "would", "could",
  "your", "our", "any", "has", "had", "did", "does", "doing", "just", "very",
  "some", "still", "now", "back", "again", "before", "while", "about",
  // Cross-language filler
  "der", "die", "das", "und", "ist", "nicht", "ein", "eine", "auf", "che",
  "per", "con", "non", "una", "del", "nie", "jest", "din", "este", "pentru",
  "sau", "cu", "nu", "que", "los", "las",
]);

/** Generic words that are true in every entry — no discriminating power. */
const LOW_SIGNAL_TERMS = new Set([
  "bil", "bilen", "bilar", "car", "vehicle", "auto", "fordon",
  "fel", "felet", "problem", "problemet", "issue", "fault", "faults",
  "kund", "kunden", "customer",
  "mm", "st", "ca", "typ", "gång", "gånger", "sätt",
]);

function normalizeForMatch(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}?]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function normalizeVerbatim(text: string) {
  return text.replace(/\s+/g, " ").trim().replace(/[.,;:!]+$/, "").toLowerCase();
}

function buildMatcher(patterns: string[]) {
  // Patterns are a mix of plain substrings (already lowercase, space-padded
  // where boundaries matter) and small regex fragments. Anchors (^ $) are
  // rewritten to match the padded normalized string.
  // Anchors are rewritten as lookarounds because the normalized string is
  // space-padded on both sides. Plain substrings in the sets above contain no
  // regex metacharacters (a literal "?" is written escaped, as `\\?`), so no
  // additional escaping happens here — escaping blindly would break the
  // `\s?` / `\d+` fragments.
  const source = patterns
    .map((pattern) =>
      pattern.replace(/^\^/, "(?<=^ )").replace(/\$$/, "(?= $)"),
    )
    .join("|");
  return new RegExp(source, "u");
}

function median(sorted: number[]) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

type Prepared = {
  item: DiagnosticListItem;
  raw: string;
  matchable: string;
  tokens: string[];
  chars: number;
  words: number;
};

function carLabel(item: DiagnosticListItem) {
  const parts = [
    item.carMake,
    item.carModel,
    item.carYear ? String(item.carYear) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : null;
}

function toExample(entry: Prepared): SearchTermExample {
  return {
    diagnosticId: entry.item.diagnosticId,
    text: entry.raw,
    language: entry.item.language,
    country: entry.item.country,
    car: carLabel(entry.item),
    createdAt: entry.item.createdAt,
  };
}

function buildBuckets(
  definitions: BucketDefinition[],
  prepared: Prepared[],
  exampleCount = 3,
): { buckets: SearchTermBucket[]; matchedKeys: Map<string, Set<string>> } {
  const denominator = prepared.length || 1;
  const matchedKeys = new Map<string, Set<string>>();
  const buckets = definitions.map((definition) => {
    const matcher = buildMatcher(definition.patterns);
    const hits = prepared.filter((entry) => matcher.test(entry.matchable));
    matchedKeys.set(
      definition.key,
      new Set(hits.map((entry) => entry.item.diagnosticId)),
    );
    // Prefer mid-length examples: long enough to read as a real complaint,
    // short enough to show in a table cell.
    const examples = [...hits]
      .sort((a, b) => {
        const score = (entry: Prepared) => Math.abs(entry.chars - 90);
        return score(a) - score(b);
      })
      .slice(0, exampleCount)
      .map(toExample);
    return {
      key: definition.key,
      label: definition.label,
      hint: definition.hint,
      count: hits.length,
      share: hits.length / denominator,
      examples,
    };
  });
  buckets.sort((a, b) => b.count - a.count);
  return { buckets, matchedKeys };
}

function countFrequencies(
  prepared: Prepared[],
  size: 1 | 2,
  limit: number,
): TermFrequency[] {
  const entries = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const entry of prepared) {
    const seen = new Set<string>();
    const tokens = entry.tokens;
    for (let i = 0; i + size <= tokens.length; i += 1) {
      const parts = tokens.slice(i, i + size);
      if (parts.some((part) => !isCountableToken(part))) {
        continue;
      }
      const term = parts.join(" ");
      occurrences.set(term, (occurrences.get(term) ?? 0) + 1);
      if (!seen.has(term)) {
        seen.add(term);
        entries.set(term, (entries.get(term) ?? 0) + 1);
      }
    }
  }
  return [...entries.entries()]
    .map(([term, count]) => ({
      term,
      entries: count,
      occurrences: occurrences.get(term) ?? count,
    }))
    .filter((row) => row.entries > 1)
    .sort((a, b) => b.entries - a.entries || a.term.localeCompare(b.term))
    .slice(0, limit);
}

function isCountableToken(token: string) {
  if (token.length < 3) return false;
  if (STOPWORDS.has(token)) return false;
  if (LOW_SIGNAL_TERMS.has(token)) return false;
  if (/^\d+$/.test(token)) return false;
  // Fault codes get their own card.
  if (/^[pbuc]\d{3,4}$/.test(token)) return false;
  return true;
}

export function analyseSearchTerms(
  items: DiagnosticListItem[],
): SearchTermsAnalysis {
  const prepared: Prepared[] = [];
  for (const item of items) {
    const raw = (item.description ?? "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const matchable = normalizeForMatch(raw);
    prepared.push({
      item,
      raw,
      matchable,
      tokens: matchable.trim().split(" ").filter(Boolean),
      chars: raw.length,
      words: matchable.trim().split(" ").filter(Boolean).length,
    });
  }

  const denominator = prepared.length || 1;
  const lengths = prepared.map((entry) => entry.chars).sort((a, b) => a - b);

  const verbatimMap = new Map<
    string,
    { text: string; count: number; languages: Set<string> }
  >();
  for (const entry of prepared) {
    const key = normalizeVerbatim(entry.raw);
    const existing = verbatimMap.get(key);
    if (existing) {
      existing.count += 1;
      if (entry.item.language) existing.languages.add(entry.item.language);
    } else {
      verbatimMap.set(key, {
        text: entry.raw,
        count: 1,
        languages: new Set(entry.item.language ? [entry.item.language] : []),
      });
    }
  }
  const verbatims = [...verbatimMap.values()]
    .filter((row) => row.count > 1)
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 40)
    .map((row) => ({
      text: row.text,
      count: row.count,
      languages: [...row.languages].sort(),
    }));

  const { buckets: complaints, matchedKeys: complaintKeys } = buildBuckets(
    COMPLAINT_BUCKETS,
    prepared,
  );
  const { buckets: systems } = buildBuckets(SYSTEM_BUCKETS, prepared);
  const { buckets: phrasing } = buildBuckets(PHRASING_BUCKETS, prepared);

  const anyComplaint = new Set<string>();
  for (const ids of complaintKeys.values()) {
    for (const id of ids) anyComplaint.add(id);
  }
  const unmatched = prepared.filter(
    (entry) => !anyComplaint.has(entry.item.diagnosticId),
  );

  const languageMap = new Map<string, number[]>();
  for (const entry of prepared) {
    const language = (entry.item.language ?? "unknown").toLowerCase();
    const list = languageMap.get(language) ?? [];
    list.push(entry.chars);
    languageMap.set(language, list);
  }
  const languages = [...languageMap.entries()]
    .map(([language, charList]) => {
      const sorted = [...charList].sort((a, b) => a - b);
      return {
        language,
        entries: charList.length,
        share: charList.length / denominator,
        avgChars: Math.round(
          charList.reduce((sum, value) => sum + value, 0) / charList.length,
        ),
        medianChars: median(sorted),
      };
    })
    .sort((a, b) => b.entries - a.entries);

  const lengthBands: LengthBand[] = LENGTH_BANDS.map((band) => {
    const count = prepared.filter((entry) => band.test(entry)).length;
    return {
      key: band.key,
      label: band.label,
      hint: band.hint,
      count,
      share: count / denominator,
    };
  });

  const codeMap = new Map<string, { entries: number; occurrences: number }>();
  for (const entry of prepared) {
    const found = entry.matchable.match(/\b[pbuc]\d{4}\b/gu) ?? [];
    const seen = new Set<string>();
    for (const code of found) {
      const upper = code.toUpperCase();
      const row = codeMap.get(upper) ?? { entries: 0, occurrences: 0 };
      row.occurrences += 1;
      if (!seen.has(upper)) {
        seen.add(upper);
        row.entries += 1;
      }
      codeMap.set(upper, row);
    }
  }
  const quotedCodes = [...codeMap.entries()]
    .map(([term, row]) => ({ term, ...row }))
    .sort((a, b) => b.entries - a.entries || a.term.localeCompare(b.term))
    .slice(0, 25);

  const monthlyMap = new Map<string, { total: number; described: number }>();
  for (const item of items) {
    if (!item.createdAt) continue;
    const month = item.createdAt.slice(0, 7);
    const row = monthlyMap.get(month) ?? { total: 0, described: 0 };
    row.total += 1;
    if ((item.description ?? "").trim()) row.described += 1;
    monthlyMap.set(month, row);
  }
  const monthly = [...monthlyMap.entries()]
    .map(([month, row]) => ({
      month,
      total: row.total,
      described: row.described,
      coverage: row.total > 0 ? row.described / row.total : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totals: {
      diagnostics: items.length,
      described: prepared.length,
      coverage: items.length > 0 ? prepared.length / items.length : 0,
      distinctTexts: verbatimMap.size,
      repeatedTexts: [...verbatimMap.values()].filter((row) => row.count > 1)
        .length,
      avgChars: prepared.length
        ? Math.round(
            prepared.reduce((sum, entry) => sum + entry.chars, 0) /
              prepared.length,
          )
        : 0,
      medianChars: median(lengths),
      p90Chars: percentile(lengths, 90),
      maxChars: lengths.length ? lengths[lengths.length - 1] : 0,
      avgWords: prepared.length
        ? Math.round(
            (prepared.reduce((sum, entry) => sum + entry.words, 0) /
              prepared.length) *
              10,
          ) / 10
        : 0,
    },
    lengthBands,
    complaints,
    systems,
    phrasing,
    uncategorised: {
      key: "uncategorised",
      label: "No complaint category matched",
      hint: "Text that none of the complaint keyword sets recognised — read these to find the next category worth adding.",
      count: unmatched.length,
      share: unmatched.length / denominator,
      // Longest first: those are the entries with real content that the
      // keyword sets failed on, which is what makes this list actionable.
      examples: [...unmatched]
        .filter((entry) => entry.words > 2)
        .sort((a, b) => b.chars - a.chars)
        .slice(0, 15)
        .map(toExample),
    },
    uncategorisedTooShort: unmatched.filter((entry) => entry.words <= 2).length,
    languages,
    verbatims,
    unigrams: countFrequencies(prepared, 1, 60),
    bigrams: countFrequencies(prepared, 2, 40),
    quotedCodes,
    monthly,
  };
}
