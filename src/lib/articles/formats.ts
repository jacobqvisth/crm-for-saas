// Per-channel output specs. Each format owns the structural rules for its
// channel (hook budget, paragraph shape, whether hashtags and SEO fields apply)
// so the generator prompt is assembled from one place rather than branching
// inside the prompt builder.
//
// The linkedin_post spec is modelled directly on the competitor post that
// prompted this feature: concrete opening with the exact vehicle and code, the
// stake, what changed, an arrow-delimited result block, a three-beat compression
// line, then a positioning line. See docs/plans/articles-page.md section 2.

import type { ArticleFormat, ArticleLength } from "./types";

export interface FormatSpec {
  key: ArticleFormat;
  label: string;
  blurb: string;
  /** Hook variants to generate. LinkedIn and X live or die on the first line. */
  hookCount: number;
  /** Hard character ceiling for a hook, or null when it does not matter. */
  hookMaxChars: number | null;
  wantsHashtags: boolean;
  wantsSeo: boolean;
  /** Plain text or markdown. Drives the copy buttons the UI offers. */
  bodyFlavour: "plain" | "markdown";
  /** Whether a separate title field is meaningful for this channel. */
  wantsTitle: boolean;
  /** Structural instructions injected into the system prompt. */
  structure: string;
  /** Overrides the generic length guidance where a channel has hard limits. */
  lengthOverride?: Partial<Record<ArticleLength, string>>;
}

export const FORMAT_SPECS: Record<ArticleFormat, FormatSpec> = {
  linkedin_post: {
    key: "linkedin_post",
    label: "LinkedIn post",
    blurb: "Single post, hook-led, result block, hashtags.",
    hookCount: 3,
    // LinkedIn truncates behind "see more" at roughly this point, so the first
    // line has to carry the click on its own.
    hookMaxChars: 210,
    wantsHashtags: true,
    wantsSeo: false,
    bodyFlavour: "plain",
    wantsTitle: false,
    structure: `Shape the post like this, adapting it to the angle rather than filling in a template mechanically:

1. Opening line: the most concrete, specific fact you have. A vehicle and a fault code, or the single most surprising number. No preamble, no "In today's automotive landscape". This line must work as a standalone hook because everything after it is hidden behind "see more".
2. Name the stake in the reader's own vocabulary: what this kind of job normally costs them in time, throughput, or escalation.
3. What actually happened, or what the data actually shows. This is the substance and it should be the longest part. Use the real specifics you were given, including the real diagnostic steps or the real figures.
4. If, and only if, you were given impact figures, present them as a short labelled result block, one figure per line, using a leading arrow. If you were given no impact figures, omit this block entirely rather than inventing one.
5. A short compression line, two or three beats, that restates the point rhythmically.
6. Zoom out in one sentence: what this looks like multiplied across a month of work.
7. A positioning line that pre-empts the obvious objection, which for this audience is almost always that software is meant to replace skilled people. It is not, it makes the work reachable by more of the team.

Formatting: short paragraphs separated by a blank line. No markdown headings, no bold markers, no bullet characters other than the arrows in the result block, because LinkedIn renders none of them. Plain text only.`,
  },

  blog_article: {
    key: "blog_article",
    label: "Blog article",
    blurb: "Long-form Markdown with meta title, description, and slug.",
    hookCount: 3,
    hookMaxChars: null,
    wantsHashtags: false,
    wantsSeo: true,
    bodyFlavour: "markdown",
    wantsTitle: true,
    structure: `Write a complete article in Markdown.

Structure: an opening that states the concrete situation or finding in the first two sentences, then H2 sections that each make one point, with H3s only where a section genuinely needs sub-structure. Close with a short section that tells the reader what to do with this.

Rules: do not start with a dictionary definition or a paragraph about how the industry is evolving. Get to the specific thing immediately. Use a Markdown table only where the content is genuinely tabular, such as a per-code or per-brand breakdown, and keep it small. Never use a heading called "Introduction" or "Conclusion".

Also produce, in the structured fields: a title under 60 characters, a meta description between 140 and 160 characters, a URL slug in lowercase with hyphens, and three to five internal link ideas expressed as the topic each would point at.`,
    lengthOverride: {
      short: "Around 500 to 700 words. Two or three H2 sections.",
      standard: "Around 900 to 1200 words. Three or four H2 sections.",
      long: "Around 1500 to 2000 words. Five or six H2 sections, developed properly.",
    },
  },

  x_thread: {
    key: "x_thread",
    label: "X thread",
    blurb: "Numbered thread, each post under 280 characters.",
    hookCount: 3,
    hookMaxChars: 260,
    wantsHashtags: false,
    wantsSeo: false,
    bodyFlavour: "plain",
    wantsTitle: false,
    structure: `Write a thread. Put each post on its own line prefixed with its number and a slash, like "1/", "2/", and so on.

Every single post must be under 280 characters including the number prefix. Count them.

Post 1 is the hook and has to stand completely alone, because most readers will only ever see that one. The middle posts each carry exactly one fact or one step. The final post lands the point. Do not use hashtags. Do not end with "Follow me for more".`,
    lengthOverride: {
      short: "Five posts.",
      standard: "Six or seven posts.",
      long: "Eight or nine posts.",
    },
  },

  facebook_post: {
    key: "facebook_post",
    label: "Facebook post",
    blurb: "Plainer and more conversational, for shop-owner groups.",
    hookCount: 2,
    hookMaxChars: 250,
    wantsHashtags: false,
    wantsSeo: false,
    bodyFlavour: "plain",
    wantsTitle: false,
    structure: `Write for a workshop-owners Facebook group. These are peer spaces and they punish anything that reads like marketing.

Conversational and plain. Shorter sentences than you would use on LinkedIn. No hashtags, no result block, no arrows, no formatting of any kind. If a group would read it as an ad, it is wrong. Ending on a genuine question is usually right here.`,
  },

  newsletter: {
    key: "newsletter",
    label: "Newsletter",
    blurb: "Subject line, preview text, short body, one CTA.",
    hookCount: 3,
    hookMaxChars: 65,
    wantsHashtags: false,
    wantsSeo: false,
    bodyFlavour: "plain",
    wantsTitle: true,
    structure: `Write an email to existing customers and warm prospects.

The hook variants are subject lines, each under 65 characters so they do not truncate in a mobile inbox. The title field is the chosen subject line. Open the body with one sentence that earns the next one, keep it to three or four short paragraphs, and finish with exactly one call to action. No hashtags. Plain text, no markdown.`,
  },
};

export const FORMAT_ORDER: ArticleFormat[] = [
  "linkedin_post",
  "blog_article",
  "x_thread",
  "facebook_post",
  "newsletter",
];

export function getFormatSpec(key: string): FormatSpec | undefined {
  return FORMAT_SPECS[key as ArticleFormat];
}
