// Leaf types for the Articles content studio. No imports from sibling article
// modules, so generation-options.ts / formats.ts / stat-stories.ts can all pull
// from here without a cycle (same arrangement as src/lib/forums/types.ts).

/** Which body of facts a draft is grounded in. */
export type ArticleSourceKind =
  | "diagnostic" // one real diagnostic our engine ran
  | "stats" // an aggregate stat story (DTC / search-term analysis)
  | "free_topic"; // no data grounding, Jacob types the subject

export type ArticleFormat =
  | "linkedin_post"
  | "blog_article"
  | "x_thread"
  | "facebook_post"
  | "newsletter";

export type ArticleAngle =
  | "case_study"
  | "data_insight"
  | "how_to"
  | "myth_buster"
  | "market_shift"
  | "founder_pov"
  | "objection_handler";

export type ArticleAudience =
  | "shop_owner"
  | "technician"
  | "dealer_fixed_ops"
  | "distributor_partner";

export type ArticleVoice = "founder_first_person" | "company_brand" | "technical_expert";

export type ArticleLength = "short" | "standard" | "long";

/** How prominently Wrenchlane is named. Mirrors the forums mention levels. */
export type ArticleBrandLevel = "none" | "subtle" | "explicit";

export type ArticleCta = "none" | "soft" | "direct";

/**
 * strict      = the model may only use numbers it was handed. No estimates.
 * illustrative = clearly-hedged ranges allowed ("typically 1-3 hours").
 */
export type ArticleDataStrictness = "strict" | "illustrative";

export interface ArticleGenerationOptions {
  angle: ArticleAngle;
  audience: ArticleAudience;
  voice: ArticleVoice;
  length: ArticleLength;
  brandLevel: ArticleBrandLevel;
  cta: ArticleCta;
  hashtags: boolean;
  language: string;
  dataStrictness: ArticleDataStrictness;
}

/**
 * Business impact figures. Jacob types these; the model is never allowed to
 * invent them. Anything left null is simply absent from the draft.
 *
 * This exists because the competitor post that inspired the feature asserts
 * "2 hours saved / $750 revenue unlocked / $315 additional profit" and we have
 * no data source for per-ticket financial outcomes. See docs/plans/articles-page.md.
 */
export interface ArticleImpact {
  hoursSaved: number | null;
  daysAvoided: number | null;
  ticketValue: number | null;
  additionalProfit: number | null;
  currency: string | null;
  resolvedWithoutEscalation: boolean | null;
  /** Anything else Jacob wants asserted, in his own words. */
  note: string | null;
}

export const EMPTY_IMPACT: ArticleImpact = {
  hoursSaved: null,
  daysAvoided: null,
  ticketValue: null,
  additionalProfit: null,
  currency: null,
  resolvedWithoutEscalation: null,
  note: null,
};

/** True when the user supplied at least one impact figure. */
export function hasImpact(impact: ArticleImpact): boolean {
  return (
    impact.hoursSaved != null ||
    impact.daysAvoided != null ||
    impact.ticketValue != null ||
    impact.additionalProfit != null ||
    impact.resolvedWithoutEscalation != null ||
    Boolean(impact.note && impact.note.trim())
  );
}

/**
 * Provenance of one assertion in a draft. The model self-declares these so the
 * UI can colour-code every number before Jacob posts it.
 *
 * data      = came from the diagnostic record or a stat fact pack
 * user      = Jacob typed it into the impact form
 * knowledge = a product fact from WRENCHLANE_KNOWLEDGE
 * unsourced = the model's own words, verify before publishing
 */
export type ArticleClaimSource = "data" | "user" | "knowledge" | "unsourced";

export interface ArticleClaim {
  text: string;
  source: ArticleClaimSource;
}

/** SEO fields, blog format only. */
export interface ArticleSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  slug: string | null;
  internalLinkIdeas: string[];
}

/** The scenario facts frozen into a draft, so S3 export churn cannot orphan it. */
export interface ArticleDiagnosticSnapshot {
  diagnosticId: string;
  carMake: string | null;
  carModel: string | null;
  carYear: number | null;
  mileage: number | null;
  description: string | null;
  dtcs: string[];
  symptoms: string[];
  country: string | null;
  causes: {
    name: string;
    probability: number | null;
    severity: string | null;
    description: string | null;
    suggestedTests: string[];
  }[];
  createdAt: string | null;
}

/** A row as stored in the `articles` table. */
export interface Article {
  id: string;
  workspace_id: string;
  source_kind: ArticleSourceKind;
  source_ref: string | null;
  source_snapshot: unknown;
  format: ArticleFormat;
  options: ArticleGenerationOptions;
  language: string;
  title: string | null;
  body: string | null;
  hooks: string[];
  hashtags: string[];
  seo: ArticleSeo | Record<string, never>;
  claims: ArticleClaim[];
  impact: ArticleImpact | Record<string, never>;
  status: "draft" | "approved" | "published" | "archived";
  published_url: string | null;
  published_at: string | null;
  model: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
