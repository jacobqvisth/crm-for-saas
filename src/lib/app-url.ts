import { getTenant } from "@/config/tenants";

/**
 * The public base URL of this deployment, with any trailing slash removed.
 *
 * Used wherever we hand an absolute URL to something outside the app: 46elks
 * webhooks, ElevenLabs agent callbacks, Slack message links, the security
 * scanner's target.
 *
 * Resolution order, which reproduces exactly what the seven copies of this
 * helper did before it existed:
 *
 *   1. NEXT_PUBLIC_APP_URL, the value every real deployment sets
 *   2. the tenant's compiled `domains.appUrl`
 *
 * There were seven byte-identical copies of this function (three switchboard
 * routes, two call routes, the Slack bug reporter and the security scanner),
 * each with Wrenchlane's Vercel URL written into it. That is seven files to
 * find and edit per new customer, and seven chances to miss one and have a
 * second tenant's webhooks point at Wrenchlane's deployment.
 *
 * The `.trim()` is not cosmetic. A single trailing newline in
 * NEXT_PUBLIC_APP_URL once produced hrefs split mid-URL in outbound email and
 * truncated List-Unsubscribe headers, both spam-filter smoking guns. The mail
 * path already defends against it in `src/lib/gmail/send.ts`; doing it here too
 * means no caller has to remember.
 */
export function appBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const raw = fromEnv || getTenant().domains.appUrl;
  return raw.trim().replace(/\/+$/, "");
}
