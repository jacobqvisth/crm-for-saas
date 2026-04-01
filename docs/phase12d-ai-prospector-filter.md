# Phase 12d — AI Prospector Filter

**Status:** Planning
**Last updated:** 2026-04-01
**Goal:** Add an AI quality gate to the Prospector so profiles are evaluated against the workspace's ICP before being added to the CRM.

---

## Why This Matters

The Prospector pulls hundreds of profiles from Prospeo. Many will technically match the filter criteria (title = "VD", country = "Sweden") but still be bad leads — a VD at an automotive parts *supplier* is not the same as a VD at an independent *repair shop*. Right now, every profile that passes the API filters gets added to the CRM without any quality check, which pollutes the contact list and wastes sequence enrollments on unqualified leads.

The AI filter catches the difference that structured filters can't: context, nuance, edge cases. A Bilmekaniker at a Porsche dealership is not the same as a Bilmekaniker running a 3-person family shop.

---

## Feature Overview

A user-configurable AI quality gate that evaluates Prospector profiles before they're revealed (Prospeo costs credits per reveal) or added to the CRM. The AI reads each profile's visible data and returns a verdict: **Good fit / Maybe / Poor fit**, with a short reason. The user can then review, adjust selection, and add only the contacts they want.

---

## User Flow (Happy Path)

1. User runs a Prospector search → gets 111 results
2. User selects 25 profiles (select-all on current page)
3. User clicks **"AI Check (25)"** button in the action bar
4. Loading state: "Evaluating profiles..." with a spinner (~2–3 seconds)
5. Results table updates with a new **Fit** column:
   - ✅ Green — Good fit (18 profiles)
   - ⚠️ Yellow — Maybe (4 profiles)
   - ❌ Red — Poor fit (3 profiles)
6. Poor fits are **automatically deselected** (toast: "3 poor fits deselected")
7. User hovers any verdict badge → tooltip shows the AI's reason
8. User reviews maybes, optionally re-selects some
9. User clicks **"Reveal & Add to CRM (22)"** → normal reveal flow

If AI filter is disabled (or no ICP prompt saved), the "AI Check" button does not appear.

---

## Settings UI — `/settings/ai-filter`

A new settings section where the user configures the AI filter.

### New card on `/settings` index
- Title: "AI Lead Filter"
- Icon: Sparkles (lucide)
- Description: "Use AI to score Prospector results against your ICP before adding them to your CRM."
- Links to `/settings/ai-filter`

### `/settings/ai-filter` page contents

```
[Toggle] Enable AI Lead Filter
  ↳ When enabled, an "AI Check" button appears in the Prospector

[Textarea — 10 rows] ICP Prompt
  Label: "Describe your ideal customer"
  Placeholder (example text, not saved):
    "We sell to automotive workshop owners and VDs (verkställande direktörer)
    at independent Swedish car repair shops with 5–50 employees.

    Good fits:
    - Verkstadschef, VD, ägare, verkstadsägare at service/repair workshops
    - Bilmekaniker at small owner-operated shops
    - Decision-makers at independent garages and car service centers

    Poor fits:
    - Automotive parts suppliers or manufacturers
    - HR, marketing, or finance roles
    - Large franchise chains with 100+ locations
    - Rental car companies, car washes, towing companies
    - Anyone not in Sweden (unless we've opened a new market)"

[Save button]

─── Test the Filter ───────────────────────────────
[Textarea] Paste a profile description to test
  e.g. "Johan Pettersson, VD at Lecab Bil, Automotive, Karlstad Sweden"

[Test button] → shows verdict inline: ✅ Good fit — "VD at independent automotive dealer"
```

---

## Technical Architecture

### 1. Database — New Table: `workspace_ai_settings`

