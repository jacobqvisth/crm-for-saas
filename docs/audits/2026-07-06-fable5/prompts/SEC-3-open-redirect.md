# SEC-3 · Close open redirect on the tracking domain

- **Runner:** Opus 4.8 · **Effort:** M · **Severity:** MEDIUM · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/tracking/click/[trackingId]/route.ts` (~14, ~74) reads `url = searchParams.get("url")`, checks only the `http(s)://` prefix, then `NextResponse.redirect(url, 302)` — and the redirect fires **even when `trackingId` matches no `email_queue` row**. Because this endpoint is served from `link.wrenchlane.se` (a domain used in real sales emails), it's an open redirect that lets attackers launder phishing links through the trusted branded domain.

## PROMPT
Make the click-tracker only redirect to URLs we actually sent.

1. Preferred design: **store the wrapped links per email**. When wrapping links at send time (find where outbound HTML is link-wrapped — likely in the render/queue path, `src/lib/sequences/render*` or the send route), persist each original destination keyed by `(tracking_id, link_id)` or a hash. The click route then looks up the destination server-side by id, records the click, and redirects to the stored URL — the `url` query param goes away entirely.
2. If a full redesign is too large for one PR, ship the **interim guard**: (a) require `trackingId` to resolve to a real `email_queue`/`email_events` row before redirecting (404/400 otherwise); (b) validate the destination host against an allowlist of domains we legitimately link to (wrenchlane properties + a configurable list); reject others. Log rejected attempts via `reportError` (see REL-2) if present.
3. Keep the click-recording behavior intact (still log opens/clicks for valid ids).

### Definition of done
- `.../api/tracking/click/<random>/?url=https://evil.example` no longer 302s to an arbitrary host.
- Legitimate tracked links from real emails still redirect + record the click.
- `npm run lint` passes.

### Verify
Manually hit the route with (a) a valid tracking id + known destination → 302 to destination + click recorded; (b) an unknown id or off-allowlist url → 4xx, no redirect. Unit-test the host-allowlist helper.
