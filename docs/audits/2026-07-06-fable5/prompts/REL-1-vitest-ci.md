# REL-1 · `"test": "vitest run"` + CI job

- **Runner:** Sonnet · **Effort:** S · **Severity:** HIGH (ROI) · **Repo:** `~/crm-for-saas`

## Context
48 vitest files exist but vitest **never runs in CI**. `package.json` scripts have only `test:e2e*`; `.github/workflows/e2e.yml` runs build+lint+tsc on PRs and Playwright on push-to-main. The existing unit coverage (render, scheduler, variants, parse-ndr, sender-rotation, 14 ceo files) can silently rot. This is the single highest-ROI change in the audit — it makes every later test-adding prompt actually protective.

## PROMPT
1. Add to `package.json` scripts: `"test": "vitest run"` and `"test:watch": "vitest"`.
2. Add a CI job that runs `npm test` on every PR. Either extend `.github/workflows/e2e.yml` with a `unit` job or add `.github/workflows/unit.yml`. It should install deps and run `npm test` (vitest needs no browser/DB — confirm the existing tests are pure/mocked; if any require env, mark/skip or provide test env).
3. Fix any currently-failing test surfaced by the first run (report them if they reveal real bugs rather than blindly muting).

### Definition of done
- `npm test` runs the vitest suite locally and green.
- CI runs unit tests on PRs.
- `npm run lint` passes.

### Verify
Run `npm test` locally → all pass. Push a trivial branch and confirm the unit job runs in CI.
