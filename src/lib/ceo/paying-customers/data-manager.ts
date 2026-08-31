// Thin REST client for Google's Data Manager API, which is where offline
// conversion import lives now.
//
// The Google Ads API used to take these through
// `ConversionUploadService.UploadClickConversions`. It no longer does: that
// service answers CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE — "limited to
// existing users" — for a brand-new integration, and it does so for a gclid and
// a hashed email alike, so it is the door that is shut rather than the key.
//
// Data Manager needs its OWN OAuth scope, `.../auth/datamanager`, which the
// CRM's existing refresh token does not carry (it has adwords,
// analytics.readonly, firebase.readonly, webmasters.readonly). Rather than
// re-consenting that token and risking every Google sync in the app on one
// flow, this reads a SEPARATE credential —
// `GOOGLE_DATAMANAGER_REFRESH_TOKEN` — minted by
// `scripts/google-datamanager-setup.mjs`. When it is absent the whole feature
// skips cleanly and nothing else is affected.

import { getEnv } from "@/lib/ceo/env";
import { SyncSkippedError } from "@/lib/ceo/sync/errors";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";

export const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";

/** Google's own name for consent it has not been told about. */
export type ConsentStatus =
  | "CONSENT_STATUS_UNSPECIFIED"
  | "CONSENT_GRANTED"
  | "CONSENT_DENIED";

export type DataManagerAccess = {
  accessToken: string;
  operatingAccountId: string;
};

export function hasDataManagerCredentials() {
  return Boolean(
    getEnv("GOOGLE_DATAMANAGER_REFRESH_TOKEN") &&
      getEnv("GOOGLE_OAUTH_CLIENT_ID") &&
      getEnv("GOOGLE_OAUTH_CLIENT_SECRET") &&
      getEnv("GOOGLE_ADS_CUSTOMER_ID"),
  );
}

/**
 * Exchange the dedicated refresh token for an access token.
 *
 * Throws SyncSkippedError rather than Error when the credential is simply
 * absent, so an un-set-up feature is recorded as skipped instead of failing a
 * cron on a schedule.
 */
export async function createDataManagerAccess(): Promise<DataManagerAccess> {
  const refreshToken = getEnv("GOOGLE_DATAMANAGER_REFRESH_TOKEN");
  const clientId = getEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const customerId = getEnv("GOOGLE_ADS_CUSTOMER_ID");

  if (!refreshToken) {
    throw new SyncSkippedError(
      "Data Manager is not configured. GOOGLE_DATAMANAGER_REFRESH_TOKEN is missing — " +
        "run scripts/google-datamanager-setup.mjs to mint one. Offline conversion " +
        "import cannot use the Google Ads API: ConversionUploadService is closed to " +
        "new integrations.",
    );
  }
  if (!clientId || !clientSecret) {
    throw new SyncSkippedError(
      "Data Manager is not configured. GOOGLE_OAUTH_CLIENT_ID/_SECRET are missing.",
    );
  }
  if (!customerId) {
    throw new SyncSkippedError(
      "Data Manager is not configured. GOOGLE_ADS_CUSTOMER_ID is missing.",
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!payload.access_token) {
    throw new Error(
      `Data Manager OAuth refresh failed: ${payload.error ?? response.status} ${
        payload.error_description ?? ""
      }`.trim(),
    );
  }

  return {
    accessToken: payload.access_token,
    operatingAccountId: customerId.replace(/[^0-9]/g, ""),
  };
}

/** One conversion to hand to Google. */
export type DataManagerEvent = {
  /** RFC 3339. When the money actually moved. */
  eventTimestamp: string;
  /** Stable per conversion, so a re-send cannot be counted twice. */
  transactionId: string;
  conversionValue?: number;
  currency?: string;
  /** SHA-256 of the lowercase, trimmed email, hex encoded. */
  hashedEmail?: string;
  /** Preferred when present: an exact click match rather than a probabilistic one. */
  gclid?: string;
};

export type IngestResult = {
  ok: boolean;
  status: number;
  /** Google echoes a request id; worth logging when something is refused. */
  requestId?: string;
  error?: string;
};

/**
 * Send events to one Google Ads conversion action.
 *
 * `validateOnly` is a real server-side dry run and is used on the first call of
 * every run, because the failure mode being guarded against is a malformed
 * payload silently recording conversions against the wrong action.
 *
 * Identifiers are sent hex-encoded (`encoding: "HEX"`), matching how
 * `dashboard_users.email_hash` is already stored.
 */
export async function ingestEvents(
  access: DataManagerAccess,
  conversionActionId: string,
  events: DataManagerEvent[],
  options?: { validateOnly?: boolean; consent?: ConsentStatus },
): Promise<IngestResult> {
  // Consent defaults to UNSPECIFIED rather than GRANTED on purpose. Claiming
  // consent we have not recorded would be a false statement to Google about a
  // customer, and these are mostly EU businesses. Set it deliberately, in
  // config, once the signup flow actually captures it.
  const consent = options?.consent ?? "CONSENT_STATUS_UNSPECIFIED";

  const body = {
    encoding: "HEX",
    validateOnly: options?.validateOnly === true,
    destinations: [
      {
        operatingAccount: {
          product: "GOOGLE_ADS",
          accountId: access.operatingAccountId,
        },
        productDestinationId: conversionActionId,
      },
    ],
    consent: { adUserData: consent, adPersonalization: consent },
    events: events.map((event) => ({
      eventTimestamp: event.eventTimestamp,
      transactionId: event.transactionId,
      eventSource: "WEB",
      ...(event.conversionValue !== undefined
        ? { conversionValue: event.conversionValue }
        : {}),
      ...(event.currency ? { currency: event.currency } : {}),
      ...(event.gclid ? { adIdentifiers: { gclid: event.gclid } } : {}),
      ...(event.hashedEmail
        ? { userData: { userIdentifiers: [{ emailAddress: event.hashedEmail }] } }
        : {}),
    })),
  };

  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: text.slice(0, 800),
    };
  }

  let requestId: string | undefined;
  try {
    requestId = (JSON.parse(text) as { requestId?: string }).requestId;
  } catch {
    // A 200 with an unparseable body is still a success; the id is a nicety.
  }

  return { ok: true, status: response.status, requestId };
}
