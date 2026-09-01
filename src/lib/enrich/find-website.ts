import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiProviderStatus } from "@/lib/ai/provider";
import { groundedExtract } from "@/lib/ai/grounded";

// Auxiliary AI-helper endpoint — uses the project's standard helper model
// (claude-sonnet-4-6, same as inbox drafts / call summaries / forums). This is
// a low-volume, manually-triggered lookup, so Sonnet + web search is the right
// cost/quality point.
const MODEL = "claude-sonnet-4-6";

// Free / generic mailbox providers — an email at one of these tells us nothing
// about the contact's own website, so we must fall back to a web search.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "live.com", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me", "gmx.com",
  "gmx.de", "mail.com", "zoho.com", "yandex.com", "yandex.ru",
  // Nordic consumer providers common in our data
  "telia.com", "telia.se", "hotmail.se", "live.se", "spray.se", "comhem.se",
  "bredband.net", "online.no", "hotmail.no", "live.no", "telenor.no",
  "suomi24.fi", "luukku.com", "elisanet.fi",
]);

export type WebsiteSource = "email-domain" | "web-search";

export interface FindWebsiteInput {
  name?: string | null;
  email?: string | null;
  /** Extra emails (contact.all_emails) — checked for a usable custom domain too. */
  extraEmails?: string[] | null;
  city?: string | null;
  country?: string | null;
  /** The business's trade/industry (e.g. "Automotive", "auto repair"). Used to
   *  reject a site that clearly belongs to a business in a different line of
   *  work — the main guard against matching a random namesake. */
  industry?: string | null;
  category?: string | null;
}

export interface FindWebsiteResult {
  found: boolean;
  website: string | null;
  /** "high" | "medium" | "low" */
  confidence: string | null;
  reasoning: string | null;
  source: WebsiteSource | null;
}

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;
  if (domain.endsWith(".invalid") || domain.endsWith(".local")) return null;
  return domain;
}

/** A custom (non-free, non-placeholder) email domain IS the website, effectively. */
function customDomainFrom(input: FindWebsiteInput): string | null {
  const emails = [input.email, ...(input.extraEmails ?? [])].filter(Boolean) as string[];
  for (const email of emails) {
    const domain = domainOf(email);
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) return domain;
  }
  return null;
}

