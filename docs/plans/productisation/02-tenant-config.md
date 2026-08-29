# 02. Typed tenant config

**Depends on:** 01.
**Visible change for Wrenchlane:** none.

## Goal

One typed module per customer describing everything that differs between them, selected by
a single environment variable at deploy time. Typed files in the repo rather than a pile of
environment variables, so the compiler catches a missing field and a config change goes
through review like any other diff.

## Shape

```
src/config/tenants/
  types.ts        // the TenantConfig interface, exhaustive
  wrenchlane.ts   // exactly today's behaviour
  index.ts        // getTenant(), reads TENANT_SLUG, defaults to "wrenchlane"
```

`TenantConfig` should cover at minimum:

- **Identity**: slug, legal name, display name, product description, support address
- **Domains**: app URL, sending domains, tracking domain, domains treated as internal
- **Mail**: default provider (`google` | `microsoft`), per-provider send caps and intervals
- **Locale**: default language, the set of languages sequences may use, timezone for
  date ranges (Wrenchlane's analytics ranges are Stockholm time, half-open `[start, end)`)
- **Features**: the flag map, added in phase 03
- **AI**: knowledge seeds, ICP language, tone notes, the outbound scenarios
- **Integrations**: which of Apify, 46elks, Deepgram, ElevenLabs, MillionVerifier, Maps,
  Slack, Stripe this tenant uses at all

## Rules

- `wrenchlane.ts` must encode **exactly** what the code does today. Where a value is
  currently hardcoded, move it into the config with the same value. Where it is currently
  an env var, keep reading the env var and let the config name it.
- `getTenant()` is synchronous, pure and safe to call from server components, route handlers
  and crons. No I/O. The live pull comes later in phase 05 and layers on top.
- Do not add Animech or Spennare configs yet. They arrive in their own phases, and adding
  them now means guessing.

## Migration strategy for the 665 hardcoded strings

There are 665 case-insensitive occurrences of "wrenchlane" across 172 files. Almost all are
content: AI prompts, knowledge seeds, domain lists, ICP copy, email scenarios. Do **not**
try to move all of them in this phase. Move only what the config declares, in this order:

1. Identity and domains (small, high value, unblocks phase 08)
2. AI knowledge and ICP language (largest, most valuable to make per-tenant)
3. Everything else, opportunistically, as later phases touch those files

Leave a `// TODO(tenant-config)` marker where you see one and move on. A half-migrated
config that compiles beats a fully migrated one that is three weeks late.

## Done when

- `TENANT_SLUG=wrenchlane` (and unset) produce identical behaviour to today.
- `npm run build`, `lint`, `tsc --noEmit` and the smoke tests pass.
- A grep for the identity and domain values finds them only in `wrenchlane.ts`.
