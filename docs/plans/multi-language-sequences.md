# Multi-language sequences

**Status:** BUILT — phases 0 to 4 shipped 2026-08-10. Phase 5 (merging the six
existing country sequences) deliberately not done; see section 8.
**Written:** 2026-08-10
**Grounded in:** prod data + code at `741d4e3`

One sequence that sends each contact their own language, replacing the
"one sequence per language" pattern.

---

## 1. What this costs today

Six live sequences are the same campaign duplicated per language:

| Sequence | Steps | Enrollments |
|---|---|---|
| Sverige | 5 | 3,973 |
| United Kingdom — English | 5 | 2,800 |
| Czech Republic — Czech | 5 | 1,995 |
| Lithuania — Lithuanian | 5 | 562 |
| Estonia — Estonian | 5 | 281 |
| Latvia — Latvian | 5 | 279 |

That is 30 step-trees maintained by hand for what is conceptually one
5-step campaign. Fixing a typo or sharpening a CTA is six edits. Analytics
are split six ways, so "which subject line works" cannot be answered across
the whole audience.

The cost is about to get worse, not better. The failed-payment recovery
cohort built today is 26 contacts spread across **9 languages**:

```
en 8 | lt 4 | pl 4 | ro 3 | sv 2 | nb 1 | bg 1 | fi 1 | cs 1 | (none) 1
```

Under the current model, sending that campaign properly means 9 sequences,
9 lists, and 9 auto-enroll links, to reach 26 people. That is what makes
this worth building rather than tolerating.

## 2. What is already in place

More than half the machinery exists.

- **`contacts.language`** is populated for 5,772 of 16,397 contacts, in 24
  distinct codes. It comes from the app (`discover-new.ts`), so it reflects
  the UI language the user actually chose, which beats guessing from country.
  Several RO/BG/LT contacts are `en`, and they are right to be.
- **`sequence_step_variants`** already gives one step N alternative bodies,
  with `weight`, `is_active`, `sends_count`, and per-variant analytics.
- **`translateOutboundEmail`** (`src/lib/inbox/translate-outbound.ts`)
  translates subject + HTML body and **preserves `{{merge}}` placeholders and
  HTML structure**. It is already used by the one-off compose path.
- **`/api/sequences/duplicate`** already AI-translates a whole sequence into
  another language. This is exactly how the six country sequences are made.
- **Lazy render** (`src/lib/sequences/render.ts`) re-resolves subject and body
  from the live step and the *pinned* `variant_id` at send time. Editing
  variant copy on a live sequence propagates to unsent queue rows already.
- **`src/lib/i18n/languages.ts`** holds labels and picker ordering.

The gap is narrow: nothing decides *which* variant a given contact should get
based on their language.

## 3. The design decision: where does language live?

### Option A — language as a dimension of the existing variant (recommended)

Add `language` to `sequence_step_variants`. A step holds one variant per
language (optionally several per language for A/B). At queue time, pick the
variant matching the contact's language instead of pure round-robin.

**Why this wins:**

- The send path barely changes. `variant_id` is already pinned onto the queue
  row, and `render.ts` already re-resolves from it, so send-time rendering,
  tracking, click/open attribution, and mid-flight copy edits all keep working
  untouched.
- All four variant-pick sites already have the full `contact` row in scope
  (`enrollment.ts:300` and `:346`, `process-emails/route.ts:690` and `:763`),
  so passing the language through is a parameter, not a refactor.
- Language and A/B compose: 2 test variants × 5 languages is expressible.
- One sequence means one enrollment per contact, one stop-on-reply rule, one
  funnel, and per-language stats become a *grouping* of data already collected
  rather than six separate reports.

**Cost:** the variants table becomes two-dimensional, so the step editor needs
a real UI (language tabs) or it turns into an unreadable flat list.

### Option B — language columns on the step (`body_override_by_language jsonb`)

Rejected. It duplicates what variants already do, forecloses A/B within a
language, and every reader of `body_override` would need to learn the new
shape.

### Option C — keep N sequences, add a "campaign" parent that groups them

Rejected. It makes reporting nicer but does nothing about the actual pain,
which is maintaining six copies of the same step tree. It also complicates
dedup and stop-on-reply across sibling sequences.

### Option D — translate at send time, store nothing

Rejected as the primary mechanism, for one decisive reason: it ships
unreviewed machine copy straight to paying customers, with no chance to read
it first. It also adds an LLM call to the send cron's critical path, makes
sends non-deterministic, breaks "what exactly did we send", and cannot A/B.

