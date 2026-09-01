// Picking the category and tags for an article at publish time.
//
// Deliberately a separate, cheap call rather than something the writing prompt
// produces. Two reasons: the taxonomy is fetched live from Webflow so it cannot
// go stale in a prompt, and classification only matters for the articles that
// actually get published, which is a small fraction of what gets drafted.
//
// The model may only choose from the ids it is given. Inventing a tag would
// create a thin taxonomy page with one article on it, so a name that does not
// match an existing term is dropped rather than created.

import { z } from "zod";
import { generateStructured } from "@/lib/ai/provider";
import type { TaxonomyTerm } from "./webflow";

// Classification is a short, well-bounded judgement, so it does not need Opus.
const MODEL = "claude-sonnet-5";

const schema = z.object({
  categoryIds: z
    .array(z.string())
    .describe("Ids of one or two categories, best fit first. Never more than two."),
  tagIds: z
    .array(z.string())
    .describe("Ids of three to six tags that a reader would actually filter by."),
  reasoning: z.string().describe("One sentence on why, for the audit trail."),
});

export interface ClassifyResult {
  categoryIds: string[];
  tagIds: string[];
  reasoning: string;
}

function renderTerms(terms: TaxonomyTerm[]): string {
  return terms
    .map((t) => `  - id: ${t.id} | name: ${t.name}${t.description ? ` | ${t.description}` : ""}`)
    .join("\n");
}

/**
 * Returns empty arrays rather than throwing. A missing category is a cosmetic
 * problem; failing the publish over it would be worse.
 */
export async function classifyArticle(input: {
  title: string;
  summary: string | null;
  body: string;
  categories: TaxonomyTerm[];
  tags: TaxonomyTerm[];
}): Promise<ClassifyResult> {
  const empty: ClassifyResult = { categoryIds: [], tagIds: [], reasoning: "" };
  if (!input.categories.length) return empty;

  const system = `You file automotive-trade articles into an existing taxonomy on a workshop-software company's website.

Pick from the ids given to you and nothing else. Do not invent a category or tag, and do not pick a term just because a word appears in the text: pick what a technician or shop owner browsing the site would expect to find this article under.

CATEGORIES (choose one, or two when the article genuinely spans both):
${renderTerms(input.categories)}

TAGS (choose three to six):
${renderTerms(input.tags)}

Guidance on tags: prefer the specific over the generic. A vehicle make, a fault code, or a named symptom is worth more than a broad word. Include a make tag only if that make is genuinely central to the article, and a fault-code tag only if that exact code is discussed.`;

  const excerpt = input.body.slice(0, 6000);
  const user = `Title: ${input.title}
${input.summary ? `Summary: ${input.summary}\n` : ""}
Article:
${excerpt}`;

  const result = await generateStructured(
    {
      label: "articles/classify",
      anthropicModel: MODEL,
      system,
      user,
      maxTokens: 2000,
    },
    schema,
  );
  if (!result.ok) return empty;

  const out = result.data;

  // Only ids that actually exist survive, so a hallucinated id cannot reach the CMS.
  const validCategories = new Set(input.categories.map((c) => c.id));
  const validTags = new Set(input.tags.map((t) => t.id));
  return {
    categoryIds: out.categoryIds.filter((id) => validCategories.has(id)).slice(0, 2),
    tagIds: out.tagIds.filter((id) => validTags.has(id)).slice(0, 6),
    reasoning: out.reasoning,
  };
}
