# SEC-2 · Calls webhook: mandatory auth + SSRF guard

- **Runner:** Opus 4.8 · **Effort:** M · **Severity:** HIGH · **Repo:** `~/crm-for-saas`

## Context
The 46elks webhooks are public by necessity (46elks sends no auth headers), but the current guarding is unsafe:
- `src/app/api/calls/webhook/hangup/route.ts` (~22-28): `const expected = process.env.CALL_WEBHOOK_SECRET; if (expected) { ...verify... }` — **auth is skipped entirely when the env var is unset.**
- The secret, when present, is passed as a **URL query param** (`src/app/api/calls/webhook/inbound/route.ts` ~143) → leaks into Vercel access logs and Referer headers.
- On hangup, the handler stores an attacker-controllable `recordingurl` and later `fetchRecordingAudio(url)` in `src/lib/calls/elks.ts` (~83-92) does `fetch(url)` with **no host/IP validation** (only branches Basic-auth on `url.includes("46elks.com")`) → blind SSRF (e.g. `http://169.254.169.254/...`).

## PROMPT
Harden both 46elks webhook routes and the recording fetch.

1. **Fail closed:** if `CALL_WEBHOOK_SECRET` is unset, reject webhook requests with 401 in production (`process.env.VERCEL_ENV === 'production'`). Never run the "no secret → allow" path in prod.
2. **Move the secret out of the URL:** verify it from a header. Preferred: an HMAC-SHA256 signature of the raw request body using the shared secret, sent in a header 46elks can be configured to include; if 46elks can only append a static token, put it in a header, not the query string, and compare with `crypto.timingSafeEqual`. Update the 46elks webhook configuration note in the PR description (Jacob configures the 46elks side).
3. **SSRF guard:** create `src/lib/net/safe-fetch.ts` exporting `assertPublicUrl(url)` and a `safeFetch()` wrapper that (a) allows only `http`/`https`, (b) resolves the hostname and rejects private/loopback/link-local/metadata ranges (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`), (c) re-validates on each redirect hop (or sets `redirect: 'manual'` and re-checks). 
4. **Allowlist recordings:** `fetchRecordingAudio` should only fetch hosts matching `*.46elks.com` (in addition to the SSRF guard).
5. Reuse `assertPublicUrl` for the enrich fetches too (see SEC — this closes `find-website.ts`/`find-phone.ts` SSRF as a bonus; wire those in if quick).

### Definition of done
- Webhook requests without a valid secret/signature get 401 in prod.
- `fetchRecordingAudio` refuses non-46elks and private-IP URLs.
- Existing happy-path call recording still works (46elks URLs).
- `npm run lint` passes.

### Verify
Unit-test `assertPublicUrl` with `http://169.254.169.254/`, `http://localhost/`, `https://recordings.46elks.com/x.wav` (only the last passes). Unit-test the webhook returns 401 when the secret is missing/wrong under a mocked `VERCEL_ENV=production`.