```sql
CREATE TABLE workspace_ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  icp_prompt TEXT,
  filter_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

-- RLS: same pattern as other workspace tables
ALTER TABLE workspace_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_read_ai_settings"
  ON workspace_ai_settings FOR SELECT
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "workspace_members_can_write_ai_settings"
  ON workspace_ai_settings FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- Auto-update updated_at
CREATE TRIGGER update_workspace_ai_settings_updated_at
  BEFORE UPDATE ON workspace_ai_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**Why a separate table instead of columns on `workspaces`?** Keeps the workspaces table clean, and this settings block will grow (we'll add AI email writer settings, AI personalization settings, etc. in Phases 13+). Better to have one `workspace_ai_settings` row per workspace with a growing JSONB-ish profile.

### 2. New API Route: `POST /api/prospector/ai-filter`

**Input:**
```typescript
{
  profiles: Array<{
    person_id: string;
    full_name: string;
    current_job_title?: string;
    headline?: string;
    company_name: string;
    company_industry?: string;
    company_employee_range?: string;
    location_country?: string;
    location_city?: string;
  }>;
}
```

**What it does:**
1. Gets `workspace_id` from session (server-side Supabase client)
2. Fetches `icp_prompt` from `workspace_ai_settings`
3. If no prompt saved, returns error: `{ error: "no_icp_prompt" }`
4. Builds a single Claude API call with all profiles batched (NOT one call per profile)
5. Returns structured verdicts

**Claude call structure:**

System prompt:
```
You are an ICP (Ideal Customer Profile) evaluator for a B2B sales team.