function normalizeUrl(raw: string): string | null {
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// --- Liveness verification ---------------------------------------------------
// The model often proposes a plausible-but-dead domain (expired, parked, or a
// hosting placeholder). We fetch the candidate and classify it so we never
// auto-fill a URL that doesn't actually serve the business's site.

type LivenessStatus = "live" | "dead" | "unknown";

interface LivenessResult {
  status: LivenessStatus;
  reason: string;
  /** Where the URL ultimately resolved (after redirects), if reachable. */
  finalUrl: string | null;
}

// Signatures of parked / placeholder / unconfigured pages. Lower-cased haystack.
const PARKED_SIGNATURES = [
  "no active website on this domain",
  "no active website has been configured",
  "this domain points to a web server",
  "domain is parked",
  "this domain is parked",
  "parked free",
  "parked courtesy of",
  "buy this domain",
  "this domain is for sale",
  "domain for sale",
  "the domain you have entered is not configured",
  "website coming soon",
  "site under construction",
  "under construction",
  "future home of something quite cool",
  "default web page",
  "apache2 ubuntu default page",
  "welcome to nginx",
  "it works!",
  "plesk",
  "sedoparking",
  "parkingcrew",
  "this site can’t be reached",
  "domain not configured",
  "account suspended",
  "this account has been suspended",
];

async function fetchText(url: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal,
    headers: {
      // A realistic UA — some hosts serve placeholders or 403 to obvious bots.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  let text = "";
  try {
    const raw = await res.text();
    text = raw.slice(0, 60_000);
  } catch {
    /* body unreadable — status alone will drive the verdict */
  }
  return { ok: res.ok, status: res.status, text, finalUrl: res.url || url };
}

async function checkLiveness(rawUrl: string): Promise<LivenessResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { status: "dead", reason: "not a valid URL", finalUrl: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  // An expired/invalid TLS cert (or any https-level failure) is itself a strong
  // "abandoned domain" signal — browsers refuse it. We still try http so a
  // legit http-only site isn't condemned, but we remember the https failure.
  let httpsFailed = false;
  try {
    let result: { ok: boolean; status: number; text: string; finalUrl: string };
    try {
      result = await fetchText(url, controller.signal);
    } catch {
      // https failed at the network level — try http once before giving up.
      if (url.startsWith("https://")) {
        httpsFailed = true;
        try {
          result = await fetchText(url.replace(/^https:/, "http:"), controller.signal);
        } catch {
          return { status: "dead", reason: "domain did not resolve / TLS or connection failed", finalUrl: null };
        }
      } else {
        return { status: "dead", reason: "connection failed", finalUrl: null };
      }
    }

    const { ok, status, text, finalUrl } = result;

    // 404 / 410 / 5xx → not a usable site. 401/403/429 are ambiguous (bot
    // blocking / auth) so we don't condemn the domain on those.
    if (status === 404 || status === 410 || status >= 500) {
      return { status: "dead", reason: `returned HTTP ${status}`, finalUrl };
    }
    if (status === 401 || status === 403 || status === 429) {
      return { status: "unknown", reason: `returned HTTP ${status} (blocked our check, may still be a real site)`, finalUrl };
    }

    const hay = text.toLowerCase();
    const hit = PARKED_SIGNATURES.find((sig) => hay.includes(sig));
    if (hit) {
      return { status: "dead", reason: `looks like a parked/placeholder page ("${hit}")`, finalUrl };
    }

    // Practically empty body on a 200 → likely a stub / JS-only parking page.
    const visibleLen = hay.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().length;
    if (visibleLen < 80 && text.length < 2000) {
      // Empty body reached only over http after https died = abandoned domain
      // serving a host placeholder (e.g. a JS-rendered "no active website" page).
      if (httpsFailed) {
        return { status: "dead", reason: "TLS cert failed and the page served almost no content (parked/abandoned)", finalUrl };
      }
      return { status: "unknown", reason: "page loaded but had almost no content", finalUrl };
    }

    if (ok) return { status: "live", reason: "page loads with real content", finalUrl };
    return { status: "unknown", reason: `HTTP ${status}`, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

// --- The model call ----------------------------------------------------------

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_website",
  description:
    "Report the official website you found (or that none could be confidently found). Call this exactly once per turn after searching.",
  input_schema: {
    type: "object",
    properties: {
      found: {
        type: "boolean",
        description: "true only if you found a LIVE website you are reasonably confident belongs to this exact business/person.",
      },
      website: {
        type: "string",
        description: "The full website URL including https://, or empty string if not found.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "How confident you are this is the correct site for THIS specific entity.",
      },
      reasoning: {
        type: "string",
        description: "One short sentence on how you matched it (or why you couldn't).",
      },
    },
    required: ["found", "website", "confidence", "reasoning"],
  },
};

interface ReportInput {
  found: boolean;
  website: string;
  confidence: string;
  reasoning: string;
}

/**
 * The same shape for the Gemini path, which needs a Zod schema rather than an
 * Anthropic tool. `website` is nullable here because Gemini will not reliably
 * emit an empty string for "nothing found"; normalizeUrl() treats null and ""
 * the same, so the loop below is unaffected.
 */
const reportSchema = z.object({
  found: z
    .boolean()
    .describe("true only if a LIVE website was found that belongs to this exact business/person."),
  website: z
    .string()
    .nullable()
    .describe("The full website URL including https://, or null if not found."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How confident this is the correct site for THIS specific entity."),
  reasoning: z.string().describe("One short sentence on how it was matched, or why it was not."),
});

/**
 * Find a contact/company's website.
 *  1. If they have a custom (non-free) email domain, that domain IS the site —
 *     but only if it actually loads (verified live).
 *  2. Otherwise, search the web with Claude (name + location), and verify each
 *     candidate is live before accepting it — re-searching if a domain is dead.
 */
export async function findWebsite(input: FindWebsiteInput): Promise<FindWebsiteResult> {
  const rejected = new Set<string>();

  // 1. Custom email domain shortcut — verify it actually serves a site.
  const customDomain = customDomainFrom(input);
  if (customDomain) {
    const live = await checkLiveness(`https://${customDomain}`);
    if (live.status === "live") {
      return {
        found: true,
        website: live.finalUrl || `https://${customDomain}`,
        confidence: "high",
        reasoning: `From the contact's email domain (${customDomain}).`,
        source: "email-domain",
      };
    }
    if (live.status === "unknown") {
      return {
        found: true,
        website: live.finalUrl || `https://${customDomain}`,
        confidence: "medium",
        reasoning: `From the contact's email domain (${customDomain}) — couldn't fully verify it loads.`,
        source: "email-domain",
      };
    }
    // Dead — don't trust it; let the web search find the real site instead.
    rejected.add(customDomain);
  }

  // 2. Web search — needs a name to have any chance.
  const name = (input.name ?? "").trim();
  if (!name) {
    if (customDomain) {
      // We had a domain but it was dead and nothing else to go on.
      return { found: false, website: null, confidence: null, reasoning: `The email domain ${customDomain} has no live website, and there's no name to search with.`, source: null };
    }
    return { found: false, website: null, confidence: null, reasoning: "No company name or custom email domain to search with.", source: null };
  }

  // Either provider can search, so the gate asks the provider layer.
  const providers = aiProviderStatus().order;
  if (providers.length === 0) {
    return {
      found: false,
      website: null,
      confidence: null,
      reasoning: "No AI provider is configured.",
      source: null,
    };
  }

  const location = [input.city, input.country].filter(Boolean).join(", ");
  const emailHint = input.email ? ` Their email is ${input.email}.` : "";
  const trade = [input.category, input.industry]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" / ");
  // A free/personal email provider (no custom domain) + a person's name is the
  // hardest, most error-prone case — it's easy to match a random namesake. We
  // knew this above when customDomain came back null but an email was present.
  const freeEmail = !!input.email && !customDomain;

  const tradeRule = trade
    ? `\n- This business is in this line of work: ${trade}. The site you return MUST plausibly belong to a business in that trade. If the only site you can find for this name is in an unrelated industry, it is NOT the right one — set found=false.`
    : "";
  const personalRule = freeEmail
    ? `\n- This contact uses a personal/free email provider and may simply be a private individual, not a business. A person's name on its own is NOT enough to claim a business website. Only return a site if the name, town${trade ? ", and trade" : ""} clearly line up; otherwise set found=false rather than guessing.`
    : "";

  // The matching rules, which are about WHICH site counts and are identical
  // whatever provider is asked. Kept separate from the output instruction
  // because the providers need opposite things: Anthropic ends in a tool call,
  // while Gemini's grounded step has to answer in prose.
  const searchRules = `You find the official, CURRENTLY-LIVE website for a specific business or person.

Rules:
- Return the business's OWN live homepage — the page that actually loads with their real content.
- A business often trades under a brand/domain different from its legal name (e.g. legal name "Huoltokorjaamo Saari Oy" but the live site is a brand domain). Search by the brand, the town, and the trade, not just the legal name.
- Do NOT return: parked/expired/placeholder domains, "no active website" / "domain for sale" pages, or directory/listing pages (Google Maps, Eniro, hitta.fi, Fonecta, Yelp). A Facebook/Instagram page is an acceptable LAST resort (low confidence) only if there is clearly no own website.
- An email's domain is a hint, but it may be dead — verify by finding the working site, don't just echo the email domain.
- If a candidate you found is reported back to you as parked/dead, find a DIFFERENT live site; never re-propose a rejected domain.
- If you cannot find a live site for THIS specific business, set found=false rather than guessing.${tradeRule}${personalRule}
- Keep reasoning to one short sentence.`;

  const system = `${searchRules}
- Use the web_search tool to look them up, then call report_website.`;

  const baseMsg =
    `Find the official live website for:\n` +
    `Name: ${name}\n` +
    (trade ? `Trade: ${trade}\n` : "") +
    (location ? `Location: ${location}\n` : "") +
    emailHint;

  let fallback: FindWebsiteResult | null = null; // best "unknown"-liveness candidate

  /**
   * One candidate from Anthropic: its server-side web_search and the report tool
   * resolve in a single call. Unchanged from before the Gemini path existed.
   */
  const proposeViaAnthropic = async (msg: string): Promise<ReportInput | null> => {
    const resp = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 4 } as unknown as Anthropic.Tool,
        REPORT_TOOL,
      ],
      messages: [{ role: "user", content: msg }],
    });

    const report = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "report_website",
    );
    // No tool call (e.g. pause_turn mid-search): the caller just tries again.
    return report ? (report.input as ReportInput) : null;
  };

  /**
   * One candidate from Gemini. Two calls, because asking Gemini for grounding
   * and a schema together silently skips the search: see lib/ai/grounded.ts.
   */
  const proposeViaGemini = async (msg: string): Promise<ReportInput | null> => {
    const out = await groundedExtract({
      label: "enrich/find-website",
      // The rules only: the Anthropic `system` names tools that do not exist in
      // a Gemini request, and forbids the prose the grounded step needs.
      searchSystem: `${searchRules}\n- Answer in plain prose: name the candidate sites you found and give their exact URLs.`,
      searchPrompt: `${msg}\n\nSearch the web and report what you find, including the exact URLs.`,
      extractSystem:
        `${searchRules}\n\nPick the single best candidate from the findings and report it. ` +
        `If the findings contain no live site that plausibly belongs to this exact business, set found=false.`,
      schema: reportSchema,
      strong: true,
    });

    if (!out.ok) return null;
    return {
      found: out.data.found,
      website: out.data.website ?? "",
      confidence: out.data.confidence,
      reasoning: out.data.reasoning,
    };
  };

  /** Try each configured provider in the layer's order until one proposes. */
  const propose = async (msg: string): Promise<ReportInput | null> => {
    for (const provider of providers) {
      const out =
        provider === "anthropic" ? await proposeViaAnthropic(msg) : await proposeViaGemini(msg);
      if (out) return out;
    }
    return null;
  };

  // Wall-clock guard. The route's maxDuration is 180s and a search turn is not
  // cheap: measured 2026-09-01, one Anthropic case took 197s across four turns,
  // which would have 504'd rather than returning the answer it had. The Gemini
  // path costs two calls per turn (ground, then extract), so the budget matters
  // more, not less. Stop STARTING turns past this and return the best candidate
  // so far.
  const searchDeadline = Date.now() + 140_000;

  try {
    // Each attempt is an INDEPENDENT search (server-side web_search can't be
    // safely continued across turns). We bake the growing reject-list into the
    // prompt so the model avoids dead domains it already proposed.
    for (let turn = 0; turn < 4; turn++) {
      if (turn > 0 && Date.now() > searchDeadline) break;
      const rejectNote = rejected.size
        ? `\n\nThese domains are dead/parked — do NOT return any of them, find a DIFFERENT live site: ${[...rejected].join(", ")}.`
        : "";

      const out = await propose(baseMsg + rejectNote);

      // Nothing proposed (a paused Anthropic turn, or a failed Gemini search):
      // just try a fresh attempt.
      if (!out) continue;

      const url = out.found ? normalizeUrl(out.website) : null;

      // Model says not found.
      if (!url) {
        return fallback ?? {
          found: false,
          website: null,
          confidence: null,
          reasoning: out.reasoning || "No live website could be found for this business.",
          source: null,
        };
      }

      const host = hostOf(url);

      // Model re-proposed a domain we already rejected — retry with it re-listed.
      if (rejected.has(host)) continue;

      const live = await checkLiveness(url);

      if (live.status === "live") {
        return {
          found: true,
          website: live.finalUrl || url,
          confidence: out.confidence ?? "medium",
          reasoning: out.reasoning ?? "Found via web search.",
          source: "web-search",
        };
      }

      if (live.status === "unknown" && !fallback) {
        // Keep as a fallback but try again for a definitively-live site.
        fallback = {
          found: true,
          website: live.finalUrl || url,
          confidence: "low",
          reasoning: `${out.reasoning ?? "Found via web search"} (note: couldn't fully verify the site loads).`,
          source: "web-search",
        };
      }

      rejected.add(host);
    }

    // Ran out of turns — use the best unverified candidate if we have one.
    return fallback ?? {
      found: false,
      website: null,
      confidence: null,
      reasoning: "Couldn't find a live website for this business.",
      source: null,
    };
  } catch (err) {
    return fallback ?? {
      found: false,
      website: null,
      confidence: null,
      reasoning: err instanceof Error ? err.message : "Website search failed.",
      source: null,
    };
  }
}
