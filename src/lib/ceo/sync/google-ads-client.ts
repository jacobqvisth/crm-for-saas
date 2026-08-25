import { getEnv } from "@/lib/ceo/env";
import { createGoogleAuth } from "@/lib/ceo/sync/google-auth";
import { SyncSkippedError } from "./errors";

/**
 * Thin REST client for the Google Ads API.
 *
 * Deliberately not the `google-ads-api` npm package: this only needs three
 * endpoints, and the existing OAuth plumbing in `google-auth.ts` already yields
 * the credential the API wants. Adding a heavyweight generated client for that
 * would be more surface than the job needs.
 *
 * Every call needs three things beyond OAuth:
 *   - `developer-token`   the 22-char token from the manager account's API Center
 *   - `login-customer-id` the manager account, when the token lives on an MCC and
 *                         the target account sits underneath it
 *   - a customer ID       the account being queried, digits only, no dashes
 */

/**
 * v25, because that is the version actually verified against this account.
 *
 * This client was written against v21 and, until the developer token exists in
 * an environment, has never made a live call. The audit scripts in
 * `~/Documents/First Vault/google-ads-campaigns/` did make live calls, on v25,
 * with HTTP 200. Google supports each version for roughly a year, so v21 is at
 * or past end of life and pinning it would mean the first real request this
 * client ever makes is against a version that may already be gone.
 */
export const GOOGLE_ADS_API_VERSION = "v25";
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

/** Strip the dashes Google Ads shows in the UI. The API wants bare digits. */
export function normalizeCustomerId(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export type GoogleAdsAccess = {
  customerId: string;
  loginCustomerId: string | null;
  developerToken: string;
  headers: () => Promise<Headers>;
};

export function hasGoogleAdsApiCredentials() {
  return Boolean(
    getEnv("GOOGLE_ADS_DEVELOPER_TOKEN") && getEnv("GOOGLE_ADS_CUSTOMER_ID"),
  );
}

/**
 * Resolve credentials, or throw SyncSkippedError so the run is recorded as
 * "skipped" rather than "failed". Missing configuration is not an outage.
 */
export async function createGoogleAdsAccess(): Promise<GoogleAdsAccess> {
  const developerToken = getEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
  const rawCustomerId = getEnv("GOOGLE_ADS_CUSTOMER_ID");

  if (!developerToken) {
    throw new SyncSkippedError(
      "Google Ads API is not configured. GOOGLE_ADS_DEVELOPER_TOKEN is missing. " +
        "Get one from the API Center of a Google Ads manager account " +
        "(ads.google.com/aw/apicenter). Keyword Planner additionally requires " +
        "Basic access, applied for from that same page.",
    );
  }

  if (!rawCustomerId) {
    throw new SyncSkippedError(
      "Google Ads API is not configured. GOOGLE_ADS_CUSTOMER_ID is missing.",
    );
  }

  const customerId = normalizeCustomerId(rawCustomerId);
  if (!customerId) {
    throw new SyncSkippedError(
      `GOOGLE_ADS_CUSTOMER_ID does not contain any digits: ${rawCustomerId}`,
    );
  }

  const rawLoginCustomerId = getEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  const loginCustomerId = rawLoginCustomerId
    ? normalizeCustomerId(rawLoginCustomerId)
    : null;

  const auth = await createGoogleAuth([GOOGLE_ADS_SCOPE]);

  return {
    customerId,
    loginCustomerId,
    developerToken,
    async headers() {
      const authHeaders = await auth.getRequestHeaders();
      const headers = new Headers();

      if (authHeaders instanceof Headers) {
        authHeaders.forEach((value, key) => headers.set(key, value));
      } else {
        for (const [key, value] of Object.entries(authHeaders)) {
          if (typeof value === "string") {
            headers.set(key, value);
          }
        }
      }

      headers.set("developer-token", developerToken);
      if (loginCustomerId) {
        headers.set("login-customer-id", loginCustomerId);
      }
      headers.set("content-type", "application/json");
      headers.set("accept", "application/json");

      return headers;
    },
  };
}

export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly errorCodes: string[];

  constructor(message: string, status: number, errorCodes: string[]) {
    super(message);
    this.name = "GoogleAdsApiError";
    this.status = status;
    this.errorCodes = errorCodes;
  }

  /**
   * True when the failure is "your token is not allowed to do this" rather than
   * a transient or malformed-request problem.
   *
   * This is the expected state on an Explorer-level token: it reaches production
   * accounts but not the keyword planning services. Callers use this to record a
   * warning and carry on with the reports that do work, instead of failing the
   * whole sync.
   */
  get isAccessLevelProblem() {
    if (this.status === 403) {
      return true;
    }

    return this.errorCodes.some((code) =>
      /DEVELOPER_TOKEN|NOT_ADS_USER|CUSTOMER_NOT_ENABLED|PERMISSION|UNAUTHORIZED|OPERATION_NOT_PERMITTED|RESOURCE_ACCESS_DENIED/i.test(
        code,
      ),
    );
  }
}

type GoogleAdsErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: {
      errors?: {
        message?: string;
        errorCode?: Record<string, string>;
      }[];
    }[];
  };
};

function collectErrorCodes(payload: GoogleAdsErrorPayload) {
  const codes: string[] = [];

  for (const detail of payload.error?.details ?? []) {
    for (const entry of detail.errors ?? []) {
      for (const [group, code] of Object.entries(entry.errorCode ?? {})) {
        codes.push(`${group}.${code}`);
      }
    }
  }

  if (payload.error?.status) {
    codes.push(payload.error.status);
  }

  return codes;
}

export async function googleAdsRequest<T>(
  access: GoogleAdsAccess,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${path}`;
  const headers = await access.headers();

  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    let codes: string[] = [];
    let detail = text;

    try {
      const parsed = JSON.parse(text) as GoogleAdsErrorPayload;
      codes = collectErrorCodes(parsed);
      detail = parsed.error?.message ?? text;
    } catch {
      // Non-JSON error body; keep the raw text.
    }

    throw new GoogleAdsApiError(
      `Google Ads API ${response.status} on ${path}: ${detail}${
        codes.length > 0 ? ` [${codes.join(", ")}]` : ""
      }`,
      response.status,
      codes,
    );
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Run a GAQL query, following `nextPageToken` to completion.
 *
 * Uses the unary `search` endpoint rather than `searchStream`: streaming returns
 * a JSON array of chunks that has to be assembled anyway, and these reports are
 * small enough that paging is simpler and easier to reason about.
 */
export async function googleAdsSearch<T>(
  access: GoogleAdsAccess,
  query: string,
  pageSize?: number,
): Promise<T[]> {
  const rows: T[] = [];
  let pageToken: string | undefined;

  do {
    // `pageSize` is deliberately omitted unless a caller asks for one.
    //
    // Sending it at all returns PAGE_SIZE_NOT_SUPPORTED on current API
    // versions, verified against this account. This used to default to 10000,
    // which would have made every call fail the moment a developer token was
    // added, and failed in a way that reads like a permissions problem rather
    // than a malformed request. Paging still works: the server picks its own
    // size and we follow nextPageToken to the end either way.
    const payload = await googleAdsRequest<{
      results?: T[];
      nextPageToken?: string;
    }>(access, `customers/${access.customerId}/googleAds:search`, {
      query,
      ...(pageSize ? { pageSize } : {}),
      ...(pageToken ? { pageToken } : {}),
    });

    rows.push(...(payload.results ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return rows;
}

/** Google Ads returns money as micros: 1_000_000 micros = one currency unit. */
export function microsToUnits(micros: string | number | null | undefined) {
  const value = Number(micros ?? 0);
  return Number.isFinite(value) ? value / 1_000_000 : 0;
}
