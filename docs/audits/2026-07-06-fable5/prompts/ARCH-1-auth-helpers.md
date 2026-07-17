# ARCH-1 · `requireUser` / `requireWorkspace` / `requireCronSecret` helpers

- **Runner:** Opus 4.8 (design) then Sonnet (migrate in batches) · **Effort:** M · **Repo:** `~/crm-for-saas`

## Context
Auth boilerplate is copy-pasted across ~102 routes (`createClient()+getUser()+401`). `resolveWorkspace()` (getUser + `workspace_members` lookup) exists in **3 identical copies** (`src/lib/roadmap/server.ts`, `src/lib/forums/server.ts`, `src/lib/videos/server.ts`); `getWorkspaceId()` is redefined in 6 route files. The cron-secret check is inline-duplicated in 12 routes, and `e2e-login` uses a third form. Any auth change means 100+ edits, and drift already exists.

## PROMPT
1. Create `src/lib/api/auth.ts` exporting:
   - `requireUser(req)` → returns `{ supabase, user }` or throws/returns a 401 `Response`.
   - `requireWorkspace(req)` → `requireUser` + workspace-membership lookup, returns `{ supabase, user, workspaceId }`. Promote the **best** existing `resolveWorkspace` implementation as the basis.
   - `requireCronSecret(req)` → validates the `CRON_SECRET` bearer (header, timing-safe), returns 401 otherwise.
   Pick one ergonomic pattern (returning a `Response` on failure that routes early-return, OR throwing a typed error caught by a small wrapper) and apply it consistently.
2. Delete the 3 `resolveWorkspace` copies and 6 local `getWorkspaceId` defs; re-point their callers.
3. Migrate routes to the helpers **in batches by domain** (calls/, sequences/, contacts/, inbox/, cron/) — one PR per batch is fine; each batch is pure-mechanical once the helper exists. Don't change any route's actual auth requirement.

### Definition of done
- One canonical auth module; the 3 copies + 6 local defs gone.
- Migrated routes behave identically (same 401s, same workspace scoping).
- `npm run lint` and `npm test` pass.

### Verify
Spot-check a migrated route in each batch: unauthenticated → 401; authenticated cross-workspace access still scoped. Run the Playwright smoke suite.