[workspace's icp_prompt]

You will receive a JSON array of prospect profiles. For each profile, evaluate whether they match the ICP and return a JSON array of verdicts.

Each verdict must have:
- person_id: string (copy from input)
- verdict: "good" | "maybe" | "poor"
- reason: string (max 12 words, plain English, no punctuation)

Return ONLY valid JSON. No explanation, no markdown, no code blocks.
```

User message:
```
Evaluate these prospects:
[JSON.stringify(profiles)]
```

Expected Claude response:
```json
[
  {"person_id": "abc123", "verdict": "good", "reason": "VD at independent repair shop perfect ICP match"},
  {"person_id": "def456", "verdict": "poor", "reason": "Automotive parts supplier not a workshop"},
  {"person_id": "ghi789", "verdict": "maybe", "reason": "Bilmekaniker role unclear if decision-maker"}
]
```

**Model to use:** `claude-haiku-4-5-20251001` — lowest cost, fast, more than sufficient for this classification task.

**Cost estimate:** ~1,600 tokens per 25-profile batch → < $0.002 per check. Essentially free even at scale.

**Output:**
```typescript
{
  verdicts: Array<{
    person_id: string;
    verdict: "good" | "maybe" | "poor";
    reason: string;
  }>;
}
```

**Error handling:**
- Claude API down → return `{ error: "ai_unavailable" }` → client shows toast, proceeds normally
- No ICP prompt → return `{ error: "no_icp_prompt" }` → client shows "Set up AI filter in Settings"
- Malformed Claude response → parse what we can, return `maybe` for unparseable entries
- Never block the normal Reveal & Add flow

### 3. New API Routes for Settings

`GET /api/settings/ai-filter` — fetch current settings for workspace
`POST /api/settings/ai-filter` — upsert settings (icp_prompt + filter_enabled)
`POST /api/settings/ai-filter/test` — test a single profile text against saved prompt

### 4. Prospector UI Changes

**Action bar (currently: "25 selected | Reveal & Add to CRM | Clear selection"):**

After AI check has run, action bar becomes:
```
[✨ AI Check (25)]  [🔒 Smart Reveal toggle]  [+ Reveal & Add to CRM (22)]  [Clear selection]
```

- "AI Check" button only appears if `filter_enabled = true` in workspace settings
- While running: button shows spinner + "Checking..." + is disabled
- After check: button shows "Re-check" (in case user changes selection)
- **Smart Reveal toggle** — appears after AI check has run. When ON: "Reveal only Good fits (18)". When the user clicks Reveal, any checked Poor-fit profiles are silently skipped. Toast on completion: "18 contacts added — 7 poor fits skipped". When OFF: Reveal behaves normally (adds everything checked).
- The Smart Reveal toggle state persists in localStorage so the user's preference carries across sessions.

**Results table — new "Fit" column:**
- Column only appears after at least one AI check has been run in the current session
- Each row shows a compact badge:
  - `✓ Good` (green background)
  - `? Maybe` (yellow background)
  - `✗ Poor` (red background, row slightly dimmed)
- Hovering the badge shows a tooltip with the full reason
- Profiles without a verdict (e.g., newly paginated results) show nothing in the Fit column

**New filter bar (appears after first check):**
```
Show: [All (111)] [✓ Good (18)] [? Maybe (4)] [✗ Poor (3)]
```
- Filters the results table client-side (no new search)
- Persists through pagination? → No, only applies to profiles that have been checked (current page)

**Auto-deselect behavior:**
- After check completes, automatically deselect all "poor" fit profiles
- Show toast: "3 poor fits deselected — you can re-select them manually"
- "Maybe" profiles stay selected by default (user decides)

**State management:**
Add to component state:
```typescript
type FitVerdict = { verdict: "good" | "maybe" | "poor"; reason: string };
const [verdicts, setVerdicts] = useState<Record<string, FitVerdict>>({});
const [aiCheckLoading, setAiCheckLoading] = useState(false);
const [fitFilter, setFitFilter] = useState<"all" | "good" | "maybe" | "poor">("all");
const [aiFilterEnabled, setAiFilterEnabled] = useState(false); // fetched on mount
```

On mount (after workspace loads): fetch `GET /api/settings/ai-filter` to check if filter is enabled. If no settings exist yet, `aiFilterEnabled = false`.

### 5. New Environment Variable

`ANTHROPIC_API_KEY` — needs to be added to:
- `.env.local` (local dev)
- Vercel environment variables (production)

---

## New Files CC Creates

```
src/app/(dashboard)/settings/ai-filter/page.tsx   — Settings UI
src/app/api/settings/ai-filter/route.ts            — GET + POST handler
src/app/api/prospector/ai-filter/route.ts          — AI evaluation endpoint
supabase/migrations/YYYYMMDDHHMMSS_workspace_ai_settings.sql
```

## Modified Files CC Edits

```
src/app/(dashboard)/settings/page.tsx              — Add AI Filter card
src/app/(dashboard)/prospector/page.tsx            — Add AI Check button, Fit column, filter bar
```

---

## Phase Scope (what's NOT in this phase)

- **Auto-check on search** (every result gets AI-scored automatically) — skip for now, too expensive and too slow for the search UX. Might add in a future phase as an opt-in.
- **Persistent verdicts** (saving AI verdicts to DB per contact) — unnecessary overhead for now; verdicts are ephemeral per Prospector session
- **Per-page auto-check** — user must click "AI Check" manually

---

## Pre-CC Checklist (Jacob does these)

1. **Get Anthropic API key** — go to console.anthropic.com → API Keys → Create key
2. **Add `ANTHROPIC_API_KEY`** to `.env.local` in the local repo
3. **Add `ANTHROPIC_API_KEY`** to Vercel environment variables (Settings → Environment Variables → Production + Preview)
4. **Pull latest main** before starting CC: `cd /Users/jacobqvisth/crm-for-saas && git pull origin main`
5. **CC prompt:** `02_Projects/wrenchlane-crm/_prompts/cc-prompt-phase12d-ai-filter.md` (write this next)

---

## Testing Checklist (post-CC)

- [ ] AI filter settings page loads at `/settings/ai-filter`
- [ ] Can save and update ICP prompt
- [ ] Enable/disable toggle persists
- [ ] Settings card appears on `/settings` index
- [ ] "AI Check" button appears in Prospector when filter is enabled
- [ ] "AI Check" button does NOT appear when filter is disabled
- [ ] AI check runs successfully against real Prospeo results
- [ ] Fit column appears after check
- [ ] Verdicts show correct color + reason tooltip
- [ ] Poor fits get auto-deselected
- [ ] Fit filter bar works
- [ ] If Anthropic API is down → graceful fallback (toast, no block)
- [ ] If no ICP prompt saved → helpful error toast linking to settings
- [ ] Test endpoint in settings page works
- [ ] E2E smoke tests pass

---

## Decisions (locked in 2026-04-01)

1. **"Maybe" stays selected** — Only auto-deselect "poor" fits. "Maybe" remains checked; user decides manually.

2. **Pre-fill with Wrenchlane's ICP** — The textarea ships pre-populated with Wrenchlane's actual ICP (workshops, VDs, Verkstadschef, Sweden, excludes suppliers). Zero friction to get started.

3. **AI filter button scope** — Only show when ≥1 profile is selected (same behavior as Reveal button).

4. **Page-scope** — Check whatever is currently selected, regardless of page. Simple and correct.

5. **Smart Reveal toggle — YES, include it** — Add a toggle in the action bar: "Reveal only Good fits". When enabled, clicking "Reveal & Add to CRM" automatically skips any Poor-fit profiles even if they're checked. Saves Prospeo credits on obvious mismatches.

---

## Recommended Next Steps

1. Answer the open questions above
2. Write the CC prompt (`cc-prompt-phase12d-ai-filter.md`) in the vault
3. Get Anthropic API key and add to Vercel + `.env.local`
4. Start Phase 12d CC session