**But its engine is the right authoring tool.** Use `translateOutboundEmail`
to *generate* language variants ahead of time, which Jacob then reviews and
edits. One-click "generate all languages", with a human gate before anything
sends. That is the synthesis: Option A's storage model, Option D's engine,
moved from send time to authoring time.

## 4. Recommended design

### 4.1 Schema

```sql
alter table sequence_step_variants add column language text;
-- null = "language-neutral", the existing behaviour, still the default

alter table sequence_enrollments add column language text;
-- the language resolved once at enrollment, pinned for the whole sequence
```

Sequence `settings` gains:

```jsonc
{
  "languages": ["en", "sv", "pl", "lt"],  // which languages this campaign supports
  "default_language": "en"                // fallback for everyone else
}
```

Bounding the set matters: without it, "support every language" means
authoring 24 translations of every step.

### 4.2 Language resolution, and why it is pinned

Resolve **once, at enrollment**, and store on the enrollment row:

1. `contacts.language`, if set and in the sequence's `languages`
2. else country-code default (`SE→sv`, `PL→pl`, `LT→lt`, …), if in `languages`
3. else `settings.default_language`

Pinning is not a detail. If language were re-resolved per step, a contact whose
`language` changes mid-campaign (the hourly propagator can rewrite it) would
get email 1 in English and email 2 in Polish. Pinning on the enrollment makes
the sequence internally consistent, and gives a clean field to group analytics
by later.

The country map should stay deliberately conservative. Belgium is nl/fr,
Finland is fi/sv, and the Cypriot and several Baltic app users in prod
genuinely use English. `contacts.language` must always win over country.

### 4.3 Pick logic

Extend `pickVariant(step, variants, template, language?)`:

- Variants carrying a `language` that matches → A/B round-robin **within that
  language group**, using the existing `sends_count / weight` scoring.
- No match for that language → fall back to the `default_language` group.
- No language-tagged variants at all → today's behaviour, byte for byte.

That last rule is what makes this backward compatible: all 13 existing
variants have `language = null` and keep round-robining exactly as now.

### 4.4 Authoring flow

In the step editor, a language tab strip driven by `settings.languages`.
The default-language tab is the source of truth; the rest are translations.

"Generate missing languages" calls the existing `translateOutboundEmail` per
language and writes a variant per language, flagged `ai_generated` (the column
already exists). Each lands as an editable draft, never as something already
sent. A "source has changed since this translation" marker is worth having so
edits to the English master do not silently leave nine stale translations.

### 4.5 Analytics

`sequence_analytics_tab.tsx` gains a "by language" grouping. Because sends,
opens, and replies are already attributed per variant, this is a regrouping of
existing data, not new collection.

## 5. Gotchas found while investigating

- **The language picker cannot express the languages we actually have.**
  `TARGET_LANGUAGE_LABELS` has 17 codes. 210 contacts sit in 9 codes missing
  from it: `ro` 102, `bg` 37, `uk` 29, `tr` 13, `sk` 10, `ar` 8, `nb` 5,
  `fa` 5, `zh` 1. Romanian is the 6th-largest language in the database and is
  not selectable. Fix this first; it is a one-file change and it blocks
  correct targeting regardless of which option above is chosen.
- **`nb` vs `no`.** Contacts store `nb` (Bokmål); the label map has `no`. Any
  matching must normalise, or every Norwegian falls to the default language.
- **10,625 contacts have no `language` at all.** The fallback chain covers
  them. Resist backfilling country-guesses into `contacts.language` itself, as
  that would destroy the distinction between "we know" and "we guessed". If a
  guess must be stored, put it in a separate column.
- **`ensureUnsubscribeLink` is currently a no-op**, so there is no
  English-footer-in-a-Polish-email problem today. If a footer is ever added
  back, it has to be language-aware.
- **Do not migrate the six live sequences in flight.** Together they carry
  9,890 enrollments. New campaigns adopt the new model; a merge tool for the
  old ones is optional, later, and separate.
- **RTL.** `ar` and `fa` are 13 contacts. Out of scope, but worth knowing the
  HTML would need `dir="rtl"` if it ever matters.

## 6. Delivery in phases

Each phase is independently shippable and useful on its own.

**Phase 0 — language coverage (small)**
Extend `TARGET_LANGUAGE_LABELS` with ro, bg, uk, tr, sk, hu, and normalise
`nb`→`no`. Immediately improves the existing per-language sequences and the
inbox translate features. No schema change.

**Phase 1 — resolution + pinning (small)**
`sequence_enrollments.language`, the resolver with its fallback chain, and the
country map. Nothing changes in what sends yet; the field is just populated
and visible. Ship it and confirm the values look right before anything depends
on them.

