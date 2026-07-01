import Anthropic from "@anthropic-ai/sdk";
import { normalizePhone } from "@/lib/calls/phone";
import { findPhonesViaGoogleMaps } from "@/lib/enrich/find-phone-gmaps";

// Auxiliary AI-helper endpoint — uses the project's standard helper model
// (claude-sonnet-4-6, same as find-website / inbox drafts / call summaries).
// Manually triggered, low volume, so Sonnet + web search is the right point.
const MODEL = "claude-sonnet-4-6";

export type PhoneSource = "website" | "google-maps" | "web-search";

export interface PhoneCandidate {
  /** Normalized E.164 — the dialable form, also the dedupe key. */
  number: string;
  /** The raw string we found, for display ("070-123 45 67"). */
  raw: string;
  /** What kind of line it is, when known ("Main", "Mobile", "Service"). */
  label: string | null;
  /** Where it came from. */
  source: PhoneSource;
  /** The page/result URL it was found on, if any. */
  sourceUrl: string | null;
  /** "high" | "medium" | "low" */
  confidence: string;
}

export interface FindPhonesInput {
  /** Person and/or company name to search by. */
  name?: string | null;
  /** Company name, when the contact is linked to one. */
  companyName?: string | null;
  /** Known website(s) to scrape directly for numbers. */
  websites?: (string | null | undefined)[];
  city?: string | null;
  country?: string | null;
  /** ISO alpha-2 hint used to expand national numbers (e.g. "SE"). */
  countryCode?: string | null;
  /** The business's trade/industry (e.g. "Automotive", "auto repair"). Used by
   *  the web-search leg to avoid returning a namesake in the wrong industry. */
  industry?: string | null;
  category?: string | null;
  /** Google place_id when known — lets the Google-Maps leg match exactly. */
  placeId?: string | null;
  /** Numbers already on the record — excluded from the results so we only
   *  surface NEW finds. Includes user-rejected ("not correct") numbers. */
  existing?: (string | null | undefined)[];
}

/** Diagnostics so a "found nothing" result is explainable instead of silent. */
export interface FindPhonesDebug {
  /** Per-page website fetch outcomes (HTTP status, or "abort"/"error"). */
  fetchLog: { url: string; status: number | string }[];
  /** Whether the AI web-search step could run (ANTHROPIC_API_KEY present). */
  apiKeyPresent: boolean;
  /** How many model turns the web-search step took. */
  webSearchTurns: number;
  /** Whether the model ended up calling report_phones (directly or when forced). */
  reportCalled: boolean;
  /** Numbers the web-search step contributed (before dedupe). */
  webPhoneCount: number;
  /** Error message from the web-search step, if it threw. */
  searchError: string | null;
}

export interface FindPhonesResult {
  found: boolean;
  phones: PhoneCandidate[];
  reasoning: string | null;
  debug?: FindPhonesDebug;
  /** Business website discovered by the Google-Maps leg (for backfill). */
  discoveredWebsite?: string | null;
  /** Google place_id discovered by the Google-Maps leg (for backfill). */
  discoveredPlaceId?: string | null;
}

// --- URL helpers -------------------------------------------------------------

function normalizeUrl(raw: string | null | undefined): string | null {
  let url = (raw || "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (!u.hostname.includes(".")) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

// Common "contact us" paths across the Nordic markets we sell into — these are
// where workshops list their phone numbers. We try a handful per site.
const CONTACT_PATHS = [
  "",
  "/kontakt",
  "/kontakta-oss",
  "/kontakt-oss",
  "/contact",
  "/contact-us",
  "/om-oss",
  "/about",
  "/hitta-hit",
];

interface FetchOutcome {
  html: string | null;
  /** HTTP status, or "abort"/"error" when the request never completed. */
  status: number | string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch one page with browser-like headers, following redirects. Retries once on
// a transient failure (5xx / 429 / network error) — small Nordic hosts (Loopia,
// One.com, etc.) often throttle server-side traffic, and a single retry clears
// most of it.
async function fetchHtml(
  url: string,
  signal: AbortSignal,
  attempt = 0,
): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal,
      headers: {
        // Look like a real browser: some hosts 403 anything that doesn't send a
        // full header set (UA + Accept-Language + Referer).
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
        Referer: "https://www.google.com/",
      },
    });
    if (!res.ok) {
      if ((res.status >= 500 || res.status === 429) && attempt < 1 && !signal.aborted) {
        await sleep(500);
        return fetchHtml(url, signal, attempt + 1);
      }
      return { html: null, status: res.status };
    }
    const text = await res.text();
    return { html: text.slice(0, 200_000), status: 200 };
  } catch (err) {
    const aborted = signal.aborted || (err instanceof Error && err.name === "AbortError");
    if (!aborted && attempt < 1) {
      await sleep(500);
      return fetchHtml(url, signal, attempt + 1);
    }
    return { html: null, status: aborted ? "abort" : "error" };
  }
}

