// Translating a release article into Swedish for the site's secondary locale.
//
// Every release article on wrenchlane.com exists in English and Swedish, as one
// CMS item with a variant per locale. This produces the Swedish variant.
//
// WHAT IS AND IS NOT TRANSLATED
// The body is Webflow rich-text HTML carrying figure markup and CDN image URLs.
// Only the prose changes: the tags, the classes, the src attributes and the
// YouTube embed must survive byte-for-byte, or the images and video break. The
// model is told that plainly, and translateReleaseToSwedish() verifies it
// afterwards rather than trusting it, because a dropped <figure> is invisible
// until someone opens the Swedish page.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { stripLongDashes } from "@/lib/ai/no-long-dash";

// A careful translation, not a hard reasoning problem.
const MODEL = "claude-sonnet-5";

const schema = z.object({
  title: z.string().describe("The Swedish headline."),
  slug: z
    .string()
    .describe(
      // Deliberately does NOT ask for ASCII: asciiSlug() transliterates this
      // field afterwards, and spelling the rule out here taught the model to
      // strip Swedish letters from the title and body too.
      "URL slug for the Swedish headline, lowercase words joined by hyphens, spelled in normal Swedish.",
    ),
  summary: z.string().describe("The Swedish post summary, one or two sentences."),
  bodyHtml: z.string().describe("The full Swedish body, same HTML structure as the English."),
});

export interface SwedishArticle {
  title: string;
  slug: string;
  summary: string;
  bodyHtml: string;
}

const SYSTEM = `You translate WrenchLane product release announcements from English into Swedish.

WrenchLane sells AI-assisted diagnostics to independent car workshops, so write for a Swedish mechanic or workshop owner: direct, concrete, no marketing gloss. Translate meaning, not words. Established renderings used on the site: "labor time" is "arbetstid", "repair procedure" is "reparationsbeskrivning" (never "reparationsprocedur"), "mileage" is "mätarställning", "fault" is "fel", "diagnostics" is "diagnostik", "light commercial vehicles" is "lätta nyttofordon", "van" is "transportbil" (never "skåpbil" or "lastbil"). Product names, "WrenchLane", "VIN", "OEM" and release numbers stay as they are.

WRITE PROPER SWEDISH ORTHOGRAPHY.
Å, Ä and Ö are ordinary letters and must appear wherever Swedish spelling requires them, in the title, the summary and the body alike: "lätta", "för", "månad", "söka", "mätarställning". Never substitute a, a, o for them and never strip an accent. The ONLY ASCII-only field is the slug.

THE BODY IS HTML AND ITS STRUCTURE IS LOAD-BEARING.
- Reproduce every tag, attribute, class and URL exactly as given. Never edit a src, an href, an iframe or a figure.
- Translate only human-readable text: the text inside tags, and alt attributes.
- Keep the same number of headings, paragraphs, list items and figures, in the same order.
- Leave the zero-width spacer paragraphs exactly as they are.

STYLE
- Never use an em dash or an en dash anywhere, headline included. Use a comma, a full stop, or a plain hyphen. This is a hard rule.
- Where the English headline separates the title from the release number with a dash, use a plain hyphen: "... - Release 3.7". That is what the existing Swedish release articles do.
- Swedish quotation marks are the right-double form on both sides.`;

/**
 * Translate one release article. Returns null when the call fails or the model
 * returns something structurally unfaithful, so the caller can leave the
 * Swedish variant untouched rather than publish a broken page.
 */
export async function translateReleaseToSwedish(input: {
  title: string;
  summary: string | null;
  bodyHtml: string;
}): Promise<SwedishArticle | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();

  const user = `Translate this release article into Swedish.

TITLE:
${input.title}

SUMMARY:
${input.summary ?? ""}

BODY HTML:
${input.bodyHtml}`;

  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema) },
    });
    const out = res.parsed_output;
    if (!out?.bodyHtml?.trim() || !out.title?.trim()) return null;

    if (!preservesStructure(input.bodyHtml, out.bodyHtml)) return null;

    return {
      title: stripLongDashes(out.title),
      slug: asciiSlug(out.slug || out.title),
      summary: stripLongDashes(out.summary ?? ""),
      bodyHtml: stripLongDashes(out.bodyHtml),
    };
  } catch {
    return null;
  }
}

/**
 * Did the translation keep the media intact?
 *
 * Checks the things that break silently: every image and iframe URL in the
 * English body must still be present, and the figure count must match. Prose
 * length is deliberately not checked, since Swedish runs longer.
 */
export function preservesStructure(englishHtml: string, swedishHtml: string): boolean {
  const urls = (html: string) =>
    new Set([...html.matchAll(/(?:src)="([^"]+)"/gi)].map((m) => m[1]));
  const figures = (html: string) => (html.match(/<figure\b/gi) ?? []).length;

  const wanted = urls(englishHtml);
  const got = urls(swedishHtml);
  for (const u of wanted) if (!got.has(u)) return false;

  return figures(englishHtml) === figures(swedishHtml);
}

/** Swedish slugs on the site are ASCII-transliterated: a-ring becomes a, o-umlaut becomes o. */
export function asciiSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200)
    .replace(/-+$/g, "");
}
