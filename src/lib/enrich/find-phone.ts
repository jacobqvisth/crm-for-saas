import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { normalizePhone } from "@/lib/calls/phone";
import { aiProviderStatus } from "@/lib/ai/provider";
import { groundedExtract } from "@/lib/ai/grounded";
import { findPhonesViaGoogleMaps } from "@/lib/enrich/find-phone-gmaps";

// Auxiliary AI-helper endpoint — uses the project's standard helper model
// (claude-sonnet-4-6, same as find-website / inbox drafts / call summaries).
// Manually triggered, low volume, so Sonnet + web search is the right point.
const MODEL = "claude-sonnet-4-6";

// --- Time budget -------------------------------------------------------------
// The route allows 180s. We aim to be done in 150 so there's room for the DB
// writes and the response, and so a slow leg can never get the whole function
// killed (a kill discards every number we already found).
const DEFAULT_BUDGET_MS = 150_000;
/** Max for the website scrape, and the reserve kept back for the legs after it. */
const SCRAPE_MAX_MS = 25_000;
const SCRAPE_RESERVE_MS = 70_000;
/** Max for the Google-Maps lookup, and the reserve kept back for web search. */
const GMAPS_MAX_MS = 55_000;
const GMAPS_RESERVE_MS = 45_000;
/** Kept back from the web-search leg for ranking + the response itself. */
const RESPONSE_RESERVE_MS = 8_000;
/** Ceiling for the web search. A real business resolves in 10-30s; a subject the
 *  model can't pin down (a private individual with no business behind the name)
 *  will otherwise spend every second it is given and still report nothing, so
 *  cap it rather than make the user wait out the whole budget for a no. */
const WEB_SEARCH_MAX_MS = 75_000;
/** A web-search leg shorter than this can't complete a turn — skip it instead. */
const WEB_SEARCH_MIN_MS = 20_000;
/** The forced report_phones call needs roughly this much left to be worth trying. */
const FORCED_REPORT_MS = 25_000;

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

/** The ordered legs of a phone search, as reported to the UI. */
export type PhoneSearchStage =
  | "record"
  | "website-discovery"
  | "scrape"
  | "google-maps"
  | "web-search"
  | "save";

/** One progress tick. Emitted as the finder enters/leaves each leg so the caller
 *  can stream a real "here's what I'm doing now" to the user instead of an
 *  opaque spinner. `detail` is short, human, and safe to render as-is. */
export interface PhoneSearchProgress {
  stage: PhoneSearchStage;
  status: "start" | "done" | "skip";
  /** Short human line, e.g. "Reading qvisth.se". */
  detail?: string | null;
  /** How many numbers we hold in total at this point. */
  found?: number;
}

export type PhoneProgressFn = (event: PhoneSearchProgress) => void;

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
  /** Absolute wall-clock deadline (ms epoch) for the WHOLE search. Every leg is
   *  budgeted out of the time actually left, and any leg that can't fit is
   *  skipped, so we always return results instead of being killed mid-flight by
   *  the serverless timeout (which discards everything). */
  deadline?: number;
  /** Called as each leg starts/finishes, for streaming progress to the UI. */
  onProgress?: PhoneProgressFn;
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
  /** Legs we had to skip or cut short because the wall-clock budget ran out. */
  skippedForTime?: PhoneSearchStage[];
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