// --- Phone extraction --------------------------------------------------------

// `tel:` links are the most reliable signal a site gives us.
const TEL_HREF = /tel:([+0-9()\s.\-/]{6,})/gi;
// Visible-text phone-like tokens. We REQUIRE a leading +, 00, or 0 so we don't
// pick up Swedish org numbers (which start 5/6/7/8) or years/prices.
const PHONE_TEXT = /(?:\+\d|00\d|0\d)[\d\s().\-/]{5,}\d/g;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

/** Pull every plausible phone string out of one HTML page. */
function extractPhonesFromHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(TEL_HREF)) out.push(m[1]);
  const text = stripTags(html);
  for (const m of text.matchAll(PHONE_TEXT)) out.push(m[0]);
  return out;
}

// E.164 sanity: 8–15 digits after the +. Filters out captured noise.
function isPlausibleE164(e164: string): boolean {
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

// --- The model call ----------------------------------------------------------

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_phones",
  description:
    "Report every phone number you found that belongs to this business/person. Call this exactly once after searching, even if you found none (pass an empty array).",
  input_schema: {
    type: "object",
    properties: {
      phones: {
        type: "array",
        description: "All distinct phone numbers found for THIS specific business/person.",
        items: {
          type: "object",
          properties: {
            number: {
              type: "string",
              description: "The phone number, ideally in full international form (e.g. +46 8 123 45 67).",
            },
            label: {
              type: "string",
              description: "What kind of line it is if known: Main, Mobile, Service, Reception, etc. Empty if unknown.",
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "How sure you are this number belongs to THIS specific entity.",
            },
            source_url: {
              type: "string",
              description: "The page URL where you saw the number, if any.",
            },
          },
          required: ["number", "confidence"],
        },
      },
      reasoning: {
        type: "string",
        description: "One short sentence on how you matched the business (or why nothing was found).",
      },
    },
    required: ["phones", "reasoning"],
  },
};

interface ReportPhone {
  number: string;
  label?: string;
  confidence?: string;
  source_url?: string;
}
interface ReportInput {
  phones: ReportPhone[];
  reasoning?: string;
}

/**
 * Find all phone numbers linked to a contact and/or their company.
 *  1. Scrape the known website(s) — contact pages, `tel:` links, visible text.
 *  2. Run a Claude web search by name + company + location for any others.
 *  3. Normalize everything to E.164, drop numbers already on the record, dedupe.
 */
