# PERF-14 · Server-resolve workspace in layout (architectural)

- **Runner:** Opus 4.8 · **Effort:** L (do per-page) · **Repo:** `~/crm-for-saas`

## Context
Every CRM page is a `'use client'` shell that pays a 3-hop auth waterfall (`src/lib/hooks/use-workspace.ts:38-84`: `getUser` → `workspace_members` → `workspaces`) from the browser before its own 5-20 queries can start. Nothing is server-rendered or cached for CRM pages (only `/dashboard/*` analytics uses `unstable_cache`). This is the biggest structural latency source but must be done incrementally.

## PROMPT
This is a multi-PR migration; do ONE page per PR. Start with the highest-traffic page (companies or contacts list).

1. Resolve the workspace **once, server-side**, in the `(dashboard)` layout (a server component): do the getUser + membership lookup there and pass `workspaceId` (and any always-needed profile bits) down via props/context, eliminating the per-page 3-hop client waterfall.
2. For the chosen page, move its first-screen data fetch into a server component using `use cache` / `cacheTag` (Next 16), passing initial data to the client component for interactivity. Keep client-side refetch only for user-driven filtering.
3. Preserve behavior and auth guarantees exactly. Coordinate with ARCH-1 (`requireWorkspace` helper) — use it server-side.

### Definition of done (per page)
- The migrated page no longer runs the 3-hop auth waterfall in the browser.
- First paint shows server-rendered data; filtering still works.
- `npm run lint` passes.

### Verify
Network panel on the migrated page: the auth-waterfall requests are gone; initial data arrives with the document. Drive the page with the `verify` skill. Do not migrate the next page until this one is confirmed.