/** Bare hostname, for progress lines the user reads ("Reading qvisth.se"). */
function hostOf(raw: string | null | undefined): string | null {
  try {
    return new URL(raw || "").hostname.replace(/^www\./, "") || null;
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
 * The same contract for the Gemini path, which needs a Zod schema rather than an
 * Anthropic tool. Optional fields are nullable rather than absent because Gemini
 * fills every property of a responseSchema; the ingest below already tolerates
 * empty values.
 */
const reportSchema = z.object({
  phones: z
    .array(
      z.object({
        number: z
          .string()
          .describe("The phone number, ideally in full international form (e.g. +46 8 123 45 67)."),
        label: z
          .string()
          .nullable()
          .describe("Main, Mobile, Service, Reception, etc. Null if unknown."),
        confidence: z
          .enum(["high", "medium", "low"])
          .describe("How sure this number belongs to THIS specific entity."),
        source_url: z.string().nullable().describe("The page URL where the number was seen."),
      }),
    )
    .describe("All distinct phone numbers found for THIS specific business/person."),
  reasoning: z
    .string()
    .describe("One short sentence on how the business was matched, or why nothing was found."),
});

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

  // --- Wall-clock budget ----------------------------------------------------
  // Without a global deadline the three legs' own budgets (25s + 55s + 90s) add
  // up to the entire serverless limit, and the last leg can overshoot its own —
  // so the function got killed and every result was thrown away. Each leg now
  // takes what's actually left, minus a reserve for the legs after it.
  const deadline = input.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const msLeft = () => deadline - Date.now();
  const skippedForTime: PhoneSearchStage[] = [];
  const report = input.onProgress ?? (() => {});
  const tick = (
    stage: PhoneSearchStage,
    status: PhoneSearchProgress["status"],
    detail?: string | null,
  ) => {
    try {
      report({ stage, status, detail: detail ?? null, found: byNumber.size });
    } catch {
      /* a broken progress consumer (client hung up) must never fail the search */
    }
  };

  // 1. Scrape known websites.
  const sites = Array.from(
    new Set((input.websites ?? []).map(normalizeUrl).filter((u): u is string => !!u)),
  );
  // Per-page fetch outcomes, surfaced in `reasoning` so a host that refuses our
  // server-side requests reads as "fetch blocked" instead of "no numbers".
  const fetchLog: { url: string; status: number | string }[] = [];
  const scrapeBudget = Math.min(SCRAPE_MAX_MS, msLeft() - SCRAPE_RESERVE_MS);
  if (sites.length && scrapeBudget <= 0) {
    skippedForTime.push("scrape");
    tick("scrape", "skip", "Out of time to read the website");
  } else if (sites.length) {
    tick("scrape", "start", `Reading ${hostOf(sites[0]) ?? "the website"}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), scrapeBudget);

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
          if (controller.signal.aborted) break;
          const batch = targets.slice(i, i + 3);
          tick("scrape", "start", `Checking contact pages (${i + 1}-${Math.min(i + 3, targets.length)} of ${targets.length})`);
          const outcomes = await Promise.all(
            batch.map(async (url) => ({ url, outcome: await fetchHtml(url, controller.signal) })),
          );
          for (const { url, outcome } of outcomes) harvest(url, outcome);
        }
      }
    } finally {
      clearTimeout(timer);
    }
    tick(
      "scrape",
      "done",
      byNumber.size
        ? `Found ${byNumber.size} on the website`
        : "Nothing listed on the website",
    );
  } else {
    tick("scrape", "skip", "No website saved to read");
  }

  // 1b. Google Maps (via Apify) — the fast, structured primary source. Runs only
  // when the website scrape came up empty (most of our market has no website on
  // file). Returns a trade-verified number plus the business's website/place_id,
  // and — like the scrape — lets us skip the slow AI web search when it hits.
  let discoveredWebsite: string | null = null;
  let discoveredPlaceId: string | null = null;
  let gmapsReasoning: string | null = null;
  if (byNumber.size === 0) {
    const gmapsBudget = Math.min(GMAPS_MAX_MS, msLeft() - GMAPS_RESERVE_MS);
    if (gmapsBudget <= 0) {
      skippedForTime.push("google-maps");
      tick("google-maps", "skip", "Out of time for Google Maps");
    } else {
      tick("google-maps", "start", "Looking the business up on Google Maps");
      const gmaps = await findPhonesViaGoogleMaps({
        name: input.name,
        companyName: input.companyName,
        city: input.city,
        country: input.country,
        countryCode: input.countryCode,
        placeId: input.placeId,
        budgetMs: gmapsBudget,
      });
      if (gmaps) {
        gmapsReasoning = gmaps.reasoning;
        discoveredWebsite = gmaps.website;
        discoveredPlaceId = gmaps.placeId;
        for (const c of gmaps.candidates) add(c);
      }
      tick(
        "google-maps",
        "done",
        gmaps
          ? byNumber.size
            ? `Google Maps: ${gmaps.matchedTitle ?? "matched"}`
            : gmaps.reasoning
          : "Google Maps lookup unavailable",
      );
    }
  } else {
    tick("google-maps", "skip", "Not needed, the website had a number");
  }

  // 2. Web search via Claude — needs something searchable.
  const searchSubject =
    [input.name, input.companyName].filter(Boolean).join(" / ").trim() ||
    input.companyName ||
    input.name ||
    "";
  // Which providers can run the search, in the layer's preferred order. Either
  // one can do it, so the gates below ask this rather than one vendor's key.
  const providers = aiProviderStatus().order;
  const aiConfigured = providers.length > 0;
  let searchReasoning: string | null = null;

  // Diagnostics for this run.
  const debug: FindPhonesDebug = {
    fetchLog,
    // Named for the Anthropic-only era; now means "some AI provider is usable".
    apiKeyPresent: aiConfigured,
    webSearchTurns: 0,
    reportCalled: false,
    webPhoneCount: 0,
    searchError: null,
    skippedForTime,
  };

  const webBefore = byNumber.size;
  // What's left for the web search, after reserving time to rank + respond, and
  // never more than the leg's own ceiling.
  const webBudget = Math.min(WEB_SEARCH_MAX_MS, msLeft() - RESPONSE_RESERVE_MS);

  // Only run the (slow) AI web-search when the website scrape came up empty.
  // If the site already gave us a number, returning it in ~2s beats spending up
  // to a minute of web search — and, critically, avoids the 180s function
  // timeout that was killing the request and discarding the scraped number.
  if (searchSubject && aiConfigured && byNumber.size === 0 && webBudget < WEB_SEARCH_MIN_MS) {
    // Not enough left to complete even one search turn. Bail out cleanly rather
    // than start work the function timeout will throw away.
    skippedForTime.push("web-search");
    tick("web-search", "skip", "Out of time for the web search");
    searchReasoning =
      "Ran out of time before the web search could run. Try again, the website and Google Maps results are saved.";
  } else if (searchSubject && aiConfigured && byNumber.size === 0) {
    tick("web-search", "start", `Searching the web for ${searchSubject}`);
    // Hard wall-clock budget for the web-search phase, taken from the time that
    // is actually left rather than a fixed 90s that could overrun the function.
    const webDeadline = Date.now() + webBudget;
    // An AbortSignal is what actually stops an in-flight turn: the old
    // between-turns deadline check let a single long turn (plus the unguarded
    // forced report) run past the budget and 504 the whole request.
    const webController = new AbortController();
    const webTimer = setTimeout(() => webController.abort(), webBudget);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

    // The matching rules, which are about WHICH numbers count and are the same
    // whatever provider is asked. Kept separate from the output instruction
    // because the two providers need opposite things: Anthropic must end in a
    // tool call, while Gemini's grounded step must answer in prose (a system
    // prompt forbidding plain text made it return nothing at all).
    const searchRules = `You find ALL the phone numbers for a specific business (and the person, if named).

Rules:
- Return numbers that belong to THIS specific business/person — match on name, town, and trade.
- Prefer the business's own website, then reputable directories (hitta.se, eniro, Google Business). Avoid unrelated listings.
- Include all distinct lines: main/reception, mobile, service desk, etc. Label them when the source says what they are.
- Give each a confidence based on how sure you are it's the right entity.${tradeRule}${personalRule}
- If you genuinely can't find any, say so plainly rather than offering a number you are unsure of.
- Keep reasoning to one short sentence.`;

    const system = `${searchRules}
- Use the web_search tool to look them up, then call report_phones with every number you find.
- If you genuinely can't find any, call report_phones with an empty phones array and explain in reasoning.
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

    const ingestReport = (out: ReportInput) => {
      debug.reportCalled = true;
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

    /**
     * Anthropic: its server-side web_search runs inside the turn loop, so the
     * research and the structured report resolve in one conversation. Unchanged
     * from before the Gemini path existed.
     */
    const runAnthropicSearch = async (): Promise<boolean> => {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: msg }];
      let report: Anthropic.ToolUseBlock | undefined;

      // Drive the server-tool loop: the model runs web_search, and may hand back
      // a `pause_turn` (its search loop hit the limit) that we must re-send to
      // continue. Stop once it calls report_phones or finishes its turn.
      for (let turn = 0; turn < 3 && !report; turn++) {
        if (Date.now() > webDeadline) break; // out of budget → force a report below
        if (turn > 0) tick("web-search", "start", `Still searching (round ${turn + 1})`);
        const resp = await client.messages.create(
          { model: MODEL, max_tokens: 1500, system, tools, messages },
          { signal: webController.signal },
        );
        debug.webSearchTurns++;
        report = findReport(resp.content);
        if (report) break;
        messages.push({ role: "assistant", content: resp.content });
        if (resp.stop_reason !== "pause_turn") break; // end_turn / text answer → force below
      }

      // If it never called report_phones (answered in prose, or stopped early),
      // force the structured report so its research isn't thrown away — but only
      // when there's genuinely time for it. Unguarded, this second call is what
      // pushed the request past the function timeout.
      if (!report && msLeft() > FORCED_REPORT_MS) {
        tick("web-search", "start", "Collecting the results");
        messages.push({
          role: "user",
          content:
            "Now call report_phones with every phone number you found in your research. " +
            "If you found none, call it with an empty phones array and say so in reasoning.",
        });
        const forced = await client.messages.create(
          {
            model: MODEL,
            max_tokens: 800,
            system,
            tools,
            tool_choice: { type: "tool", name: "report_phones" },
            messages,
          },
          { signal: webController.signal },
        );
        debug.webSearchTurns++;
        report = findReport(forced.content);
      } else if (!report) {
        skippedForTime.push("web-search");
      }

      if (!report) return false;
      ingestReport(report.input as ReportInput);
      return true;
    };

    /**
     * Gemini: grounding and structured output cannot be requested together
     * without the search being silently skipped, so this is two calls (ground,
     * then extract) and an answer with no grounding evidence is rejected rather
     * than ingested. A fabricated phone number on a real contact is worse than
     * an empty field. See src/lib/ai/grounded.ts.
     */
    const runGeminiSearch = async (): Promise<boolean> => {
      const out = await groundedExtract({
        label: "enrich/find-phone",
        // The rules only. The Anthropic `system` forbids plain-text answers,
        // which makes the grounded step return nothing at all.
        searchSystem: `${searchRules}\n- Answer in plain prose: list each number you found and the page it came from.`,
        searchPrompt: `${msg}\nSearch the web and report every phone number you find, with the page it came from.`,
        extractSystem:
          `${searchRules}\n\nList every distinct number that appears in the findings and belongs to ` +
          `THIS entity. If the findings contain none, return an empty phones array and say so.`,
        schema: reportSchema,
        strong: true,
        searchMaxTokens: 2500,
        signal: webController.signal,
      });

      debug.webSearchTurns++;
      if (!out.ok) {
        debug.searchError = out.reason;
        return false;
      }

      ingestReport({
        phones: out.data.phones.map((p) => ({
          number: p.number,
          label: p.label ?? undefined,
          confidence: p.confidence,
          source_url: p.source_url ?? undefined,
        })),
        reasoning: out.data.reasoning,
      });
      return true;
    };

    try {
      // Try each configured provider in the layer's order, stopping as soon as
      // one produces numbers. A provider that reports an empty list has still
      // done the job, so only an outright failure moves to the next one.
      for (const provider of providers) {
        if (Date.now() > webDeadline) break;
        const served =
          provider === "anthropic" ? await runAnthropicSearch() : await runGeminiSearch();
        if (served) break;
      }
    } catch (err) {
      const aborted =
        webController.signal.aborted || (err instanceof Error && err.name === "AbortError");
      debug.searchError = aborted
        ? "The web search ran out of time."
        : err instanceof Error
          ? err.message
          : "Web search failed.";
      if (aborted) skippedForTime.push("web-search");
      searchReasoning = debug.searchError;
    } finally {
      clearTimeout(webTimer);
    }
    tick(
      "web-search",
      "done",
      byNumber.size > webBefore
        ? `Web search found ${byNumber.size - webBefore}`
        : "Web search found nothing",
    );
  } else if (byNumber.size > 0) {
    tick("web-search", "skip", "Not needed, already found a number");
  } else if (!aiConfigured) {
    tick("web-search", "skip", "Web search is not configured");
  } else {
    tick("web-search", "skip", "Nothing searchable on this record");
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

  // On a miss, say what each leg concluded. Reporting only the web-search result
  // used to hide the real cause, e.g. that the Google-Maps leg never ran because
  // the Apify usage cap was blown.
  const missNotes = [searchReasoning, gmapsReasoning].filter(
    (s): s is string => !!s && !!s.trim(),
  );
  const reasoning = phones.length
    ? `Found ${phones.length} number${phones.length === 1 ? "" : "s"} (${phones[0].source}).`
    : (missNotes.length
        ? missNotes.join(" ")
        : sites.length || searchSubject
          ? "No phone numbers could be found for this contact."
          : "No website or name to search with.") + fetchNote;

  return {
    found: phones.length > 0,
    phones,
    reasoning,
    debug,
    discoveredWebsite,
    discoveredPlaceId,
  };
}