**Phase 2 — language variants (the core)**
`sequence_step_variants.language`, `pickVariant` language-awareness, plumbing
at the two call sites, and `settings.languages`. Backward compatible by
construction. Verifiable with a test sequence before any real audience.

**Phase 3 — authoring UI**
Language tabs in the step editor plus "generate missing languages" on top of
`translateOutboundEmail`, with stale-translation markers.

**Phase 4 — analytics**
Per-language grouping in the sequence analytics tab.

**Phase 5 — optional consolidation**
A tool to merge the six country sequences into one multi-language sequence,
for new enrollments only.

Phases 1 and 2 are the ones that change behaviour. Phase 3 is what makes it
pleasant. Phase 0 is worth doing this week regardless.

## 7. What shipped

Phases 0 to 4, as designed above. Where the build differs from the plan, it is
noted here.

**Phase 0 — language coverage.** `TARGET_LANGUAGE_LABELS` grew from 17 to 26
codes, adding sk, hu, ro, bg, uk, tr, ar, fa, zh. `normalizeLanguage()` now
lowercases, strips region suffixes (`sv-SE`, `en_US`), and aliases `nb`/`nn`
onto `no`. A test asserts every language code observed on prod contacts is
covered, so this cannot silently regress when a new market appears.

**Phase 1 — resolution and pinning.** `sequence_enrollments.language`, plus
`src/lib/sequences/language.ts` holding `resolveContactLanguage`,
`sequenceLanguages` and `defaultLanguage`. `COUNTRY_DEFAULT_LANGUAGE` covers 28
unambiguous countries and deliberately omits BE, CH, CY and CA.

**Phase 2 — language variants.** `sequence_step_variants.language`.
`pickVariant` takes an optional `{ language, defaultLanguage }` and narrows to
a language group before the existing A/B round-robin. All four pick sites pass
the enrollment's pinned language.

One refinement over the plan: when a step has language-tagged copy but none
suitable for this reader, the picker prefers the **step's own body** over an
off-language variant, and only falls back to an off-language variant if the
step body is empty. Sending Polish to a Swedish reader is worse than sending
the master copy; sending nothing is worse than either.

**Phase 3 — authoring.** A Language select per variant, the code shown on each
variant tab, and an "Add languages" button that calls
`POST /api/sequences/[id]/steps/[stepId]/variants/languages`. That endpoint
translates the master copy once per configured language via the existing
`translateOutboundEmail`, storing each as an editable variant flagged
`ai_generated`. It promotes an untagged master to the source language first, so
the source language has a real variant rather than falling through to the step
body. It never overwrites a hand-edited variant. Sequence settings gained a
language checklist and a "master copy is written in" picker.

**Phase 4 — analytics.** The per-variant breakdown shows each variant's
language. Two bugs the language dimension introduced were fixed in the same
pass: **"Promote winner" and the "Leader" trophy both compared variants across
languages.** Left alone, promoting a winner would have set the Polish variant
to weight 5 and demoted English to 1, starving whichever language lost, on a
comparison that means nothing since the two never compete for the same reader.
Both are now scoped per language.

### Verifying it on a real sequence

1. Sequence settings, tick the languages, set the master language.
2. On each email step, write the master copy, then "Add languages".
3. Review each generated tab. They are ordinary variants, so edit freely.
4. Enroll. Check `sequence_enrollments.language` looks sane before sending.

Existing sequences are untouched: with no language on any variant, every pick
takes the original code path.

## 8. Decisions needed from Jacob

1. **Bounded or unbounded languages per sequence?** Recommended: bounded via
   `settings.languages`, so a campaign commits to the languages it will
   actually be reviewed in.
2. **Should AI translations be sendable before a human reads them?**
   Recommended: no. Generate as drafts, require a review click per language.
   The whole reason to prefer Option A over Option D is that gate.
3. **Country-to-language fallback: on or off?** Recommended: on, but only for
   unambiguous countries, and never overwriting `contacts.language`.
4. **Do the six existing country sequences get merged?** Recommended: not
   initially. Leave 9,890 live enrollments alone.

Decisions 1 to 3 are implemented as recommended: the language set is bounded
per sequence, AI translations land as editable drafts that nothing sends until
reviewed, and the country fallback is on but conservative. Decision 4 is open,
and nothing was migrated.

**Not done on purpose:** the failed-payment recovery sequence was left as
English-only. Its master copy is still pending review (the billing link is a
placeholder), and translating unreviewed copy would double the review burden
and throw the translations away as soon as the master changes. Settle the
English, then press "Add languages".
