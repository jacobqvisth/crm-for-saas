# Plan: `/articles`, a Content Studio for Wrenchlane

Status: **proposal, awaiting Jacob's go-ahead**
Written: 2026-08-04
Branch: `feat/articles-page` (based on `origin/main` @ `37e59a8`)
Author: Claude Code session (background job `7a6abbdd`)

---

## 1. What was asked

> "Can we create similar articles like this for Wrenchlane? Can you make a page in our CRM where we can create articles. Maybe have some options the user selects and then it will generate an article or a social media post for us that we can easily copy paste. Think long about this feature. Do internal and external research. Make a plan first."

New left-sidebar section called **Articles**.

## 2. Deconstructing the reference post

The pasted screenshot is a LinkedIn post by Harshad Apte promoting **AutoTechs AI**, a direct competitor in AI automotive diagnostics. It is worth being precise about why it works, because the structure is the actual spec:

| Beat | The reference text | Why it works |
|---|---|---|
| **Concrete opening** | "A 2013 Jeep Grand Cherokee rolls into an independent dealer's service department in TN. Code P150C, a variable valve lift fault." | Specific car, specific year, specific DTC, specific geography. No adjectives. Reads like a report, not an ad. |
| **The stake, italicised** | "*The kind of ticket that normally waits for the senior tech, or worse, waits for days.*" | Names the reader's actual pain in the reader's own vocabulary. |
| **What changed** | "This time, a junior tech ran the whole diagnosis. Guided step by step through the VVL test, solenoid checks, oil verification, wiring, rocker arm inspection, a structured path built from OEM documentation, not guesswork." | Lists the *real diagnostic steps*. This is the part generic AI copy cannot fake. |
| **Quantified result block** | 2 hours saved / 6-day delay eliminated / $750 revenue unlocked / $315 additional profit / 100% independent resolution | Five hard numbers, arrow-delimited, bolded. |
| **Compression** | "One car. One code. One junior tech who didn't need to wait for anyone." | Rhythmic three-beat summary. |
| **Zoom out** | "Now multiply that across every complex fault that hits your bays in a month." | Turns one anecdote into a business case without claiming anything. |
| **Positioning line** | "not replacing your best people, making everyone else capable of the work that used to wait for them." | Defuses the obvious objection (AI replacing techs). |
| **Hashtags** | 6 tags, product + category + persona | Standard. |
| **Image** | Photoreal shop bay with "P150C: RESOLVED" HUD overlay | Ties the visual back to the exact code in the copy. |

**The load-bearing insight: this format is 80% data and 20% writing.** Anybody can write the prose. Almost nobody has a database of real diagnostics with real DTCs, real ranked causes, and real suggested tests. Wrenchlane does. That is the moat this feature should exploit.

A generic "generate a LinkedIn post about AI diagnostics" button would produce slop. A button that says "turn *this actual diagnostic our engine ran last Tuesday* into a LinkedIn post" produces something the competitor cannot cheaply copy.

## 3. External research

Sources consulted (Aug 2026):

