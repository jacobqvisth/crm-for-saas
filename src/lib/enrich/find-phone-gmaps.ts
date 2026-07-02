import { normalizePhone } from "@/lib/calls/phone";
import type { PhoneCandidate } from "@/lib/enrich/find-phone";

// Fast, structured phone lookup via the Apify Google-Maps extractor. This is the
// primary enrichment path for our market (auto workshops): most have a Google
// Business Profile with a phone, and Google Maps returns it — plus the website
// and place_id — in one structured call, far cheaper and more reliable than a
// Claude web search. See project memory "Apify Google-Maps phone/website enrichment".
const ACTOR = "compass~google-maps-extractor";

// Every business we enrich is an auto workshop, so a match to a non-automotive
// business is almost certainly the wrong entity. We accept a name/city match
// only when the matched place's Google category is automotive (unless we queried
// by exact place_id). This is what stops "xxx" → an architecture firm.
const AUTO_CATEGORY =
  /repair|\bcar\b|auto|\bbil|tire|d[aä]ck|vehicle|mechanic|garage|bodywork|motor|fordon|wheel|truck|dealer|verkstad/i;

// Generic words that don't distinguish one workshop from another — ignored when
// checking whether the matched title really is the same business.
const GENERIC_TOKENS = new Set([
  "ab", "bil", "bilar", "bilservice", "service", "verkstad", "bilverkstad",
  "motor", "auto", "fordonsservice", "fordon", "och", "the", "aktiebolag",
  "hb", "kb", "trim", "däck", "dack", "center", "sweden", "sverige",
]);

function tokens(s: string | null | undefined): string[] {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9åäö\s]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

/** How many distinctive name tokens the CRM name and the matched title share. */
function nameOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit;
}

export interface GoogleMapsLookupInput {
  name?: string | null;
  companyName?: string | null;
  city?: string | null;
  country?: string | null;
  /** ISO alpha-2 (e.g. "SE") — expands national numbers + scopes the search. */
  countryCode?: string | null;
  /** Google place_id when we already have one — an exact, unambiguous match. */
  placeId?: string | null;
}

export interface GoogleMapsLookupResult {
  /** The matched number as a single candidate, or [] when nothing trustworthy. */
  candidates: PhoneCandidate[];
  /** The matched business's website, when we're confident about the match. */
  website: string | null;
  /** The matched Google place_id, when we're confident about the match. */
  placeId: string | null;
  matchedTitle: string | null;
  categoryName: string | null;
  reasoning: string;
}

interface GmapsItem {
  title?: string;
  phone?: string;
  phoneUnformatted?: string;
  website?: string;
  placeId?: string;
  url?: string;
  address?: string;
  categoryName?: string;
  categories?: string[];
}

const empty = (reasoning: string): GoogleMapsLookupResult => ({
  candidates: [],
  website: null,
  placeId: null,
  matchedTitle: null,
  categoryName: null,
  reasoning,
});

/**
 * Look a business up on Google Maps (via Apify) and return its phone, website,
 * and place_id — but only when the match is trustworthy:
 *   - queried by exact place_id, OR
 *   - the matched place is an automotive business AND shares a name token or
 *     sits in the same city, OR
 *   - (no Google category) a strong name-token match.
 * Otherwise returns no candidate so the caller falls through to web search.
 *
 * Returns null when it can't run at all (no APIFY_TOKEN, or nothing to search).
 */
export async function findPhonesViaGoogleMaps(
  input: GoogleMapsLookupInput,
): Promise<GoogleMapsLookupResult | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;

  const subject = (input.companyName || input.name || "").trim();
  if (!input.placeId && !subject) return null;

  const query = input.placeId
    ? `place_id:${input.placeId}`
    : [subject, input.city, input.country || "Sweden"].filter(Boolean).join(", ");

  // Bound the whole thing: cap the actor run server-side (timeout=45) and abort
  // our own wait a little after, so this can never eat the serverless budget.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  let items: GmapsItem[] | null = null;
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=45`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchStringsArray: [query],
          maxCrawledPlacesPerSearch: 1,
          language: "en",
          countryCode: (input.countryCode || "se").toLowerCase(),
        }),
      },
    );
    if (!res.ok) return empty(`google maps http ${res.status}`);
    items = (await res.json()) as GmapsItem[];
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    return empty(aborted ? "google maps timed out" : "google maps request failed");
  } finally {
    clearTimeout(timer);
  }

  const it = Array.isArray(items) ? items[0] : null;
  if (!it) return empty("no google maps result");

  const e164 = normalizePhone(it.phoneUnformatted || it.phone, input.countryCode);
  const website = it.website?.trim() || null;
  const placeId = it.placeId?.trim() || null;

  // Validate the match.
  const byPlaceId = !!input.placeId;
  const ov = nameOverlap(subject, it.title);
  const cityMatch = !!(
    input.city &&
    it.address &&
    it.address.toLowerCase().includes(input.city.toLowerCase())
  );
  const catBlob = [it.categoryName, ...(Array.isArray(it.categories) ? it.categories : [])]
    .filter(Boolean)
    .join(" ");
  const isAuto = AUTO_CATEGORY.test(catBlob);
  const hasCat = !!(it.categoryName || "").trim();

  let confidence: string | null = null;
  if (byPlaceId) {
    confidence = "high";
  } else if (isAuto && (ov >= 1 || cityMatch)) {
    confidence = "high";
  } else if (!hasCat && (ov >= 2 || (ov >= 1 && cityMatch))) {
    confidence = "medium";
  }

  // Not a trustworthy match → don't trust its website/place_id either.
  if (!confidence) {
    return {
      ...empty(
        hasCat && !isAuto
          ? `google maps matched a non-automotive business (${it.categoryName})`
          : "google maps match too weak to trust",
      ),
      matchedTitle: it.title || null,
      categoryName: it.categoryName || null,
    };
  }

  if (!e164) {
    // Match is trustworthy but Google had no phone — still hand back the website
    // and place_id so the caller can enrich those.
    return {
      candidates: [],
      website,
      placeId,
      matchedTitle: it.title || null,
      categoryName: it.categoryName || null,
      reasoning: "google maps match had no phone",
    };
  }

  return {
    candidates: [
      {
        number: e164,
        raw: (it.phone || e164).trim(),
        label: null,
        source: "google-maps",
        sourceUrl: it.url || null,
        confidence,
      },
    ],
    website,
    placeId,
    matchedTitle: it.title || null,
    categoryName: it.categoryName || null,
    reasoning: `google maps: ${it.title}${it.categoryName ? ` [${it.categoryName}]` : ""}`,
  };
}
