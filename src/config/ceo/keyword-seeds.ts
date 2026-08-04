/**
 * Keyword set we ask Google for market search volume on.
 *
 * Built from the wrenchlane.com Search Console corpus (3,314 real queries as of
 * 2026-08-04) plus standard OBD-II code taxonomy, extended into the EU
 * languages where Search Console shows we currently draw zero impressions.
 *
 * Terms are lowercase because Keyword Planner treats keywords
 * case-insensitively and returns them lowercased, so keeping this list lowercase
 * makes the round-trip match on `keyword` without normalising twice.
 */

export type KeywordCluster = {
  key: string;
  label: string;
  /** BCP-47-ish tag for reporting only. "mul" = language neutral. */
  language: string;
  keywords: string[];
};

export const KEYWORD_CLUSTERS: KeywordCluster[] = [
  {
    key: "generic_en",
    label: "Generic diagnostics",
    language: "en",
    keywords: [
      "dtc",
      "dtc code",
      "dtc codes",
      "dtc meaning",
      "diagnostic trouble code",
      "diagnostic trouble codes",
      "fault code",
      "fault codes",
      "car fault codes",
      "engine fault code",
      "obd2",
      "obd2 scanner",
      "obd2 reader",
      "obd scanner",
      "check engine light",
      "engine management light",
      "engine warning light",
      "car diagnostic",
      "car diagnostic tool",
      "car diagnostic software",
      "car diagnostic near me",
      "misfire",
      "engine misfire",
      "cylinder misfire",
      "random misfire",
      "o2 sensor",
      "lambda sensor",
      "oxygen sensor",
      "can bus",
      "ecu",
      "technical service bulletin",
    ],
  },
  {
    key: "fault_codes",
    label: "Fault codes",
    language: "mul",
    keywords: [
      "p0300",
      "p0301",
      "p0302",
      "p0303",
      "p0304",
      "p0171",
      "p0172",
      "p0174",
      "p0420",
      "p0430",
      "p0128",
      "p0135",
      "p0141",
      "p0113",
      "p0087",
      "p0089",
      "p0263",
      "p0401",
      "p0402",
      "p0455",
      "p0442",
      "p0011",
      "p0016",
      "p2002",
      "p2096",
      "p17f0",
      "u0100",
      "u0101",
      "c0035",
      "b1000",
    ],
  },
  {
    key: "swedish",
    label: "Swedish",
    language: "sv",
    keywords: [
      "felkod",
      "felkoder",
      "felkod bil",
      "felkodsläsare",
      "felkoder bil",
      "motorlampa",
      "motorlampan lyser",
      "motorlampan tänd",
      "bilverkstad",
      "bildiagnostik",
      "diagnos bil",
      "lambdasond",
      "lambdasond fel",
      "obd2 läsare",
      "obd2 felkodsläsare",
      "tändningsfel",
      "verkstadsprogram",
    ],
  },
  {
    key: "german",
    label: "German",
    language: "de",
    keywords: [
      "fehlercode",
      "fehlercodes",
      "fehlercode auto",
      "fehlercodes auto",
      "fehlerspeicher auslesen",
      "motorkontrollleuchte",
      "motorkontrollleuchte leuchtet",
      "obd2 diagnosegerät",
      "obd2 auslesen",
      "kfz diagnose",
      "kfz diagnosegerät",
      "lambdasonde",
      "lambdasonde defekt",
      "zündaussetzer",
      "steuergerät",
      "werkstattsoftware",
    ],
  },
  {
    key: "french",
    label: "French",
    language: "fr",
    keywords: [
      "code défaut",
      "codes défaut",
      "code défaut voiture",
      "code erreur voiture",
      "valise diagnostic",
      "valise diagnostic auto",
      "diagnostic auto",
      "diagnostic automobile",
      "voyant moteur",
      "voyant moteur allumé",
      "sonde lambda",
      "sonde lambda hs",
      "raté d'allumage",
      "logiciel garage",
    ],
  },
  {
    key: "spanish",
    label: "Spanish",
    language: "es",
    keywords: [
      "código de error",
      "códigos de error",
      "código de avería",
      "códigos de avería",
      "código de error coche",
      "escáner obd2",
      "lector obd2",
      "diagnosis coche",
      "diagnosis automóvil",
      "luz de motor",
      "luz check engine",
      "sonda lambda",
      "fallo de encendido",
      "software taller",
    ],
  },
  {
    key: "italian",
    label: "Italian",
    language: "it",
    keywords: [
      "codice errore",
      "codici errore",
      "codice guasto",
      "codici guasto",
      "codice errore auto",
      "scanner obd2",
      "lettore obd2",
      "diagnosi auto",
      "diagnosi automobile",
      "spia motore",
      "spia motore accesa",
      "sonda lambda",
      "mancata accensione",
    ],
  },
  {
    key: "polish",
    label: "Polish",
    language: "pl",
    keywords: [
      "kod błędu",
      "kody błędów",
      "kod błędu samochód",
      "czytnik obd2",
      "diagnostyka samochodowa",
      "kontrolka silnika",
      "sonda lambda",
      "wypadanie zapłonu",
    ],
  },
  {
    key: "dutch",
    label: "Dutch",
    language: "nl",
    keywords: [
      "foutcode",
      "foutcodes",
      "storingscode",
      "obd2 uitlezen",
      "obd2 scanner",
      "motorlampje",
      "motorstoringslampje",
      "lambdasonde",
      "auto diagnose",
    ],
  },
  {
    key: "buyer_intent",
    label: "Buyer intent",
    language: "en",
    keywords: [
      "workshop management software",
      "garage management software",
      "auto repair shop software",
      "auto repair software",
      "mechanic software",
      "mechanic shop software",
      "diagnostic software for mechanics",
      "ai car diagnostics",
      "ai vehicle diagnostics",
      "automotive diagnostic software",
      "repair information software",
      "tsb database",
      "tsb lookup",
      "wiring diagrams software",
      "oem service information",
      "vehicle repair database",
    ],
  },
];

/** Every seed keyword, de-duplicated, in cluster order. */
export const KEYWORD_SEEDS: string[] = [
  ...new Set(KEYWORD_CLUSTERS.flatMap((cluster) => cluster.keywords)),
];

/** Which cluster a keyword came from, for dimensioning the metric rows. */
export const KEYWORD_CLUSTER_BY_TERM: Record<string, string> = Object.fromEntries(
  KEYWORD_CLUSTERS.flatMap((cluster) =>
    cluster.keywords.map((keyword) => [keyword, cluster.key]),
  ),
);

/**
 * Google Ads geo target constant IDs for the EU markets we care about.
 *
 * Country criteria IDs are `2000 + ISO 3166-1 numeric`, so Sweden (752) is 2752.
 * Override with GOOGLE_ADS_GEO_TARGETS as a comma-separated list of IDs.
 */
export const EU_GEO_TARGETS: { id: string; country: string }[] = [
  { id: "2752", country: "SE" },
  { id: "2276", country: "DE" },
  { id: "2250", country: "FR" },
  { id: "2724", country: "ES" },
  { id: "2380", country: "IT" },
  { id: "2616", country: "PL" },
  { id: "2528", country: "NL" },
  { id: "2208", country: "DK" },
  { id: "2246", country: "FI" },
  { id: "2578", country: "NO" },
  { id: "2056", country: "BE" },
  { id: "2040", country: "AT" },
  { id: "2203", country: "CZ" },
  { id: "2642", country: "RO" },
  { id: "2826", country: "GB" },
];
