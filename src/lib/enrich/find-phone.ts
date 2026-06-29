import Anthropic from "@anthropic-ai/sdk";
import { normalizePhone } from "@/lib/calls/phone";

// Auxiliary AI-helper endpoint — uses the project's standard helper model
// (claude-sonnet-4-6, same as find-website / inbox drafts / call summaries).
// Manually triggered, low volume, so Sonnet + web search is the right point.
const MODEL = "claude-sonnet-4-6";

export type PhoneSource = "website" | "web-search";

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
  /** Numbers already on the record — excluded from the results so we only
   *  surface NEW finds. */
  existing?: (string | null | undefined)[];
}

export interface FindPhonesResult {
  found: boolean;
  phones: PhoneCandidate[];
  reasoning: string | null;
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

async function fetchHtml(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 200_000);
  } catch {
    return null;
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
  if (sites.length) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      // Cap the crawl: at most the first 2 sites × the contact paths, ~10 pages.
      const targets: string[] = [];
      for (const site of sites.slice(0, 2)) {
        for (const path of CONTACT_PATHS) targets.push(`${site}${path}`);
      }
      const pages = await Promise.all(
        targets.slice(0, 10).map(async (url) => ({
          url,
          html: await fetchHtml(url, controller.signal),
        })),
      );
      for (const { url, html } of pages) {
        if (!html) continue;
        for (const raw of extractPhonesFromHtml(html)) {
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
      }
    } finally {
      clearTimeout(timer);
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

  if (searchSubject && apiKey) {
    const client = new Anthropic({ apiKey });
    const location = [input.city, input.country].filter(Boolean).join(", ");

    const system = `You find ALL the phone numbers for a specific business (and the person, if named). Use the web_search tool to look them up, then call report_phones with every number you find.

Rules:
- Return numbers that belong to THIS specific business/person — match on name, town, and trade.
- Prefer the business's own website, then reputable directories (hitta.se, eniro, Google Business). Avoid unrelated listings.
- Include all distinct lines: main/reception, mobile, service desk, etc. Label them when the source says what they are.
- Give each a confidence based on how sure you are it's the right entity.
- If you genuinely can't find any, call report_phones with an empty phones array and explain in reasoning.
- Keep reasoning to one short sentence.`;

    const msg =
      `Find all phone numbers for:\n` +
      (input.companyName ? `Company: ${input.companyName}\n` : "") +
      (input.name && input.name !== input.companyName ? `Person: ${input.name}\n` : "") +
      (location ? `Location: ${location}\n` : "") +
      (sites.length ? `Known website: ${sites[0]}\n` : "");

    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 } as unknown as Anthropic.Tool,
          REPORT_TOOL,
        ],
        messages: [{ role: "user", content: msg }],
      });

      const report = resp.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "report_phones",
      );
      if (report) {
        const out = report.input as ReportInput;
        searchReasoning = out.reasoning ?? null;
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
      }
    } catch (err) {
      searchReasoning = err instanceof Error ? err.message : "Web search failed.";
    }
  }

  // 3. Rank: website > web-search, then confidence.
  const order = (c: PhoneCandidate) =>
    (c.source === "website" ? 100 : 0) +
    (c.confidence === "high" ? 10 : c.confidence === "medium" ? 5 : 0);
  const phones = Array.from(byNumber.values()).sort((a, b) => order(b) - order(a));

  const reasoning = phones.length
    ? `Found ${phones.length} number${phones.length === 1 ? "" : "s"}${
        sites.length ? " (website + web search)" : " (web search)"
      }.`
    : searchReasoning ||
      (sites.length || searchSubject
        ? "No phone numbers could be found for this contact."
        : "No website or name to search with.");

  return { found: phones.length > 0, phones, reasoning };
}
