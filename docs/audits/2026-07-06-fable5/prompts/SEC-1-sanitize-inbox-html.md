# SEC-1 · Sanitize incoming email HTML (stored XSS)

- **Runner:** Opus 4.8 · **Effort:** M · **Severity:** HIGH · **Repo:** `~/crm-for-saas`

## Context
The inbox renders the raw `text/html` body of received emails via `dangerouslySetInnerHTML` with **no sanitization** — no HTML sanitizer is installed in the project. Anyone who emails one of the ~12 synced mailboxes can embed `<img onerror>`, `<svg onload>`, or `<iframe>` that executes in a staff operator's authenticated dashboard when they open the thread. This is a remotely-triggerable stored XSS.

Primary sink: `src/app/(dashboard)/inbox/inbox-client.tsx` (~line 245, renders `item.body_html`). The HTML originates from `src/lib/gmail/messages.ts` (~line 49). Other `dangerouslySetInnerHTML` sinks (self/AI content, lower risk but fix too): `src/app/(dashboard)/settings/profile/page.tsx` (~514), `src/components/settings/signature-editor-modal.tsx` (~135), `src/components/sequences/generate-variants-modal.tsx` (~248), `src/components/sequences/email-step-editor.tsx` (~232), `src/components/calls/call-drawer.tsx` (~594).

## PROMPT
Eliminate the stored-XSS risk from rendering untrusted email HTML in the CRM.

1. Add a sanitizer dependency: `isomorphic-dompurify` (works in both server and client React contexts; verify with the `claude-api`/Context7 skill or the package README that the import shape is `import DOMPurify from 'isomorphic-dompurify'`).
2. Create `src/lib/sanitize-html.ts` exporting `sanitizeEmailHtml(html: string): string` with a strict allowlist config: allow common formatting/table/link/image tags and `style`/`href`/`src`/`alt`/`width`/`height` attributes; **forbid** `script`, `iframe`, event handlers (`on*`), `<style>` blocks that could break out, and `javascript:`/`data:` (except `data:image/*`) URLs. Add `target="_blank" rel="noopener noreferrer"` to links.
3. **Strongest option for the inbox specifically:** render incoming mail inside a sandboxed iframe — `<iframe sandbox srcdoc={sanitized} />` with no `allow-scripts` — so even a sanitizer bypass can't touch the dashboard origin. If you keep `dangerouslySetInnerHTML`, it must be `sanitizeEmailHtml(...)` output. Prefer the iframe for `inbox-client.tsx`.
4. Wrap the other 5 sinks with `sanitizeEmailHtml` (or a lighter variant for trusted-but-still-defensive signature/AI content).
5. Do not change how bodies are stored or fetched — sanitize at render only (so re-sanitizing after a rule change is possible).

### Definition of done
- No `dangerouslySetInnerHTML` in the repo receives unsanitized external content.
- Inbox thread rendering visually unchanged for benign emails.
- `npm run lint` passes.

### Verify
Add a test email row (or unit test) with `body_html` = `<img src=x onerror=alert(1)><p>hi</p>` and confirm the rendered output contains `<p>hi</p>` but no `onerror`/`<script>`. Drive the inbox with the `verify` skill and open a thread to confirm normal emails still render.