export async function findPhones(input: FindPhonesInput): Promise<FindPhonesResult> {
  const hint = input.countryCode;
  const existing = new Set(
    (input.existing ?? [])
      .map((p) => normalizePhone(p, hint))
      .filter((p): p is string => !!p),
  );

  // Keep the best candidate per E.164 number (first writer wins on order, but a
  // higher confidence later upgrades it).
  const byNumber = new Map<string, PhoneCandidate>();
  const add = (c: PhoneCandidate) => {
    if (!isPlausibleE164(c.number) || existing.has(c.number)) return;
    const prev = byNumber.get(c.number);
    if (!prev) {
      byNumber.set(c.number, c);
      return;
    }
    // Prefer a website source and higher confidence when merging duplicates.
    const rank = (x: PhoneCandidate) =>
      (x.source === "website" ? 2 : 0) +
      (x.confidence === "high" ? 2 : x.confidence === "medium" ? 1 : 0);
    if (rank(c) > rank(prev)) byNumber.set(c.number, c);
  };

  // 1. Scrape known websites.
  const sites = Array.from(
    new Set((input.websites ?? []).map(normalizeUrl).filter((u): u is string => !!u)),
  );
  // Per-page fetch outcomes, surfaced in `reasoning` so a host that refuses our
  // server-side requests reads as "fetch blocked" instead of "no numbers".
  const fetchLog: { url: string; status: number | string }[] = [];
  if (sites.length) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);

    const harvest = (url: string, outcome: FetchOutcome) => {
      fetchLog.push({ url, status: outcome.status });
      if (!outcome.html) return;
      for (const raw of extractPhonesFromHtml(outcome.html)) {
        const e164 = normalizePhone(raw, hint);
        if (!e164) continue;
        add({
          number: e164,
          raw: raw.trim().replace(/\s+/g, " "),
          label: null,
          source: "website",
          sourceUrl: url,
          confidence: "high",
        });
      }
    };

    try {
      // Hit each site's homepage FIRST and serially — footers are where the
      // numbers live, and a single browser-like request is far less likely to
      // be throttled than a 10-way parallel burst against a small host.
      const subPaths: string[] = [];
      for (const site of sites.slice(0, 2)) {
        harvest(site, await fetchHtml(site, controller.signal));
        for (const path of CONTACT_PATHS) if (path) subPaths.push(`${site}${path}`);
      }

      // Only crawl the contact/about sub-pages if the homepages gave us nothing,
      // and then only a few, in small batches of 3, so we never flood the host.
      if (byNumber.size === 0) {
        const targets = subPaths.slice(0, 8);
        for (let i = 0; i < targets.length; i += 3) {
          const batch = targets.slice(i, i + 3);
          const outcomes = await Promise.all(
            batch.map(async (url) => ({ url, outcome: await fetchHtml(url, controller.signal) })),
          );
          for (const { url, outcome } of outcomes) harvest(url, outcome);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // 1b. Google Maps (via Apify) — the fast, structured primary source. Runs only
  // when the website scrape came up empty (most of our market has no website on
  // file). Returns a trade-verified number plus the business's website/place_id,
  // and — like the scrape — lets us skip the slow AI web search when it hits.
  let discoveredWebsite: string | null = null;
  let discoveredPlaceId: string | null = null;
  let gmapsReasoning: string | null = null;
  if (byNumber.size === 0) {
    const gmaps = await findPhonesViaGoogleMaps({
      name: input.name,
      companyName: input.companyName,
      city: input.city,
      country: input.country,
      countryCode: input.countryCode,
      placeId: input.placeId,
    });
    if (gmaps) {
      gmapsReasoning = gmaps.reasoning;
      discoveredWebsite = gmaps.website;
      discoveredPlaceId = gmaps.placeId;
      for (const c of gmaps.candidates) add(c);
    }
  }

  // 2. Web search via Claude — needs something searchable.
  const searchSubject =
    [input.name, input.companyName].filter(Boolean).join(" / ").trim() ||
    input.companyName ||
    input.name ||
    "";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let searchReasoning: string | null = null;

  // Diagnostics for this run.
  const debug: FindPhonesDebug = {
    fetchLog,
    apiKeyPresent: !!apiKey,
    webSearchTurns: 0,
    reportCalled: false,
    webPhoneCount: 0,
    searchError: null,
  };

  const webBefore = byNumber.size;

  // Only run the (slow) AI web-search when the website scrape came up empty.
  // If the site already gave us a number, returning it in ~2s beats spending up
  // to a minute of web search — and, critically, avoids the 180s function
  // timeout that was killing the request and discarding the scraped number.
  if (searchSubject && apiKey && byNumber.size === 0) {
    // Hard wall-clock budget for the web-search phase so it can never consume
    // the whole serverless limit (scrape already used up to 25s).
    const webDeadline = Date.now() + 90_000;
    const client = new Anthropic({ apiKey });
    const location = [input.city, input.country].filter(Boolean).join(", ");

    const trade = [input.category, input.industry]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join(" / ");
    const tradeRule = trade
      ? `\n- This business is in this line of work: ${trade}. Only report numbers for a business in that trade. If the name matches a person or a business in a DIFFERENT industry, it is the wrong entity — do not report it.`
      : "";
    // Guard the hardest case: a person's name with no real business behind it.
    const personalRule = `\n- If this is a private individual and you cannot find a genuine business${trade ? ` in ${trade}` : ""} matching the name and town, report an EMPTY list — never guess a stranger's personal number.`;

    const system = `You find ALL the phone numbers for a specific business (and the person, if named). Use the web_search tool to look them up, then call report_phones with every number you find.

Rules:
- Return numbers that belong to THIS specific business/person — match on name, town, and trade.
- Prefer the business's own website, then reputable directories (hitta.se, eniro, Google Business). Avoid unrelated listings.
- Include all distinct lines: main/reception, mobile, service desk, etc. Label them when the source says what they are.
- Give each a confidence based on how sure you are it's the right entity.${tradeRule}${personalRule}
- If you genuinely can't find any, call report_phones with an empty phones array and explain in reasoning.
- Keep reasoning to one short sentence.
- You MUST finish by calling report_phones — do not answer in plain text.`;

    const msg =
      `Find all phone numbers for:\n` +
      (input.companyName ? `Company: ${input.companyName}\n` : "") +
      (input.name && input.name !== input.companyName ? `Person: ${input.name}\n` : "") +
      (trade ? `Trade: ${trade}\n` : "") +
      (location ? `Location: ${location}\n` : "") +
      (sites.length ? `Known website: ${sites[0]}\n` : "");

    const tools = [
      { type: "web_search_20260209", name: "web_search", max_uses: 5 } as unknown as Anthropic.Tool,
      REPORT_TOOL,
    ];

    const findReport = (content: Anthropic.ContentBlock[]) =>
      content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "report_phones",
      );

    const ingestReport = (report: Anthropic.ToolUseBlock) => {
      debug.reportCalled = true;
      const out = report.input as ReportInput;
      searchReasoning = out.reasoning ?? searchReasoning;
      for (const p of out.phones ?? []) {
        const e164 = normalizePhone(p.number, hint);
        if (!e164) continue;
        add({
          number: e164,
          raw: (p.number || "").trim().replace(/\s+/g, " ") || e164,
          label: p.label?.trim() || null,
          source: "web-search",
          sourceUrl: normalizeUrl(p.source_url) || null,
          confidence: ["high", "medium", "low"].includes(p.confidence ?? "")
            ? (p.confidence as string)
            : "medium",
        });
      }
    };

    try {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: msg }];
      let report: Anthropic.ToolUseBlock | undefined;

      // Drive the server-tool loop: the model runs web_search, and may hand back
      // a `pause_turn` (its search loop hit the limit) that we must re-send to
      // continue. Stop once it calls report_phones or finishes its turn.
      for (let turn = 0; turn < 3 && !report; turn++) {
        if (Date.now() > webDeadline) break; // out of budget → force a report below
        const resp = await client.messages.create({ model: MODEL, max_tokens: 1500, system, tools, messages });
        debug.webSearchTurns++;
        report = findReport(resp.content);
        if (report) break;
        messages.push({ role: "assistant", content: resp.content });
        if (resp.stop_reason !== "pause_turn") break; // end_turn / text answer → force below
      }

      // If it never called report_phones (answered in prose, or stopped early),
      // force the structured report so its research isn't thrown away.
      if (!report) {
        messages.push({
          role: "user",
          content:
            "Now call report_phones with every phone number you found in your research. " +
            "If you found none, call it with an empty phones array and say so in reasoning.",
        });
        const forced = await client.messages.create({
          model: MODEL,
          max_tokens: 800,
          system,
          tools,
          tool_choice: { type: "tool", name: "report_phones" },
          messages,
        });
        debug.webSearchTurns++;
        report = findReport(forced.content);
      }

      if (report) ingestReport(report);
    } catch (err) {
      debug.searchError = err instanceof Error ? err.message : "Web search failed.";
      searchReasoning = debug.searchError;
    }
  }

  debug.webPhoneCount = Math.max(0, byNumber.size - webBefore);
  // One structured log line so production failures are visible in Vercel logs.
  console.log(
    "[find-phone]",
    JSON.stringify({
      subject: searchSubject || null,
      sites: sites.length,
      gmaps: gmapsReasoning,
      ...debug,
    }),
  );

  // 3. Rank: website > google-maps > web-search, then confidence.
  const order = (c: PhoneCandidate) =>
    (c.source === "website" ? 100 : c.source === "google-maps" ? 60 : 0) +
    (c.confidence === "high" ? 10 : c.confidence === "medium" ? 5 : 0);
  const phones = Array.from(byNumber.values()).sort((a, b) => order(b) - order(a));

  // If the website was reachable neither with a 200 nor an honest 404, the host
  // is likely refusing our server-side requests — call that out explicitly.
  const blocked = fetchLog.filter((f) => f.status !== 200 && f.status !== 404);
  const fetchNote =
    !phones.length && sites.length && blocked.length && blocked.length === fetchLog.length
      ? ` Could not read the website (${Array.from(new Set(blocked.map((b) => String(b.status)))).join(
          ", ",
        )}) — the host may be blocking server-side requests.`
      : "";

  const reasoning = phones.length
    ? `Found ${phones.length} number${phones.length === 1 ? "" : "s"} (${phones[0].source}).`
    : (searchReasoning ||
        gmapsReasoning ||
        (sites.length || searchSubject
          ? "No phone numbers could be found for this contact."
          : "No website or name to search with.")) + fetchNote;

  return {
    found: phones.length > 0,
    phones,
    reasoning,
    debug,
    discoveredWebsite,
    discoveredPlaceId,
  };
}
