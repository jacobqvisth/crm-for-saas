import Anthropic from "@anthropic-ai/sdk";

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

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_website",
  description:
    "Report the official website you found (or that none could be confidently found). Call this exactly once after searching.",
  input_schema: {
    type: "object",
    properties: {
      found: {
        type: "boolean",
        description: "true only if you found a website you are reasonably confident belongs to this exact business/person.",
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

/**
 * Find a contact/company's website.
 *  1. If they have a custom (non-free) email domain, that domain IS the site.
 *  2. Otherwise, search the web with Claude (name + location) for the official site.
 */
export async function findWebsite(input: FindWebsiteInput): Promise<FindWebsiteResult> {
  // 1. Custom email domain shortcut — no API call needed.
  const customDomain = customDomainFrom(input);
  if (customDomain) {
    return {
      found: true,
      website: `https://${customDomain}`,
      confidence: "high",
      reasoning: `Derived from the contact's email domain (${customDomain}).`,
      source: "email-domain",
    };
  }

  // 2. Web search — needs a name to have any chance.
  const name = (input.name ?? "").trim();
  if (!name) {
    return { found: false, website: null, confidence: null, reasoning: "No company name or custom email domain to search with.", source: null };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { found: false, website: null, confidence: null, reasoning: "ANTHROPIC_API_KEY not set.", source: null };
  }
  const client = new Anthropic({ apiKey });

  const location = [input.city, input.country].filter(Boolean).join(", ");
  const emailHint = input.email ? ` Their email is ${input.email}.` : "";

  const system = `You find the official website for a specific business or person. Use the web_search tool to look them up, then call report_website exactly once.

Rules:
- Match the EXACT business/person described, in the right location. Do not return a generic directory page (e.g. a Google Maps, Eniro, Yelp, hitta.se, or Facebook listing) when an own website exists — but a Facebook/Instagram page IS acceptable as a low/medium-confidence answer if that's clearly all they have.
- Prefer the business's own domain.
- If you cannot confidently find the right one, set found=false rather than guessing.
- Keep reasoning to one short sentence.`;

  const userMsg =
    `Find the official website for:\n` +
    `Name: ${name}\n` +
    (location ? `Location: ${location}\n` : "") +
    emailHint;

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

    // The web_search server-tool loop runs inside each create() call; we only
    // re-send on pause_turn (server hit its internal iteration cap).
    for (let i = 0; i < 4; i++) {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 4 } as unknown as Anthropic.Tool,
          REPORT_TOOL,
        ],
        messages,
      });

      const report = resp.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "report_website",
      );
      if (report) {
        const out = report.input as ReportInput;
        const url = out.found ? normalizeUrl(out.website) : null;
        return {
          found: Boolean(url),
          website: url,
          confidence: out.confidence ?? null,
          reasoning: out.reasoning ?? null,
          source: url ? "web-search" : null,
        };
      }

      if (resp.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: resp.content });
        continue;
      }
      break; // end_turn with no report → treat as not found
    }
    return { found: false, website: null, confidence: null, reasoning: "No confident match found.", source: null };
  } catch (err) {
    return {
      found: false,
      website: null,
      confidence: null,
      reasoning: err instanceof Error ? err.message : "Website search failed.",
      source: null,
    };
  }
}