- [LinkedIn Strategy for SaaS Founders: 2026 Growth Guide](https://blog.linkboost.co/linkedin-strategy-for-saas-founders-2026/)
- [LinkedIn Post Best Practices 2026](https://connectsafely.ai/articles/linkedin-post-best-practices-guide-2026)
- [16 LinkedIn Post Examples That Drive Results 2026](https://postiv.ai/blog/linkedin-post-example)
- [How to Write B2B SaaS Case Study Content That Converts](https://situationaldynamics.com/blog/write-b2b-saas-case-study-converts)
- [LinkedIn Content Strategy for B2B SaaS 2026](https://www.buildmvpfast.com/blog/linkedin-content-strategy-b2b-saas-60k-playbook-2026)
- [How Auto Repair Shops Are Using AI in 2026](https://www.wickedfile.com/blogs/how-can-auto-repair-shops-use-ai-in-2026/)
- [Using AI to drive more fixed ops revenue (CBT News)](https://www.cbtnews.com/using-ai-to-drive-more-fixed-ops-revenue/)

Findings that translate directly into feature requirements:

1. **Hook under 210 characters.** LinkedIn truncates at roughly that point behind "see more". The first line has to earn the click on its own. → Generate **3 hook variants** per draft and let Jacob pick. This is the "3-2-1 rule" from the research.
2. **Quantify everything.** Percentages, dollars, hours. Numbers beat adjectives. → The generator needs a dedicated, explicit slot for impact figures (see the honesty guardrail in section 6).
3. **Mini-story shape: Client → Challenge → Solution → Result.** → This is the `case_study` angle preset.
4. **LinkedIn's 2026 feed favours "knowledge and advice" from subject-matter experts.** Pure promo is downranked. → Brand-prominence axis defaults to *subtle*, exactly as the Forums generator already does.
5. **Only ~25% of dealerships use AI in fixed ops.** That statistic is a reusable hook for the "market shift" angle, and it is a third-party citable number rather than a Wrenchlane claim.

## 4. Internal research: what already exists

### 4a. The pattern to copy: Forums

`/forums` is already almost exactly this feature, aimed at Reddit. It does: browse real diagnostics → pick one → pick target and angle → AI writes → copy-paste → mark where posted. The Articles page should reuse its architecture wholesale rather than invent a new one.

| Concern | Existing file to model on |
|---|---|
| Option axes + prompt guidance in one module | `src/lib/forums/generation-options.ts` |
| Reusable pill-row options UI | `src/components/forums/generation-options.tsx` |
| Anthropic call + defensive parse | `src/lib/forums/generate.ts` |
| API route: validate, generate, persist | `src/app/api/forums/generate/route.ts` |
| Table + shared-team RLS | `supabase/migrations/20260616130000_forum_posts.sql` and `20260709000000_forums_shared_across_users.sql` |
| Shared-workspace resolver | `src/lib/forums/server.ts` (`SHARED_FORUMS_WORKSPACE_ID`) |
| Tabbed hub page | `src/components/forums/forums-hub.tsx` |
| Copy-to-clipboard UX | `src/components/forums/forums-client.tsx`, `src/components/videos/videos-client.tsx` |

### 4b. The data available for grounding

| Source | Loader | What it gives an article |
|---|---|---|
| Real diagnostics | `getDiagnosticsDrilldownList()` in `src/lib/ceo/data/diagnostics.ts` | Car make/model/year, mileage, DTCs, symptoms, owner description, ranked causes with probability + severity + **suggestedTests** + faultCodes, country, workshop, whether it had chat/invoice. **This is the P150C-Jeep equivalent.** |
| DTC aggregates | `analyseDtcCodes()` in `src/lib/ceo/dtc/analyse.ts` | Per-code volume, code pairs, code sets, per-make spread, monthly trend, country split, oddities. Powers "the 10 codes that show up most in European shops" style data articles. |
| Diagnostic search terms | `analyseSearchTerms()` in `src/lib/ceo/search-terms.ts` | Verbatim text technicians actually type, language breakdown, frequency. Powers "what techs actually ask" articles and gives real customer vocabulary. |
| Product knowledge | `WRENCHLANE_KNOWLEDGE` in `src/lib/inbox/wrenchlane-knowledge.ts` | Capability names, ICP, pricing, founders. Already the grounding block for Inbox and cold email. |
| Reddit / forum threads | `src/lib/forums/*` | Real questions from the wild, already scraped. |
| Organic / Search Console | `src/lib/ceo/data/organic-analysis.ts` | Which queries Wrenchlane already ranks for. Directly relevant to the `guides.wrenchlane.com` demotion problem. |
| Workshops, feature usage, plan stats | `src/lib/ceo/data/{workshops,feature-usage,plan-stats}.ts` | Adoption and usage figures for data-story angles. |

### 4c. What does **not** exist, and matters

There is **no per-ticket financial outcome data**. Nothing in the CRM knows "this diagnostic saved 2 hours and unlocked $750 of revenue". The reference post's five-number result block has no equivalent source in our data. See section 6, this is the single biggest design risk.

## 5. Feature spec

### 5a. Route and navigation

- New sidebar item between **Videos** and **Forums** (the content cluster): `{ href: "/articles", label: "Articles", icon: Newspaper }` in `src/components/sidebar.tsx`.
- Route `src/app/(dashboard)/articles/page.tsx`, no `/dashboard/` prefix, matching the existing convention.
- Middleware already protects everything under the group, no change needed.

### 5b. Three tabs (mirroring `forums-hub.tsx`)

**Tab 1, Studio** (the generator)

Four steps down one page, no wizard:

1. **Pick a source.** Segmented control:
   - *Real diagnostic* → searchable/filterable list of actual diagnostics (car, DTCs, top cause, country, date). This is the flagship path.
   - *A fault code* → pick a DTC from the aggregate list, gets volume, affected makes, common co-codes.
   - *A search term / theme* → pick from what technicians actually type.
   - *Free topic* → type anything, no data grounding, clearly marked as ungrounded.
2. **Pick a format.** See 5c.
3. **Set the options.** See 5d.
4. **Generate → review → copy.** Output panel shows: 3 hook variants (radio-select, swaps the first line), the body in an editable textarea, hashtags as removable chips, and a **claims panel** (section 6). Copy buttons: *Copy post*, *Copy body only*, *Copy as Markdown*, *Copy hashtags*. A *Regenerate* button that keeps the source and options.

**Tab 2, Library**

Every article ever generated. Filter by format, status, language. Inline copy buttons. Set status to `published` with a URL, mirroring `forum_posts.posted_url` / `posted_at`. Duplicate-into-Studio to re-target one story at another format.

**Tab 3, Ideas**

Auto-surfaced topics from real data, the same shape as the existing Forums gap auto-discovery:
- High-volume DTCs with no article yet.
- Recent diagnostics with an unusually rich cause chain (good case-study candidates).
- Search terms with volume and no matching content.
- Queries from Search Console where Wrenchlane ranks 8-20 (the winnable SEO gap, and directly useful for the `guides.wrenchlane.com` recovery).

Each idea has a *Draft this* button that pre-fills the Studio.

### 5c. Output formats

| Format key | Target | Shape |
|---|---|---|
| `linkedin_post` | LinkedIn | Hook, 4-7 short paragraphs, arrow-delimited result block, three-beat close, positioning line, 5-6 hashtags. Directly models the reference post. |
| `x_thread` | X / Twitter | 5-9 numbered posts, each under 280 chars, hook post standalone. |
| `facebook_post` | Shop-owner Facebook groups | Plainer, less corporate, no hashtags, conversational. |
| `blog_article` | wrenchlane.com / guides subdomain | H2/H3 Markdown, 800-1800 words, meta title + meta description + slug + suggested internal links. |
| `newsletter` | Email to customers/prospects | Subject line, preview text, short body, single CTA. Reuses the same no-long-dash rule the send pipeline already enforces. |

**Reddit is deliberately excluded.** It already lives in `/forums` with per-subreddit tone rules and account personas. Duplicating it here would split the workflow. Articles handles owned + broadcast channels; Forums handles community channels.

### 5d. Option axes

Modelled directly on `ForumGenerationOptions`, one module as the single source of truth for both the UI labels and the prompt guidance so they cannot drift.

| Axis | Values | Default |
|---|---|---|
| `angle` | `case_study`, `data_insight`, `how_to`, `myth_buster`, `market_shift`, `founder_pov`, `objection_handler` | `case_study` |
| `audience` | `shop_owner`, `technician`, `dealer_fixed_ops`, `distributor_partner` | `shop_owner` |
| `voice` | `founder_first_person`, `company_brand`, `technical_expert` | `founder_first_person` |
| `length` | `short`, `standard`, `long` | `standard` |
| `brandLevel` | `none`, `subtle`, `explicit` | `subtle` |
| `cta` | `none`, `soft`, `direct` | `soft` |
| `hashtags` | on / off | on for LinkedIn, off elsewhere |
| `language` | `en`, `sv`, `no`, `da`, `fi`, `et`, `lv`, `lt` | `en` |
| `dataStrictness` | `strict` (only supplied facts), `illustrative` (clearly-hedged estimates allowed) | `strict` |

`dataStrictness` is the honesty switch and defaults to `strict`.

## 6. The honesty guardrail (most important section)

The reference post asserts: **2 hours saved, a 6-day delay eliminated, $750 revenue unlocked, $315 additional profit, 100% independent resolution.**

Wrenchlane's data supports none of those. If the generator is allowed to write freely in that shape, it will invent plausible-looking financial claims about real named-ish customers. That is a legal and reputational problem, not a style problem, and it is exactly the failure mode of every "AI content tool".

Three mechanisms, all in scope for Phase 1:

1. **Impact figures are an explicit user input, never model-invented.** A small form above Generate: *hours saved*, *days of delay avoided*, *ticket value*, *margin*, *resolved without escalation (yes/no)*, each optional. Empty fields are simply absent from the post. Under `strict` the system prompt forbids inventing any number not supplied.
2. **A claims panel under every draft.** Every number and factual assertion the draft makes, extracted and labelled by provenance:
   - green = came from the diagnostic record or an aggregate query
   - blue = Jacob typed it into the impact form
   - amber = model-generated, unsourced, verify before posting
   Nothing blocks posting. It just makes the unsourced claims impossible to miss. This is implemented by having the model return a structured `claims[]` array alongside the body, so it self-declares provenance.
3. **Anonymisation by default.** Real diagnostics carry `workshopName`, `username`, and country. The generator gets the car and the technical facts but never the shop name or user, unless Jacob explicitly opts in per draft ("this customer has agreed to be named"). Internal/test workshops are already excluded by `getDiagnosticsDrilldownList`.

## 7. Data model

One migration, `supabase/migrations/2026XXXXXXXXXX_articles.sql`.

```sql
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Where the facts came from: diagnostic | dtc_code | search_term | free_topic
  source_kind TEXT NOT NULL DEFAULT 'free_topic',
  -- Soft reference: diagnostic_id, the DTC string, the term, or NULL.
  -- No FK: dashboard_diagnostics is a synced analytics table whose rows rotate out.
  source_ref TEXT,
  -- Frozen copy of the grounding facts, same reasoning as forum_posts.scenario_snapshot.
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- linkedin_post | x_thread | facebook_post | blog_article | newsletter
  format TEXT NOT NULL,
  -- Full ArticleGenerationOptions object.
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  language TEXT NOT NULL DEFAULT 'en',

  title TEXT,
  body TEXT,
  -- The 3 generated hook variants; body already contains the selected one.
  hooks JSONB NOT NULL DEFAULT '[]'::jsonb,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  -- Blog only: meta_title, meta_description, slug, internal_links.
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Self-declared provenance per assertion, drives the claims panel.
  claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- User-supplied impact figures, echoed back for audit.
  impact JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- draft | approved | published | archived
  status TEXT NOT NULL DEFAULT 'draft',
  published_url TEXT,
  published_at TIMESTAMPTZ,

  model TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_workspace ON articles (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_format ON articles (workspace_id, format, created_at DESC);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
-- Shared team resource, same call as the forum_* tables: any authenticated CRM
-- user sees the same board (see 20260709000000_forums_shared_across_users.sql).
CREATE POLICY "any authenticated user can access articles"
  ON articles FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

Applied to prod with `psql` using `SUPABASE_DB_PASSWORD` from `.env.local` in the same session, per `CLAUDE.md`, then the SQL file committed. Then `mcp__supabase__generate_typescript_types` to refresh `src/lib/database.types.ts`.

## 8. Files to create and change

**New**

```
src/app/(dashboard)/articles/page.tsx            # thin shell, ?view= deep-link
src/app/api/articles/route.ts                    # GET list, PATCH update, DELETE
src/app/api/articles/generate/route.ts           # POST generate + persist
src/app/api/articles/sources/route.ts            # GET grounding candidates
src/app/api/articles/ideas/route.ts              # GET auto-surfaced topics

src/lib/articles/types.ts                        # leaf types, no imports
src/lib/articles/formats.ts                      # per-format prompt + shape rules
src/lib/articles/generation-options.ts           # axes: labels + prompt guidance
src/lib/articles/generate.ts                     # the Anthropic call
src/lib/articles/sources.ts                      # adapters over existing loaders
src/lib/articles/ideas.ts                        # topic discovery
src/lib/articles/server.ts                       # shared-workspace resolver

src/components/articles/articles-hub.tsx         # tab shell
src/components/articles/studio-client.tsx        # the generator
src/components/articles/source-picker.tsx        # diagnostic / DTC / term / free
src/components/articles/article-options.tsx      # pill rows
src/components/articles/impact-form.tsx          # the numbers Jacob supplies
src/components/articles/draft-panel.tsx          # hooks, body, hashtags, copy
src/components/articles/claims-panel.tsx         # provenance badges
src/components/articles/library-client.tsx
src/components/articles/ideas-client.tsx

supabase/migrations/2026XXXXXXXXXX_articles.sql
```

**Changed**

```
src/components/sidebar.tsx     # add the Articles nav item + Newspaper icon
src/lib/database.types.ts      # regenerated after the migration
cc-session-log.md              # session entry
PROJECT-STATUS.md              # new feature area
docs/roadmap.md                # if the phase list is tracked there
```

## 9. AI implementation

Per the `claude-api` skill and the current model table:

- **Model: `claude-opus-5`.** These are public-facing brand artifacts at very low volume, so quality dominates cost. Note Forums pinned `claude-sonnet-4-6` back in June 2026 for the same reasoning at the time; Opus 5 is the current default and the right pick here.
- **Adaptive thinking is on by default on Opus 5.** Do not pass `thinking: {type: "disabled"}`. Because `max_tokens` caps thinking plus response together, set `max_tokens: 16000` for the non-streaming route. That is comfortably inside SDK HTTP timeouts and leaves room for a 1800-word blog article plus reasoning.
- **Use structured outputs, not the "return only JSON" prompt.** Forums hand-rolls fence-stripping and brace-hunting in `parseTitleBody`. Opus 5 supports `output_config: {format: {type: "json_schema", schema}}`, so the generator gets a validated object with `hooks[]`, `title`, `body`, `hashtags[]`, `claims[]`, and `seo{}` and the defensive parser disappears.
- **`effort`:** start at the default `high`. Sweep down to `medium` later if latency annoys.
- **Must apply `NO_LONG_DASH_INSTRUCTION` and `stripLongDashes`** from `src/lib/ai/no-long-dash.ts` to every generated field. Worth noting that the reference post is full of em dashes; ours must not be.
- **Prompt assembly:** system prompt = format rules + angle/audience/voice/length/CTA guidance + brand-level rule + honesty rule + `WRENCHLANE_KNOWLEDGE` (only when brandLevel is not `none`, matching `mentionKnowledgeBlock`). User prompt = the grounding facts plus the impact figures verbatim.
- **Prompt caching:** the format and guidance blocks are stable across requests and the volatile grounding goes last, so a `cache_control` breakpoint on the last stable system block is worth having from the start. Opus 5's minimum cacheable prefix is 512 tokens, which the guidance block clears easily.

## 10. Phasing

**Phase 1, shippable core (recommended first PR)**
Sidebar entry, `/articles` route, migration, Studio tab with the *real diagnostic* and *free topic* sources, `linkedin_post` and `blog_article` formats, all option axes, impact form, claims panel, 3 hook variants, copy buttons, Library tab. English only.

**Phase 2, breadth**
`x_thread`, `facebook_post`, `newsletter` formats. DTC-code and search-term sources. Swedish plus the other market languages, reusing the existing language codes.

**Phase 3, the flywheel**
Ideas tab with auto-discovery from DTC volume, search terms, and Search Console rank 8-20 gaps. Publish-tracking (URL plus date) with a simple performance note field. Optional: hand a finished blog article to the `webflow-wl` repo or the Webflow CMS, given the MCP connection already exists.

**Deliberately not in this plan** (flag if wanted)
- Image generation for the post visual. The reference post's "P150C: RESOLVED" hero image is doing real work. This is a separate build (image model, brand template, asset storage) and probably belongs in its own phase.
- Direct posting to LinkedIn via API. The stated ask is copy-paste, and the Forums experience (plus the standing "no browser automation for Reddit posting" rule) suggests copy-paste is the right ceiling for now.
- Scheduling / calendar. Easy to add to the Library tab later if it turns out to be wanted.

## 11. Open decisions for Jacob

1. **Impact numbers.** Recommended: user-supplied only, with the claims panel flagging anything unsourced (section 6). Alternatives: let the model produce clearly-hedged ranges ("typically saves 1-3 hours"), or omit financial claims entirely. This is the one decision that changes the shape of the build.
2. **Phase 1 formats.** Recommended: LinkedIn plus blog article. Adding X, Facebook, and newsletter in the same PR roughly doubles the prompt and QA surface.
3. **Voice.** Recommended default `founder_first_person`, since the reference post works precisely because it reads as a named human. Confirm whose voice: Jacob's, or Hans as founder/CEO.
4. **Languages in Phase 1.** Recommended English only. The CRM already carries `sv`, `no`, `da`, `fi`, `et`, `lv`, `lt` for sequences, so adding them later is mechanical.
5. **Blog destination.** Articles could target wrenchlane.com, the demoted `guides.wrenchlane.com`, or the `webflow-wl` migration. This affects whether Phase 3 wires up a Webflow CMS push. Note the guides subdomain demotion is still open, so pointing new content there is probably wrong until that is resolved.

## 12. Risks and gotchas

| Risk | Mitigation |
|---|---|
| Fabricated financial claims about real customers | Section 6: strict mode, user-supplied impact figures, claims provenance panel, anonymisation by default. |
| Preview prerender failure on a new dashboard page | Known pattern from the Forums page work: `npm run build` plus `npm run lint` is the real gate, and preview prerender can fail on data-fetching pages. Keep `page.tsx` a thin client shell and fetch through API routes. |
| Worktree build fails prerendering | Symlink `.env.local` into the worktree before `npm run build`, then remove it. |
| Em/en dashes leaking into published copy | `NO_LONG_DASH_INSTRUCTION` in every prompt plus `stripLongDashes` on every output field, same as Inbox and Forums. |
| `dashboard_diagnostics` rows rotating out of the S3 export | Freeze `source_snapshot` at generation time, exactly as `forum_posts.scenario_snapshot` does. |
| Internal/test workshops appearing in public content | `getDiagnosticsDrilldownList` already excludes them by default. Do not override the flag. |
| Reddit workflow fragmenting across two pages | Reddit stays in `/forums`. Articles covers owned and broadcast channels only. |
| Vercel skipping the build | The `ignoreCommand` skips docs-only commits. Since this PR touches `src/`, a build will run normally. Verify the deployment reaches state READY for the SHA rather than just checking HTTP. |

## 13. Suggested first-PR checklist

1. `psql` the migration to prod, commit the SQL file.
2. Regenerate `src/lib/database.types.ts`.
3. Build `src/lib/articles/*` (types, options, formats, generate, sources, server).
4. Build the API routes.
5. Build the components, Studio then Library.
6. Sidebar entry.
7. `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e:smoke` (Playwright needs `--workers=1` in a background session).
8. PR against `main` with `gh pr create --head feat/articles-page`, squash-merge, verify the Vercel deployment reaches READY.
9. Append to `cc-session-log.md`, update `PROJECT-STATUS.md`.
