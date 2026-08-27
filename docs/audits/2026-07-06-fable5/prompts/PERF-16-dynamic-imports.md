# PERF-16 · Dynamic-import analytics tab + rich editor

- **Runner:** Sonnet · **Effort:** S · **Repo:** `~/crm-for-saas`

## Context
`recharts` is statically imported by `sequence-analytics-tab` (pulled into `src/app/(dashboard)/sequences/[id]/page.tsx:10` so it loads even on the default Overview tab) and by the email-campaigns `dashboard-client`. `tiptap` loads statically via `step-card → email-step-editor`, the templates editor, and settings/profile. `jssip` is already correctly `await import(...)` (good); only one `next/dynamic` exists in the whole app.

## PROMPT
1. `next/dynamic` (with `ssr: false` and a light loading placeholder) the recharts-based analytics tab so it loads only when the Analytics tab is opened, not on the sequence Overview.
2. `next/dynamic` the TipTap rich editor components (email-step-editor, templates editor, signature editor) so the heavy editor bundle loads only when an editor is actually shown.
3. Verify no SSR-only assumptions break (these are client editors/charts, so `ssr:false` is appropriate).

### Definition of done
- Opening a sequence's Overview tab no longer loads recharts; opening Analytics loads it on demand.
- Editor pages still work; editor bundle is code-split.
- `npm run build` succeeds; `npm run lint` passes.

### Verify
Build and check the route bundle for `sequences/[id]` no longer includes recharts in the initial chunk. Open Analytics tab → chart renders. Open an editor → editor loads.
