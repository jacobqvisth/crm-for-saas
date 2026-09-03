// Shared helpers for the Swedish vehicle-education (fordon) directory build.
// Data source: Skolverket "Planned educations" open API v3 (no auth needed).
//
// The v3 API only serves *currently planned* educations, so the pre-Gy25 codes
// (FT, FTPER, FTLAS...) return zero rows. Everything is suffixed `25` now.

export const API = "https://api.skolverket.se/planned-educations/v3";
export const ACCEPT = "application/vnd.skolverket.plannededucations.api.v3.hal+json";

// Gymnasium study-path codes, split by how close they are to car mechanics.
// `core` = the programs that actually train people on vehicles.
// `adjacent` = vehicle-adjacent engineering (air, marine, rail) — kept, but tiered
// separately so a workshop-focused list can filter them out.
export const GY_PROGRAMS = {
  FT25: { tier: "core", label: "Fordons- och transportprogrammet", kind: "national" },
  FG25: { tier: "core", label: "Programmet för fordonsvård och godshantering", kind: "adapted" },

  IMVFTG: { tier: "core", label: "Programinriktat val, fordon och transport", kind: "intro" },
  IMVFTGL: { tier: "core", label: "Programinriktat val, fordon och transport, lärlingsliknande", kind: "intro" },
  IMVFTGfe: { tier: "core", label: "Programinriktat val, fordon och transport, för enskild", kind: "intro" },

  IMYFTG: { tier: "core", label: "Yrkesintroduktion, fordon och transport, mot gymnasieprogram", kind: "intro" },
  IMYFTGL: { tier: "core", label: "Yrkesintroduktion, fordon och transport, lärlingsliknande", kind: "intro" },
  IMYFTGLfe: { tier: "core", label: "Yrkesintroduktion, fordon och transport, lärlingsliknande, för enskild", kind: "intro" },
  IMYFTGfe: { tier: "core", label: "Yrkesintroduktion, fordon och transport, för enskild", kind: "intro" },
  IMYFTJ: { tier: "core", label: "Yrkesintroduktion, fordon och transport, mot jobb", kind: "intro" },
  IMYFTJfe: { tier: "core", label: "Yrkesintroduktion, fordon och transport, mot jobb, för enskild", kind: "intro" },

  FL25: { tier: "adjacent", label: "Flygteknikutbildningen", kind: "national" },
  MA25: { tier: "adjacent", label: "Marinteknikutbildningen", kind: "national" },
  TA25: { tier: "adjacent", label: "Tågteknikutbildningen", kind: "national" },
};

export async function getJson(url, { tries = 5 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: ACCEPT } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(500 * (attempt + 1) ** 2);
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DO NOT page this API naively.
//
// Its result ordering is not stable across page requests, so walking page 0..N
// returns the advertised row count while silently repeating some rows and skipping
// others. Measured: the unfiltered gy sweep returns 6046 rows but only 4780 distinct
// (21% lost), and `studyPathCode=FT25` returns 201 rows over 3 pages but only 137
// distinct. Anything that needs more than one page must be partitioned into slices
// that each fit inside a single request.
export const PAGE_CAP = 100;

// Fetch one slice and refuse to guess: if the slice does not fit in a single page the
// caller must partition further, so we surface that instead of returning short data.
export async function fetchSlice(url, embeddedKey) {
  const doc = await getJson(`${url}${url.includes("?") ? "&" : "?"}size=${PAGE_CAP}&page=0`);
  const body = doc?.body ?? doc ?? {};
  const rows = body?._embedded?.[embeddedKey] ?? [];
  const total = body?.page?.totalElements ?? rows.length;
  return { rows, total, overflowed: total > PAGE_CAP };
}

// Fetch a slice, and if it overflows the page cap, re-fetch it partitioned by the
// 4-digit kommun codes in `partitionCodes`. Verifies the union against the advertised
// total and throws on a shortfall rather than returning a quietly incomplete list.
export async function fetchComplete(baseUrl, embeddedKey, partitionCodes, idOf) {
  const first = await fetchSlice(baseUrl, embeddedKey);
  if (!first.overflowed) return { rows: first.rows, total: first.total, partitioned: false };

  const seen = new Map();
  await mapPool(partitionCodes, 8, async (area) => {
    const slice = await fetchSlice(`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}geographicalAreaCode=${area}`, embeddedKey);
    if (slice.overflowed) throw new Error(`slice still overflows for area ${area}: ${slice.total}`);
    for (const r of slice.rows) seen.set(idOf(r), r);
  });

  const rows = [...seen.values()];
  if (rows.length < first.total) {
    throw new Error(`incomplete: collected ${rows.length} of ${first.total} for ${baseUrl}`);
  }
  return { rows, total: first.total, partitioned: true };
}

// Run `fn` over `items` with a bounded pool — the API tolerates ~8 in flight.
export async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function pickAddress(addresses = [], type = "VISITING_ADDRESS") {
  return addresses.find((a) => a.type === type) ?? addresses[0] ?? null;
}

// Skolverket returns län codes as the first two digits of the kommun code.
export const COUNTY_BY_CODE = {
  "01": "Stockholms län",
  "03": "Uppsala län",
  "04": "Södermanlands län",
  "05": "Östergötlands län",
  "06": "Jönköpings län",
  "07": "Kronobergs län",
  "08": "Kalmar län",
  "09": "Gotlands län",
  10: "Blekinge län",
  12: "Skåne län",
  13: "Hallands län",
  14: "Västra Götalands län",
  17: "Värmlands län",
  18: "Örebro län",
  19: "Västmanlands län",
  20: "Dalarnas län",
  21: "Gävleborgs län",
  22: "Västernorrlands län",
  23: "Jämtlands län",
  24: "Västerbottens län",
  25: "Norrbottens län",
};

export function countyFromAreaCode(code) {
  if (!code) return null;
  return COUNTY_BY_CODE[String(code).padStart(4, "0").slice(0, 2)] ?? null;
}
