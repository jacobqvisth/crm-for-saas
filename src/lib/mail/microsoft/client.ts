// The only place this codebase talks to Microsoft Graph.
//
// AUTH IS APP-ONLY, AND THAT IS THE POINT
// ---------------------------------------
// Google mailboxes each hold their own refresh token, and a silent expiry
// disconnects an account mid-campaign. That has already cost Wrenchlane live
// sends. App-only client credentials remove the failure mode rather than
// managing it: there is one secret per customer tenant, it is not per mailbox,
// and nothing expires because a user changed their password or revoked a grant.
//
// The corollary is that the app can reach every mailbox in the tenant unless an
// Application Access Policy scopes it to named mailboxes. Phase 07's brief
// requires that policy, and it is the customer's IT department that applies it.
// Nothing here can enforce it, so it belongs in the runbook, not in a comment
// that only developers read.

/** Credentials for one customer's Entra app registration. */
export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface GraphResponse<T = unknown> {
  ok: boolean;
  status: number;
  body: T | null;
  error?: string;
  /**
   * Seconds Graph asked us to wait. Present on 429 and on the 503/504 Graph
   * uses for backend pressure.
   *
   * Honour this rather than applying the generic backoff: Exchange Online's
   * limits are per mailbox and per app, and guessing an interval either wastes
   * throughput or gets the app throttled harder.
   */
  retryAfterSeconds?: number;
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Graph refuses a MIME upload larger than this on the simple create path.
 * Beyond it an upload session is required, which the sequence engine has never
 * needed: its messages are text and HTML with tracking, not attachments.
 */
export const MAX_MIME_BYTES = 4 * 1024 * 1024;

export function graphConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GraphConfig | { error: string } {
  const tenantId = env.MICROSOFT_TENANT_ID?.trim();
  const clientId = env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) {
    return {
      error:
        "Microsoft Graph is not configured (MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)",
    };
  }
  return { tenantId, clientId, clientSecret };
}

interface CachedToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

export class GraphClient {
  private readonly cfg: GraphConfig;
  private readonly doFetch: typeof fetch;
  private cached: CachedToken | null = null;
  /** Collapses concurrent token requests into one. */
  private inFlight: Promise<{ accessToken: string } | { error: string }> | null = null;

  constructor(cfg: GraphConfig, fetchImpl?: typeof fetch) {
    this.cfg = cfg;
    this.doFetch = fetchImpl ?? fetch;
  }

  /**
   * An app-only access token, cached until shortly before it expires.
   *
   * The 60-second margin is not superstition: the send cron can be most of a
   * minute between deciding to send and actually sending, and a token that
   * expires in that window fails the send rather than the token fetch, which is
   * much harder to read in a log.
   */
  async token(now = Date.now()): Promise<{ accessToken: string } | { error: string }> {
    if (this.cached && this.cached.expiresAt - 60_000 > now) {
      return { accessToken: this.cached.token };
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const url = `https://login.microsoftonline.com/${encodeURIComponent(
        this.cfg.tenantId,
      )}/oauth2/v2.0/token`;
      const form = new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        // .default asks for exactly the application permissions an admin has
        // already consented to. Naming individual scopes here would be a lie:
        // app-only cannot request incremental consent at runtime.
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      });

      try {
        const res = await this.doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
        const body = (await res.json().catch(() => null)) as {
          access_token?: string;
          expires_in?: number;
          error_description?: string;
          error?: string;
        } | null;

        if (!res.ok || !body?.access_token) {
          return {
            error:
              body?.error_description ??
              body?.error ??
              `Token request failed with HTTP ${res.status}`,
          };
        }
        this.cached = {
          token: body.access_token,
          expiresAt: now + (body.expires_in ?? 3600) * 1000,
        };
        return { accessToken: body.access_token };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  /** Drop the cached token. Used when Graph rejects it as expired. */
  invalidateToken(): void {
    this.cached = null;
  }

  /**
   * One Graph call.
   *
   * Never throws: the send engine runs on a cron, and a thrown error there ends
   * a whole batch instead of one message.
   */
  async request<T = unknown>(
    path: string,
    init: {
      method?: string;
      body?: string;
      contentType?: string;
      /** Absolute URL instead of a path. Delta links come back fully formed. */
      absoluteUrl?: string;
    } = {},
  ): Promise<GraphResponse<T>> {
    const tok = await this.token();
    if ("error" in tok) return { ok: false, status: 0, body: null, error: tok.error };

    const url = init.absoluteUrl ?? `${GRAPH_BASE}${path}`;
    try {
      const res = await this.doFetch(url, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${tok.accessToken}`,
          ...(init.contentType ? { "content-type": init.contentType } : {}),
        },
        body: init.body,
      });

      const retryAfterHeader = res.headers?.get?.("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;

      // 202 and 204 carry no body. Reading one would throw on some runtimes and
      // return null on others, so do not read one at all.
      let parsed: T | null = null;
      if (res.status !== 204 && res.status !== 202) {
        parsed = (await res.json().catch(() => null)) as T | null;
      }

      if (!res.ok) {
        const errBody = parsed as { error?: { code?: string; message?: string } } | null;
        // An expired token looks like any other 401. Dropping the cache means
        // the next call re-authenticates instead of failing identically.
        if (res.status === 401) this.invalidateToken();
        return {
          ok: false,
          status: res.status,
          body: parsed,
          error:
            errBody?.error?.message ??
            errBody?.error?.code ??
            `Graph returned HTTP ${res.status}`,
          ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {}),
        };
      }

      return { ok: true, status: res.status, body: parsed };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        body: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** True for the statuses that mean "slow down", not "no". */
export function isThrottled(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}
