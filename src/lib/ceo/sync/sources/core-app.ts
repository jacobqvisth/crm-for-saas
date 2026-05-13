import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  GetObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import Stripe from "stripe";
import {
  isInternalTestUserOrWorkshopWith,
  loadInternalTestSets,
  type InternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import { addUtcDays, startOfUtcDay } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { requireSourceEnv } from "../errors";
import {
  listSubscriptions,
  subscriptionPeriod,
  unixToIso,
} from "./stripe";
import {
  buildUserStatsEmailLookup,
  normalizeEmail,
} from "./user-stats-lookup";
import type {
  CostEntryRow,
  DiagnosticChatRow,
  DiagnosticRow,
  MetricPoint,
  MotorUsageRow,
  RawMetricRow,
  SourceConnector,
  SourceSyncWindow,
  UserRow,
  WorkshopRow,
} from "../types";

type UserStatsRecord = {
  company_name?: string | null;
  country?: string | null;
  language?: string | null;
  credits_remaining?: number | string | null;
  created_at?: string | null;
  user_created_at?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  last_active?: string | null;
  last_login?: string | null;
  login_count?: number | string | null;
  plan_type?: string | null;
  subscription_status?: string | null;
  payment_status?: string | null;
  trial_end?: string | null;
  created_by_agent?: boolean | string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  user_id?: number | string | null;
  user_role?: string | null;
  username?: string | null;
  workshop_activated_at?: string | null;
  workshop_created_at?: string | null;
  workshop_id?: number | string | null;
};

type DiagnosticRecord = {
  ai_model?: string | null;
  analyzed_at?: string | null;
  car_make?: string | null;
  car_model?: string | null;
  car_year?: number | string | null;
  completed_at?: string | null;
  created_at?: string | null;
  description?: string | null;
  diag_cost?: number | string | null;
  diagnostics_id?: number | string | null;
  dtcs?: unknown;
  has_chat?: boolean | null;
  has_invoice?: boolean | null;
  input_tokens?: number | string | null;
  internal_error_codes?: unknown;
  num_causes?: number | string | null;
  output_tokens?: number | string | null;
  parent_diagnostics_id?: number | string | null;
  possible_causes?: unknown;
  repair_procedures_viewed?: unknown;
  status?: string | null;
  symptoms?: unknown;
  updated_at?: string | null;
  user_actions?: unknown;
  user_id?: number | string | null;
};

type DiagnosticChatRecord = {
  chat_cost?: number | string | null;
  chat_id?: number | string | null;
  created_at?: string | null;
  diagnostics_id?: number | string | null;
  message_count?: number | string | null;
  messages?: unknown;
  models_used?: unknown;
  total_input_tokens?: number | string | null;
  total_output_tokens?: number | string | null;
  total_thinking_tokens?: number | string | null;
  updated_at?: string | null;
  user_id?: number | string | null;
};

type MotorUsageRecord = {
  database?: string | null;
  month?: string | null;
  total_accesses?: number | string | null;
  unique_users?: number | string | null;
  unique_vehicles?: number | string | null;
};

type CostAnalysisPayload = Record<string, unknown>;

type CoreAppFileKey =
  | "user_stats"
  | "diagnostics"
  | "diagnostics_chat"
  | "motor_usage"
  | "cost_analysis";

type DownloadedFile<T> = {
  body: T;
  etag: string | null;
  key: string;
  lastModified: Date;
};

type CostLeaf = {
  amount: number;
  itemKey: string;
  section: string;
};

type CustomerIoProfileLookup = {
  profileId: string;
  customerIoId: string | null;
  email: string | null;
};

type CustomerIoUserEnrichment = {
  country: string | null;
  createdAt: string | null;
  customerIoId: string | null;
  customerIoProfileId: string;
  customerIoWorkshopId: string | null;
  matchType: "id";
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
};

type CustomerIoWorkshopEnrichment = {
  country: string | null;
  countryConflict: boolean;
  matchedUsers: number;
  stripeCustomerId: string | null;
  stripeCustomerIdConflict: boolean;
  subscriptionStatus: string | null;
  subscriptionStatusConflict: boolean;
};

type CoreAppCustomerIoEnrichment = {
  summary: Record<string, unknown>;
  usersByInternalUserId: Map<string, CustomerIoUserEnrichment>;
  workshopsByWorkshopId: Map<string, CustomerIoWorkshopEnrichment>;
};

type CustomerIoMatchCandidate = {
  email: string;
  internalUserId: string;
  workshopId: string | null;
};

type CustomerIoProfileClassification = {
  customerIoInternalUserId: string | null;
  customerIoWorkshopId: string | null;
  kind: "mismatch" | "non_product_contact" | "user_match" | "workshop_match";
  workshopBucketAllowed: boolean;
};

type StripeUserEnrichment = {
  customerCreatedAt: string | null;
  customerEmail: string | null;
  customerId: string | null;
  matchType:
    | "core_stripe_subscription_id"
    | "core_stripe_customer_id"
    | "customer_email"
    | "customer_metadata"
    | "subscription_metadata";
  subscriptionCreatedAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  subscriptionId: string;
  subscriptionStatus: string;
};

type StripeWorkshopEnrichment = {
  customerCreatedAt: string | null;
  customerEmail: string | null;
  customerId: string | null;
  matchType:
    | "core_stripe_subscription_id"
    | "core_stripe_customer_id"
    | "customer_email"
    | "customer_metadata"
    | "subscription_metadata";
  subscriptionCreatedAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  subscriptionId: string;
  subscriptionStatus: string;
};

type CoreAppStripeEnrichment = {
  summary: Record<string, unknown>;
  usersByInternalUserId: Map<string, StripeUserEnrichment>;
  workshopsByWorkshopId: Map<string, StripeWorkshopEnrichment>;
};

const CORE_APP_FILES: Record<CoreAppFileKey, string> = {
  user_stats: "latest/user_stats.json.gz",
  diagnostics: "latest/diagnostics.json.gz",
  diagnostics_chat: "latest/diagnostics_chat.json.gz",
  motor_usage: "latest/motor_usage.json.gz",
  cost_analysis: "latest/cost_analysis.json.gz",
};

function createCoreAppS3Client() {
  return new S3Client({
    credentials: {
      accessKeyId: getEnv("AWS_ACCESS_KEY_ID")!,
      secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY")!,
    },
    region: getEnv("AWS_REGION")!,
  });
}

async function readBodyBytes(
  body: GetObjectCommandOutput["Body"],
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }

  if ("transformToByteArray" in body && typeof body.transformToByteArray === "function") {
    return body.transformToByteArray();
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk),
    );
  }

  return Buffer.concat(chunks);
}

async function downloadCoreAppJson<T>(
  client: S3Client,
  key: string,
): Promise<DownloadedFile<T>> {
  const command = new GetObjectCommand({
    Bucket: getEnv("DATA_BUCKET")!,
    Key: key,
  });
  const response = await client.send(command);
  const body = Buffer.from(await readBodyBytes(response.Body));
  const payload = JSON.parse(gunzipSync(body).toString("utf8")) as T;

  return {
    body: payload,
    etag: response.ETag?.replaceAll('"', "") ?? null,
    key,
    lastModified: response.LastModified ?? new Date(),
  };
}

function getCustomerIoBaseUrl() {
  return getEnv("CUSTOMER_IO_REGION")?.toLowerCase() === "eu"
    ? "https://api-eu.customer.io/v1"
    : "https://api.customer.io/v1";
}

function hasCustomerIoAppConfig() {
  return Boolean(getEnv("CUSTOMER_IO_APP_API_KEY"));
}

async function fetchCustomerIoJson<T>(
  path: string,
  searchParams?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${getCustomerIoBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${getEnv("CUSTOMER_IO_APP_API_KEY")}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Customer.io API failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function findCustomerIoProfileByEmail(
  email: string,
): Promise<CustomerIoProfileLookup | null> {
  const response = await fetchCustomerIoJson<{
    customers?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
  }>("/customers", { email });
  const result = response.results?.[0] ?? response.customers?.[0];
  const profileId = asString(result?.id);

  if (!profileId) {
    return null;
  }

  return {
    profileId,
    customerIoId: asString(result?.cio_id),
    email: asString(result?.email),
  };
}

async function fetchCustomerIoProfileAttributes(profileId: string) {
  const response = await fetchCustomerIoJson<{
    customer?: {
      attributes?: Record<string, unknown>;
    };
  }>(`/customers/${encodeURIComponent(profileId)}/attributes`);

  return response.customer?.attributes ?? {};
}

export function classifyCustomerIoProfile(
  candidate: CustomerIoMatchCandidate,
  attributes: Record<string, unknown>,
): CustomerIoProfileClassification {
  const customerIoInternalUserId = asString(attributes.id);
  const customerIoWorkshopId = asString(attributes.workshop_id);

  const internalUserMatches =
    customerIoInternalUserId === candidate.internalUserId;
  const workshopMatches = Boolean(
    candidate.workshopId && customerIoWorkshopId === candidate.workshopId,
  );
  const hasProductIdentity = Boolean(
    customerIoInternalUserId || customerIoWorkshopId,
  );

  if (internalUserMatches) {
    return {
      customerIoInternalUserId,
      customerIoWorkshopId,
      kind: "user_match",
      workshopBucketAllowed: Boolean(candidate.workshopId),
    };
  }

  if (workshopMatches) {
    return {
      customerIoInternalUserId,
      customerIoWorkshopId,
      kind: "workshop_match",
      workshopBucketAllowed: true,
    };
  }

  if (!hasProductIdentity) {
    return {
      customerIoInternalUserId,
      customerIoWorkshopId,
      kind: "non_product_contact",
      workshopBucketAllowed: false,
    };
  }

  return {
    customerIoInternalUserId,
    customerIoWorkshopId,
    kind: "mismatch",
    workshopBucketAllowed: false,
  };
}

function asString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function asInteger(value: unknown) {
  return Math.round(asNumber(value));
}

function asBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function parseIso(value: unknown) {
  const next = asString(value);
  if (!next) {
    return null;
  }

  const date = new Date(next);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNullableIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function parseTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const next = value > 1_000_000_000_000 ? value : value * 1000;
    return toNullableIso(new Date(next));
  }

  const next = asString(value);
  if (!next) {
    return null;
  }

  if (/^\d+$/.test(next)) {
    const numeric = Number(next);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    const milliseconds =
      numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return toNullableIso(new Date(milliseconds));
  }

  return toNullableIso(parseIso(next));
}

function dayPeriod(date: Date) {
  const start = startOfUtcDay(date);
  return {
    start,
    end: addUtcDays(start, 1),
  };
}

function hashEmail(email?: string | null) {
  const normalized = asString(email)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex");
}

function emailDomain(email?: string | null) {
  const normalized = asString(email)?.toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return null;
  }

  return normalized.split("@").at(-1) ?? null;
}

function latestDate(...dates: Array<Date | null>) {
  return dates
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function rolePriority(role?: string | null) {
  const normalized = role?.toLowerCase() ?? "";
  if (normalized.includes("owner")) return 4;
  if (normalized.includes("admin")) return 3;
  if (normalized.includes("manager")) return 2;
  if (normalized.length > 0) return 1;
  return 0;
}

function normalizeMonth(value?: string | null) {
  const next = asString(value);
  if (!next) {
    return null;
  }

  if (/^\d{4}-\d{2}$/.test(next)) {
    return `${next}-01`;
  }

  const parsed = parseIso(next);
  return parsed ? startOfUtcDay(parsed).toISOString().slice(0, 10) : null;
}

export function flattenNumericLeaves(
  section: string,
  value: unknown,
  path: string[] = [],
): CostLeaf[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [
      {
        amount: value,
        itemKey: path.join("."),
        section,
      },
    ];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenNumericLeaves(section, item, [...path, String(index)]),
    );
  }

  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nextValue]) =>
      flattenNumericLeaves(section, nextValue, [...path, key]),
    );
  }

  return [];
}

function costUnitForKey(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.includes("rate")) return "percent";
  if (normalized.includes("cost")) return "currency";
  return "count";
}

function stableDimensionsKey(
  dimensions?: Record<string, string | number | boolean | null>,
) {
  if (!dimensions) {
    return "";
  }

  return JSON.stringify(
    Object.entries(dimensions).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function safeMetadataRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  iteratee: (item: T, index: number) => Promise<TResult>,
) {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<TResult>(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await iteratee(items[currentIndex]!, currentIndex);
      }
    }),
  );

  return results;
}

function consistentStringValue(values: Array<string | null>) {
  const distinct = [...new Set(values.filter((value): value is string => Boolean(value)))];

  if (distinct.length === 0) {
    return { conflict: false, value: null };
  }

  if (distinct.length === 1) {
    return { conflict: false, value: distinct[0] };
  }

  return { conflict: true, value: null };
}

async function buildCustomerIoEnrichment(
  rows: UserStatsRecord[],
): Promise<CoreAppCustomerIoEnrichment> {
  if (!hasCustomerIoAppConfig()) {
    return {
      summary: {
        enabled: false,
        reason: "missing_customer_io_app_api_key",
      },
      usersByInternalUserId: new Map(),
      workshopsByWorkshopId: new Map(),
    };
  }

  const candidates = rows
    .map((row) => ({
      email: normalizeEmail(row.email),
      internalUserId: asString(row.user_id),
      workshopId: asString(row.workshop_id),
    }))
    .filter(
      (
        row,
      ): row is {
        email: string;
        internalUserId: string;
        workshopId: string | null;
      } => Boolean(row.email && row.internalUserId),
    );

  const results = await mapWithConcurrency(candidates, 5, async (candidate) => {
    try {
      const lookup = await findCustomerIoProfileByEmail(candidate.email);
      if (!lookup) {
        return { candidate, kind: "missing" as const };
      }

      const attributes = await fetchCustomerIoProfileAttributes(lookup.profileId);
      const classification = classifyCustomerIoProfile(candidate, attributes);

      if (classification.kind === "mismatch") {
        return {
          attributes,
          candidate,
          kind: "mismatch" as const,
          classification,
          lookup,
        };
      }

      if (classification.kind === "non_product_contact") {
        return {
          attributes,
          candidate,
          kind: "non_product_contact" as const,
          classification,
          lookup,
        };
      }

      return {
        attributes,
        candidate,
        kind: "matched" as const,
        classification,
        lookup,
      };
    } catch (error) {
      return {
        candidate,
        error:
          error instanceof Error
            ? error.message
            : "Unknown Customer.io enrichment error",
        kind: "error" as const,
      };
    }
  });

  const usersByInternalUserId = new Map<string, CustomerIoUserEnrichment>();
  const workshopBuckets = new Map<
    string,
    {
      countries: Array<string | null>;
      matchedUsers: number;
      stripeCustomerIds: Array<string | null>;
      subscriptionStatuses: Array<string | null>;
    }
  >();

  let matched = 0;
  let mismatched = 0;
  let missing = 0;
  let errors = 0;
  let createdAtMatches = 0;
  let nonProductContacts = 0;
  let stripeCustomerIdMatches = 0;
  let subscriptionStatusMatches = 0;
  let userMatches = 0;
  let workshopOnlyMatches = 0;

  for (const result of results) {
    if (result.kind === "error") {
      errors += 1;
      continue;
    }

    if (result.kind === "missing") {
      missing += 1;
      continue;
    }

    if (result.kind === "mismatch") {
      mismatched += 1;
      continue;
    }

    if (result.kind === "non_product_contact") {
      nonProductContacts += 1;
      continue;
    }

    matched += 1;

    const createdAt = parseTimestamp(result.attributes.created_at);
    const country = asString(result.attributes.country);
    const stripeCustomerId = asString(result.attributes.stripe_customer_id);
    const subscriptionStatus = asString(result.attributes.subscription_status);
    const customerIoWorkshopId = result.classification.customerIoWorkshopId;

    if (createdAt) createdAtMatches += 1;
    if (stripeCustomerId) stripeCustomerIdMatches += 1;
    if (subscriptionStatus) subscriptionStatusMatches += 1;

    if (result.classification.kind === "user_match") {
      userMatches += 1;
      usersByInternalUserId.set(result.candidate.internalUserId, {
        country,
        createdAt,
        customerIoId:
          asString(result.attributes.cio_id) ?? result.lookup.customerIoId,
        customerIoProfileId: result.lookup.profileId,
        customerIoWorkshopId,
        matchType: "id",
        stripeCustomerId,
        subscriptionStatus,
      });
    } else {
      workshopOnlyMatches += 1;
    }

    if (result.candidate.workshopId && result.classification.workshopBucketAllowed) {
      const bucket = workshopBuckets.get(result.candidate.workshopId) ?? {
        countries: [],
        matchedUsers: 0,
        stripeCustomerIds: [],
        subscriptionStatuses: [],
      };

      bucket.matchedUsers += 1;
      bucket.countries.push(country);
      bucket.stripeCustomerIds.push(stripeCustomerId);
      bucket.subscriptionStatuses.push(subscriptionStatus);
      workshopBuckets.set(result.candidate.workshopId, bucket);
    }
  }

  const workshopsByWorkshopId = new Map<string, CustomerIoWorkshopEnrichment>();

  for (const [workshopId, bucket] of workshopBuckets.entries()) {
    const country = consistentStringValue(bucket.countries);
    const stripeCustomerId = consistentStringValue(bucket.stripeCustomerIds);
    const subscriptionStatus = consistentStringValue(bucket.subscriptionStatuses);

    workshopsByWorkshopId.set(workshopId, {
      country: country.value,
      countryConflict: country.conflict,
      matchedUsers: bucket.matchedUsers,
      stripeCustomerId: stripeCustomerId.value,
      stripeCustomerIdConflict: stripeCustomerId.conflict,
      subscriptionStatus: subscriptionStatus.value,
      subscriptionStatusConflict: subscriptionStatus.conflict,
    });
  }

  return {
    summary: {
      created_at_matches: createdAtMatches,
      enabled: true,
      errors,
      matched,
      missing,
      mismatched,
      non_product_contacts: nonProductContacts,
      stripe_customer_id_matches: stripeCustomerIdMatches,
      subscription_status_matches: subscriptionStatusMatches,
      attempted: candidates.length,
      user_matches: userMatches,
      workshop_only_matches: workshopOnlyMatches,
      workshop_matches: workshopsByWorkshopId.size,
    },
    usersByInternalUserId,
    workshopsByWorkshopId,
  };
}

function stripeStatusPriority(status: string) {
  switch (status.trim().toLowerCase()) {
    case "active":
      return 0;
    case "trialing":
      return 1;
    case "paused":
      return 2;
    case "past_due":
      return 3;
    case "unpaid":
      return 4;
    case "incomplete":
      return 5;
    case "incomplete_expired":
      return 6;
    case "canceled":
      return 7;
    default:
      return 20;
  }
}

function pickPreferredStripeEnrichment<T extends StripeUserEnrichment>(
  current: T | null,
  candidate: T,
) {
  if (!current) {
    return candidate;
  }

  const statusDelta =
    stripeStatusPriority(candidate.subscriptionStatus) -
    stripeStatusPriority(current.subscriptionStatus);

  if (statusDelta < 0) {
    return candidate;
  }

  if (statusDelta > 0) {
    return current;
  }

  return (
    [candidate, current].sort((left, right) =>
      (right.subscriptionCreatedAt ?? "").localeCompare(
        left.subscriptionCreatedAt ?? "",
      ),
    )[0] ?? current
  );
}

async function buildStripeEnrichment(
  rows: UserStatsRecord[],
): Promise<CoreAppStripeEnrichment> {
  if (!getEnv("STRIPE_SECRET_KEY")) {
    return {
      summary: {
        enabled: false,
        reason: "missing_stripe_secret_key",
      },
      usersByInternalUserId: new Map(),
      workshopsByWorkshopId: new Map(),
    };
  }

  const userStatsLookup = buildUserStatsEmailLookup(rows);
  const knownWorkshopIds = new Set(
    rows
      .map((row) => asString(row.workshop_id))
      .filter((value): value is string => Boolean(value)),
  );
  const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY")!);
  const subscriptions = await listSubscriptions(stripe);
  const stripeCustomerIdsByEmail = new Map<string, Set<string>>();

  for (const subscription of subscriptions) {
    const customer =
      typeof subscription.customer === "string" ? null : subscription.customer;
    const email =
      customer && !customer.deleted ? normalizeEmail(customer.email) : null;

    if (!email || !customer || customer.deleted) {
      continue;
    }

    const current = stripeCustomerIdsByEmail.get(email) ?? new Set<string>();
    current.add(customer.id);
    stripeCustomerIdsByEmail.set(email, current);
  }

  const usersByInternalUserId = new Map<string, StripeUserEnrichment>();
  const workshopsByWorkshopId = new Map<string, StripeWorkshopEnrichment>();
  let matchedUsers = 0;
  let matchedWorkshops = 0;
  let matchedByCoreStripeSubscriptionId = 0;
  let matchedByCoreStripeCustomerId = 0;
  let matchedByCustomerMetadata = 0;
  let matchedByEmail = 0;
  let matchedBySubscriptionMetadata = 0;

  for (const subscription of subscriptions) {
    const customer =
      typeof subscription.customer === "string" ? null : subscription.customer;
    const email =
      customer && !customer.deleted ? normalizeEmail(customer.email) : null;
    const customerStripeId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.deleted
          ? null
          : subscription.customer.id;
    // Highest-confidence joins: the IDs the core_app export ships
    // alongside each user_stats row.
    const coreStripeSubscriptionMatch =
      !userStatsLookup.ambiguousCoreStripeSubscriptionIds.has(subscription.id)
        ? userStatsLookup.byCoreStripeSubscriptionId.get(subscription.id) ?? null
        : null;
    const coreStripeCustomerMatch =
      !coreStripeSubscriptionMatch &&
      customerStripeId &&
      !userStatsLookup.ambiguousCoreStripeCustomerIds.has(customerStripeId)
        ? userStatsLookup.byCoreStripeCustomerId.get(customerStripeId) ?? null
        : null;
    const idIdentity = coreStripeSubscriptionMatch ?? coreStripeCustomerMatch;
    const idWorkshopId = idIdentity?.workshopId ?? null;
    const idMatchedWorkshopId =
      idWorkshopId && knownWorkshopIds.has(idWorkshopId) ? idWorkshopId : null;

    const emailIdentity =
      !idIdentity &&
      email &&
      !userStatsLookup.ambiguousEmails.has(email)
        ? userStatsLookup.byEmail.get(email) ?? null
        : null;
    const emailCanMatch =
      Boolean(emailIdentity) &&
      Boolean(email) &&
      (stripeCustomerIdsByEmail.get(email!)?.size ?? 0) === 1;
    const subscriptionMetadataWorkshopId =
      subscription.metadata.workshop_id ??
      subscription.metadata.internal_workshop_id ??
      null;
    const customerMetadataWorkshopId =
      customer && !customer.deleted
        ? customer.metadata.workshop_id ??
          customer.metadata.internal_workshop_id ??
          null
        : null;
    const subscriptionMetadataWorkshopMatch =
      subscriptionMetadataWorkshopId &&
      knownWorkshopIds.has(subscriptionMetadataWorkshopId)
        ? subscriptionMetadataWorkshopId
        : null;
    const customerMetadataWorkshopMatch =
      customerMetadataWorkshopId && knownWorkshopIds.has(customerMetadataWorkshopId)
        ? customerMetadataWorkshopId
        : null;
    const workshopId =
      idMatchedWorkshopId ??
      subscriptionMetadataWorkshopMatch ??
      customerMetadataWorkshopMatch ??
      (emailCanMatch ? emailIdentity?.workshopId ?? null : null);
    const userId =
      idIdentity?.internalUserId ??
      (emailCanMatch ? emailIdentity?.internalUserId ?? null : null);
    const matchType: StripeUserEnrichment["matchType"] | null =
      coreStripeSubscriptionMatch && (idMatchedWorkshopId || idIdentity?.internalUserId)
        ? "core_stripe_subscription_id"
        : coreStripeCustomerMatch && (idMatchedWorkshopId || idIdentity?.internalUserId)
          ? "core_stripe_customer_id"
          : subscriptionMetadataWorkshopId && workshopId
            ? "subscription_metadata"
            : customerMetadataWorkshopId && workshopId
              ? "customer_metadata"
              : emailCanMatch
                ? "customer_email"
                : null;

    if (!matchType) {
      continue;
    }

    if (matchType === "core_stripe_subscription_id") {
      matchedByCoreStripeSubscriptionId += 1;
    } else if (matchType === "core_stripe_customer_id") {
      matchedByCoreStripeCustomerId += 1;
    } else if (matchType === "subscription_metadata") {
      matchedBySubscriptionMetadata += 1;
    } else if (matchType === "customer_metadata") {
      matchedByCustomerMetadata += 1;
    } else {
      matchedByEmail += 1;
    }

    const period = subscriptionPeriod(subscription);
    const candidate = {
      customerCreatedAt:
        customer && !customer.deleted ? unixToIso(customer.created) : null,
      customerEmail: email,
      customerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.deleted
            ? null
            : subscription.customer.id,
      matchType,
      subscriptionCreatedAt: unixToIso(subscription.created),
      subscriptionCurrentPeriodEnd: unixToIso(period.end),
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    } satisfies StripeUserEnrichment;

    if (userId) {
      const next = pickPreferredStripeEnrichment(
        usersByInternalUserId.get(userId) ?? null,
        candidate,
      );

      if (next !== usersByInternalUserId.get(userId)) {
        usersByInternalUserId.set(userId, next);
      }
    }

    if (workshopId) {
      const next = pickPreferredStripeEnrichment(
        workshopsByWorkshopId.get(workshopId) ?? null,
        candidate,
      );

      if (next !== workshopsByWorkshopId.get(workshopId)) {
        workshopsByWorkshopId.set(workshopId, next);
      }
    }
  }

  matchedUsers = usersByInternalUserId.size;
  matchedWorkshops = workshopsByWorkshopId.size;

  return {
    summary: {
      enabled: true,
      matched_by_core_stripe_customer_id: matchedByCoreStripeCustomerId,
      matched_by_core_stripe_subscription_id: matchedByCoreStripeSubscriptionId,
      matched_by_customer_metadata: matchedByCustomerMetadata,
      matched_by_email: matchedByEmail,
      matched_by_subscription_metadata: matchedBySubscriptionMetadata,
      matched_users: matchedUsers,
      matched_workshops: matchedWorkshops,
      subscriptions_seen: subscriptions.length,
    },
    usersByInternalUserId,
    workshopsByWorkshopId,
  };
}

export type SignedUpAtSource =
  | "core_app_user"
  | "core_app_workshop"
  | "customer_io"
  | "stripe";

// Priority chain for the canonical signup timestamp. Order matters:
//   1. user_created_at — first-party WL-app DB
//   2. created_at — legacy alias of (1), still present in some exports
//   3. workshop_created_at — fallback for the gap where the S3 export ships
//      a brand-new owner with NULL user-level created_at but a valid
//      workshop_created_at on the same row. Caught us on 2026-05-11 when
//      Cusmat + Autostar fell out of the Sign-ups chart entirely.
//   4. customer_io_created_at — first time CIO saw them
//   5. stripe_customer_created_at — first time Stripe saw them
//
// Whichever fires gets stamped on metadata.signed_up_at_source so the
// /ceo/new-users coverage breakdown can attribute each user. Changing the
// chain (adding a new source, reordering) is a one-place edit here.
export function deriveSignedUpAt(
  row: UserStatsRecord,
  customerIoEnrichment: CustomerIoUserEnrichment | null,
  stripeEnrichment: StripeUserEnrichment | null,
): { at: string | null; source: SignedUpAtSource | null } {
  const userCreated = toNullableIso(
    parseIso(row.user_created_at) ?? parseIso(row.created_at),
  );
  if (userCreated) return { at: userCreated, source: "core_app_user" };

  const workshopCreated = toNullableIso(parseIso(row.workshop_created_at));
  if (workshopCreated) return { at: workshopCreated, source: "core_app_workshop" };

  if (customerIoEnrichment?.createdAt) {
    return { at: customerIoEnrichment.createdAt, source: "customer_io" };
  }

  if (stripeEnrichment?.customerCreatedAt) {
    return { at: stripeEnrichment.customerCreatedAt, source: "stripe" };
  }

  return { at: null, source: null };
}

export function buildUserRows(
  rows: UserStatsRecord[],
  customerIoEnrichmentByUserId = new Map<string, CustomerIoUserEnrichment>(),
  stripeEnrichmentByUserId = new Map<string, StripeUserEnrichment>(),
): UserRow[] {
  const mappedRows: Array<UserRow | null> = rows.map((row) => {
    const internalUserId = asString(row.user_id);
    if (!internalUserId) {
      return null;
    }

    const customerIoEnrichment =
      customerIoEnrichmentByUserId.get(internalUserId) ?? null;
    const stripeEnrichment = stripeEnrichmentByUserId.get(internalUserId) ?? null;

    const lastSeenAt = latestDate(
      parseIso(row.last_active),
      parseIso(row.last_login),
    );
    const canonicalCreatedAt = toNullableIso(
      parseIso(row.user_created_at) ?? parseIso(row.created_at),
    );
    const signedUpAt = deriveSignedUpAt(
      row,
      customerIoEnrichment,
      stripeEnrichment,
    );
    const coreStripeCustomerId = asString(row.stripe_customer_id);

    return {
      internal_user_id: internalUserId,
      workshop_id: asString(row.workshop_id),
      email_hash: hashEmail(row.email),
      customer_io_id: customerIoEnrichment?.customerIoId ?? null,
      ga_client_id: null,
      created_at: canonicalCreatedAt,
      signed_up_at: signedUpAt.at,
      last_seen_at: toNullableIso(lastSeenAt),
      name: asString(row.name),
      phone: asString(row.phone),
      core_stripe_customer_id: coreStripeCustomerId,
      metadata: safeMetadataRecord({
        company_name: asString(row.company_name),
        credits_remaining: asNumber(row.credits_remaining),
        customer_io_country: customerIoEnrichment?.country,
        customer_io_created_at: customerIoEnrichment?.createdAt,
        customer_io_match_type: customerIoEnrichment?.matchType,
        customer_io_profile_id: customerIoEnrichment?.customerIoProfileId,
        customer_io_stripe_customer_id: customerIoEnrichment?.stripeCustomerId,
        customer_io_subscription_status:
          customerIoEnrichment?.subscriptionStatus,
        customer_io_workshop_id: customerIoEnrichment?.customerIoWorkshopId,
        email_domain: emailDomain(row.email),
        login_count: asInteger(row.login_count),
        plan_type: asString(row.plan_type),
        signed_up_at_source: signedUpAt.source,
        stripe_customer_created_at: stripeEnrichment?.customerCreatedAt,
        stripe_customer_email: stripeEnrichment?.customerEmail,
        stripe_customer_id: stripeEnrichment?.customerId ?? null,
        stripe_match_type: stripeEnrichment?.matchType,
        stripe_subscription_created_at: stripeEnrichment?.subscriptionCreatedAt,
        stripe_subscription_current_period_end:
          stripeEnrichment?.subscriptionCurrentPeriodEnd,
        stripe_subscription_id: stripeEnrichment?.subscriptionId,
        stripe_subscription_status: stripeEnrichment?.subscriptionStatus,
        subscription_status: stripeEnrichment?.subscriptionStatus ?? null,
        subscription_status_source: stripeEnrichment ? "stripe" : null,
        user_created_at_source: canonicalCreatedAt ? "core_app" : null,
        user_role: asString(row.user_role),
        username: asString(row.username),
      }),
    };
  });

  return mappedRows.filter((row): row is UserRow => row !== null);
}

export function buildWorkshopRows(
  rows: UserStatsRecord[],
  customerIoEnrichmentByWorkshopId = new Map<
    string,
    CustomerIoWorkshopEnrichment
  >(),
  stripeEnrichmentByWorkshopId = new Map<string, StripeWorkshopEnrichment>(),
): WorkshopRow[] {
  const grouped = new Map<string, UserStatsRecord[]>();

  for (const row of rows) {
    const workshopId = asString(row.workshop_id);
    if (!workshopId) continue;

    const current = grouped.get(workshopId) ?? [];
    current.push(row);
    grouped.set(workshopId, current);
  }

  return [...grouped.entries()].map(([workshopId, members]) => {
    const customerIoEnrichment =
      customerIoEnrichmentByWorkshopId.get(workshopId) ?? null;
    const stripeEnrichment =
      stripeEnrichmentByWorkshopId.get(workshopId) ?? null;
    const owner =
      [...members].sort(
        (left, right) => rolePriority(right.user_role) - rolePriority(left.user_role),
      )[0] ?? members[0];
    const lastActivity = members
      .map((member) => latestDate(parseIso(member.last_active), parseIso(member.last_login)))
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const canonicalCountry = consistentStringValue(
      members.map((member) => asString(member.country)),
    );
    const canonicalCreatedAt = members
      .map((member) => parseIso(member.workshop_created_at))
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    const canonicalActivatedAt = members
      .map((member) => parseIso(member.workshop_activated_at))
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    const canonicalLanguage = consistentStringValue(
      members.map((member) => asString(member.language)),
    );
    // The owner row carries the workshop-level extended fields. Workshop
    // members share the same workshop, so prefer the owner's record but
    // fall back to the first non-null value across members for resilience.
    const firstDefined = <T,>(getter: (m: UserStatsRecord) => T | null) => {
      const ownerValue = getter(owner);
      if (ownerValue !== null && ownerValue !== undefined) return ownerValue;
      for (const member of members) {
        const value = getter(member);
        if (value !== null && value !== undefined) return value;
      }
      return null;
    };
    const coreSubscriptionStatus = firstDefined((m) =>
      asString(m.subscription_status),
    );
    const paymentStatus = firstDefined((m) => asString(m.payment_status));
    const trialEnd = members
      .map((member) => parseIso(member.trial_end))
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const createdByAgent = (() => {
      const value = firstDefined((m) => m.created_by_agent ?? null);
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true" || lower === "1" || lower === "yes") return true;
        if (lower === "false" || lower === "0" || lower === "no") return false;
      }
      return null;
    })();
    const coreStripeCustomerId = firstDefined((m) =>
      asString(m.stripe_customer_id),
    );
    const coreStripeSubscriptionId = firstDefined((m) =>
      asString(m.stripe_subscription_id),
    );

    return {
      workshop_id: workshopId,
      name: asString(owner.company_name),
      owner_internal_user_id: asString(owner.user_id),
      country: canonicalCountry.value,
      plan_key: asString(owner.plan_type),
      activated_at: toNullableIso(canonicalActivatedAt),
      created_at: toNullableIso(canonicalCreatedAt),
      language: canonicalLanguage.value,
      core_subscription_status: coreSubscriptionStatus,
      payment_status: paymentStatus,
      trial_end: toNullableIso(trialEnd),
      created_by_agent: createdByAgent,
      core_stripe_customer_id: coreStripeCustomerId,
      core_stripe_subscription_id: coreStripeSubscriptionId,
      metadata: safeMetadataRecord({
        credits_remaining_max: Math.max(
          ...members.map((member) => asNumber(member.credits_remaining)),
        ),
        customer_io_country: customerIoEnrichment?.country,
        customer_io_country_conflict: customerIoEnrichment?.countryConflict ?? false,
        customer_io_matched_users: customerIoEnrichment?.matchedUsers,
        customer_io_stripe_customer_id: customerIoEnrichment?.stripeCustomerId,
        customer_io_stripe_customer_id_conflict:
          customerIoEnrichment?.stripeCustomerIdConflict ?? false,
        customer_io_subscription_status:
          customerIoEnrichment?.subscriptionStatus,
        customer_io_subscription_status_conflict:
          customerIoEnrichment?.subscriptionStatusConflict ?? false,
        email_domains: [...new Set(members.map((member) => emailDomain(member.email)).filter(Boolean))],
        member_count: members.length,
        plan_types: [...new Set(members.map((member) => asString(member.plan_type)).filter(Boolean))],
        roles: [...new Set(members.map((member) => asString(member.user_role)).filter(Boolean))],
        stripe_customer_created_at: stripeEnrichment?.customerCreatedAt,
        stripe_customer_email: stripeEnrichment?.customerEmail,
        stripe_customer_id: stripeEnrichment?.customerId ?? null,
        stripe_match_type: stripeEnrichment?.matchType,
        stripe_subscription_created_at: stripeEnrichment?.subscriptionCreatedAt,
        stripe_subscription_current_period_end:
          stripeEnrichment?.subscriptionCurrentPeriodEnd,
        stripe_subscription_id: stripeEnrichment?.subscriptionId,
        stripe_subscription_status: stripeEnrichment?.subscriptionStatus,
        subscription_status: stripeEnrichment?.subscriptionStatus ?? null,
        subscription_status_source: stripeEnrichment ? "stripe" : null,
        workshop_activated_at_source: canonicalActivatedAt ? "core_app" : null,
        workshop_created_at_source: canonicalCreatedAt ? "core_app" : null,
        usernames: members
          .map((member) => asString(member.username))
          .filter(Boolean)
          .slice(0, 20),
        last_activity_at: toNullableIso(lastActivity),
      }),
    };
  });
}

export function buildDiagnosticsRows(
  rows: DiagnosticRecord[],
  workshopIdByUserId: Map<string, string>,
) {
  return rows
    .map((row) => {
      const diagnosticId = asString(row.diagnostics_id);
      if (!diagnosticId) {
        return null;
      }

      const internalUserId = asString(row.user_id);
      return {
        diagnostic_id: diagnosticId,
        workshop_id: internalUserId ? (workshopIdByUserId.get(internalUserId) ?? null) : null,
        internal_user_id: internalUserId,
        parent_diagnostic_id: asString(row.parent_diagnostics_id),
        status: asString(row.status),
        created_at: toNullableIso(parseIso(row.created_at)),
        completed_at: toNullableIso(parseIso(row.completed_at)),
        analyzed_at: toNullableIso(parseIso(row.analyzed_at)),
        ai_model: asString(row.ai_model),
        diag_cost: asNumber(row.diag_cost),
        input_tokens: asInteger(row.input_tokens),
        output_tokens: asInteger(row.output_tokens),
        num_causes: asInteger(row.num_causes),
        has_chat: asBoolean(row.has_chat),
        has_invoice: asBoolean(row.has_invoice),
        metadata: safeMetadataRecord({
          car_make: asString(row.car_make),
          car_model: asString(row.car_model),
          car_year: asInteger(row.car_year),
          description: asString(row.description),
          dtcs: row.dtcs,
          internal_error_codes: row.internal_error_codes,
          possible_causes: row.possible_causes,
          repair_procedures_viewed: row.repair_procedures_viewed,
          symptoms: row.symptoms,
          updated_at: asString(row.updated_at),
          user_actions: row.user_actions,
        }),
      };
    })
    .filter((row): row is DiagnosticRow => Boolean(row));
}

export function buildDiagnosticChatRows(
  rows: DiagnosticChatRecord[],
  workshopIdByUserId: Map<string, string>,
) {
  return rows
    .map((row) => {
      const chatId = asString(row.chat_id);
      if (!chatId) {
        return null;
      }

      const internalUserId = asString(row.user_id);
      return {
        chat_id: chatId,
        diagnostic_id: asString(row.diagnostics_id),
        workshop_id: internalUserId ? (workshopIdByUserId.get(internalUserId) ?? null) : null,
        internal_user_id: internalUserId,
        created_at: toNullableIso(parseIso(row.created_at)),
        updated_at: toNullableIso(parseIso(row.updated_at)),
        message_count: asInteger(row.message_count),
        chat_cost: asNumber(row.chat_cost),
        total_input_tokens: asInteger(row.total_input_tokens),
        total_output_tokens: asInteger(row.total_output_tokens),
        total_thinking_tokens: asInteger(row.total_thinking_tokens),
        metadata: safeMetadataRecord({
          messages: row.messages,
          models_used: row.models_used,
        }),
      };
    })
    .filter((row): row is DiagnosticChatRow => Boolean(row));
}

export function buildMotorUsageRows(rows: MotorUsageRecord[]) {
  return rows
    .map((row) => {
      const month = normalizeMonth(row.month);
      const databaseName = asString(row.database);
      if (!month && !databaseName) {
        return null;
      }

      return {
        motor_usage_id: `${databaseName ?? "all"}:${month ?? "unknown"}`,
        month,
        database_name: databaseName,
        total_accesses: asInteger(row.total_accesses),
        unique_users: asInteger(row.unique_users),
        unique_vehicles: asInteger(row.unique_vehicles),
        metadata: {},
      };
    })
    .filter((row): row is MotorUsageRow => Boolean(row));
}

export function buildCostEntryRows(
  payload: CostAnalysisPayload,
  snapshotAt: Date,
) {
  return Object.entries(payload).flatMap(([section, value]) =>
    flattenNumericLeaves(section, value).map((leaf) => ({
      cost_entry_id: `${section}:${leaf.itemKey || "root"}`,
      section,
      item_key: leaf.itemKey || "root",
      amount: leaf.amount,
      unit: costUnitForKey(leaf.itemKey),
      snapshot_at: snapshotAt.toISOString(),
      metadata: {},
    })),
  ) satisfies CostEntryRow[];
}

function buildWorkshopIdByUserId(rows: UserStatsRecord[]) {
  return new Map(
    rows
      .map((row) => [asString(row.user_id), asString(row.workshop_id)] as const)
      .filter(
        (entry): entry is [string, string] => Boolean(entry[0] && entry[1]),
      ),
  );
}

function countUniqueWorkshops(rows: UserStatsRecord[]) {
  return new Set(rows.map((row) => asString(row.workshop_id)).filter(Boolean)).size;
}

function buildUserStatsMetrics(
  rows: UserStatsRecord[],
  snapshotAt: Date,
): MetricPoint[] {
  const period = dayPeriod(snapshotAt);

  return [
    {
      sourceKey: "core_app",
      metricKey: "core_users",
      periodStart: period.start,
      periodEnd: period.end,
      value: rows.length,
    },
    {
      sourceKey: "core_app",
      metricKey: "core_workshops",
      periodStart: period.start,
      periodEnd: period.end,
      value: countUniqueWorkshops(rows),
    },
  ];
}

function buildDiagnosticsMetrics(
  rows: DiagnosticRecord[],
  workshopIdByUserId: Map<string, string>,
  internalTestSets: InternalTestSets,
): MetricPoint[] {
  const metrics: MetricPoint[] = [];

  for (const row of rows) {
    const internalUserId = asString(row.user_id);
    if (
      isInternalTestUserOrWorkshopWith(
        internalTestSets,
        row.user_id,
        internalUserId ? workshopIdByUserId.get(internalUserId) : undefined,
      )
    ) {
      continue;
    }

    const createdAt = parseIso(row.created_at);
    if (createdAt) {
      const period = dayPeriod(createdAt);
      metrics.push(
        {
          sourceKey: "core_app",
          metricKey: "core_diagnostics_created",
          periodStart: period.start,
          periodEnd: period.end,
          value: 1,
        },
        {
          sourceKey: "core_app",
          metricKey: "core_diagnostic_cost",
          periodStart: period.start,
          periodEnd: period.end,
          value: asNumber(row.diag_cost),
          unit: "currency",
          currency: "USD",
        },
      );
    }

    const completedAt = parseIso(row.completed_at);
    if (completedAt) {
      const period = dayPeriod(completedAt);
      metrics.push({
        sourceKey: "core_app",
        metricKey: "core_diagnostics_completed",
        periodStart: period.start,
        periodEnd: period.end,
        value: 1,
      });
    }
  }

  return metrics;
}

function buildDiagnosticChatMetrics(
  rows: DiagnosticChatRecord[],
  workshopIdByUserId: Map<string, string>,
  internalTestSets: InternalTestSets,
): MetricPoint[] {
  const metrics: MetricPoint[] = [];

  for (const row of rows) {
    const internalUserId = asString(row.user_id);
    if (
      isInternalTestUserOrWorkshopWith(
        internalTestSets,
        row.user_id,
        internalUserId ? workshopIdByUserId.get(internalUserId) : undefined,
      )
    ) {
      continue;
    }

    const createdAt = parseIso(row.created_at);
    if (!createdAt) continue;

    const period = dayPeriod(createdAt);
    metrics.push(
      {
        sourceKey: "core_app",
        metricKey: "core_diagnostic_chats",
        periodStart: period.start,
        periodEnd: period.end,
        value: 1,
      },
      {
        sourceKey: "core_app",
        metricKey: "core_chat_cost",
        periodStart: period.start,
        periodEnd: period.end,
        value: asNumber(row.chat_cost),
        unit: "currency",
        currency: "USD",
      },
      {
        sourceKey: "core_app",
        metricKey: "core_chat_messages",
        periodStart: period.start,
        periodEnd: period.end,
        value: asInteger(row.message_count),
      },
    );
  }

  return metrics;
}

function buildMotorUsageMetrics(rows: MotorUsageRecord[]): MetricPoint[] {
  const metrics: MetricPoint[] = [];

  for (const row of rows) {
    const month = normalizeMonth(row.month);
    if (!month) continue;

    const periodStart = new Date(`${month}T00:00:00.000Z`);
    const periodEnd = new Date(
      Date.UTC(
        periodStart.getUTCFullYear(),
        periodStart.getUTCMonth() + 1,
        1,
      ),
    );
    const dimensions = { database: asString(row.database) ?? "all" };

    metrics.push(
      {
        sourceKey: "core_app",
        metricKey: "core_motor_accesses",
        periodStart,
        periodEnd,
        value: asInteger(row.total_accesses),
        dimensions,
      },
      {
        sourceKey: "core_app",
        metricKey: "core_motor_unique_users",
        periodStart,
        periodEnd,
        value: asInteger(row.unique_users),
        dimensions,
      },
      {
        sourceKey: "core_app",
        metricKey: "core_motor_unique_vehicles",
        periodStart,
        periodEnd,
        value: asInteger(row.unique_vehicles),
        dimensions,
      },
    );
  }

  return metrics;
}

function readNumericPath(object: Record<string, unknown>, path: string[]) {
  let current: unknown = object;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "number" ? current : null;
}

function buildCostMetrics(payload: CostAnalysisPayload, snapshotAt: Date): MetricPoint[] {
  const period = dayPeriod(snapshotAt);
  const totals = [
    ["core_ai_total_cost", readNumericPath(payload, ["combined", "total_cost"])],
    [
      "core_ai_diagnostics_total_cost",
      readNumericPath(payload, ["diagnostics", "total_cost"]),
    ],
    ["core_ai_chat_total_cost", readNumericPath(payload, ["chats", "total_cost"])],
    [
      "core_ai_chat_adoption_rate",
      readNumericPath(payload, ["combined", "chat_adoption_rate"]),
    ],
  ] as const;

  return totals
    .filter(([, value]) => value !== null)
    .map(([metricKey, value]) => ({
      sourceKey: "core_app" as const,
      metricKey,
      periodStart: period.start,
      periodEnd: period.end,
      value: Number(value),
      unit: metricKey.includes("rate") ? "percent" : metricKey.includes("cost") ? "currency" : "count",
      currency: metricKey.includes("cost") ? "USD" : null,
    }));
}

export function aggregateMetricPoints(points: MetricPoint[]): MetricPoint[] {
  const aggregated = new Map<string, MetricPoint>();

  for (const point of points) {
    const key = [
      point.sourceKey,
      point.metricKey,
      point.periodStart.toISOString(),
      point.periodEnd.toISOString(),
      point.unit ?? "count",
      point.currency ?? "",
      stableDimensionsKey(point.dimensions),
    ].join("|");

    const existing = aggregated.get(key);
    if (existing) {
      existing.value += point.value;
      continue;
    }

    aggregated.set(key, {
      ...point,
      dimensions: point.dimensions ? { ...point.dimensions } : undefined,
    });
  }

  return [...aggregated.values()];
}

function buildRawRows<T extends Record<string, unknown>>(
  sourceKey: CoreAppFileKey,
  rows: T[],
  fallbackDate: Date,
  externalId: (row: T, index: number) => string,
  rowDate?: (row: T) => Date | null,
): RawMetricRow[] {
  return rows.map((row, index) => {
    const periodStart = rowDate?.(row) ?? fallbackDate;
    const period = dayPeriod(periodStart);

    return {
      sourceKey: "core_app",
      externalId: `${sourceKey}:${externalId(row, index)}`,
      periodStart: period.start,
      periodEnd: period.end,
      payload: row,
    };
  });
}

function buildCostRawRow(payload: CostAnalysisPayload, snapshotAt: Date): RawMetricRow {
  const period = dayPeriod(snapshotAt);

  return {
    sourceKey: "core_app",
    externalId: "cost_analysis:snapshot",
    periodStart: period.start,
    periodEnd: period.end,
    payload,
  };
}

export const coreAppConnector: SourceConnector = {
  sourceKey: "core_app",
  async fetchMetrics(window: SourceSyncWindow) {
    void window;

    requireSourceEnv("Core App Data", [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
      "DATA_BUCKET",
    ]);

    const client = createCoreAppS3Client();
    const [
      userStatsFile,
      diagnosticsFile,
      diagnosticChatsFile,
      motorUsageFile,
      costAnalysisFile,
    ] = await Promise.all([
      downloadCoreAppJson<UserStatsRecord[]>(client, CORE_APP_FILES.user_stats),
      downloadCoreAppJson<DiagnosticRecord[]>(client, CORE_APP_FILES.diagnostics),
      downloadCoreAppJson<DiagnosticChatRecord[]>(
        client,
        CORE_APP_FILES.diagnostics_chat,
      ),
      downloadCoreAppJson<MotorUsageRecord[]>(client, CORE_APP_FILES.motor_usage),
      downloadCoreAppJson<CostAnalysisPayload>(client, CORE_APP_FILES.cost_analysis),
    ]);

    const [customerIoEnrichment, stripeEnrichment, internalTestSets] =
      await Promise.all([
        buildCustomerIoEnrichment(userStatsFile.body),
        buildStripeEnrichment(userStatsFile.body),
        loadInternalTestSets(),
      ]);
    const workshopIdByUserId = buildWorkshopIdByUserId(userStatsFile.body);
    const users = buildUserRows(
      userStatsFile.body,
      customerIoEnrichment.usersByInternalUserId,
      stripeEnrichment.usersByInternalUserId,
    );
    const workshops = buildWorkshopRows(
      userStatsFile.body,
      customerIoEnrichment.workshopsByWorkshopId,
      stripeEnrichment.workshopsByWorkshopId,
    );
    const diagnostics = buildDiagnosticsRows(
      diagnosticsFile.body,
      workshopIdByUserId,
    );
    const diagnosticChats = buildDiagnosticChatRows(
      diagnosticChatsFile.body,
      workshopIdByUserId,
    );
    const motorUsage = buildMotorUsageRows(motorUsageFile.body);
    const costEntries = buildCostEntryRows(
      costAnalysisFile.body,
      costAnalysisFile.lastModified,
    );

    const metrics = aggregateMetricPoints([
      ...buildUserStatsMetrics(userStatsFile.body, userStatsFile.lastModified),
      ...buildDiagnosticsMetrics(
        diagnosticsFile.body,
        workshopIdByUserId,
        internalTestSets,
      ),
      ...buildDiagnosticChatMetrics(
        diagnosticChatsFile.body,
        workshopIdByUserId,
        internalTestSets,
      ),
      ...buildMotorUsageMetrics(motorUsageFile.body),
      ...buildCostMetrics(costAnalysisFile.body, costAnalysisFile.lastModified),
    ]);

    const rawRows = [
      ...buildRawRows(
        "user_stats",
        userStatsFile.body as Record<string, unknown>[],
        userStatsFile.lastModified,
        (row, index) => asString(row.user_id) ?? `row-${index}`,
      ),
      ...buildRawRows(
        "diagnostics",
        diagnosticsFile.body as Record<string, unknown>[],
        diagnosticsFile.lastModified,
        (row, index) => asString(row.diagnostics_id) ?? `row-${index}`,
        (row) => parseIso(row.created_at) ?? diagnosticsFile.lastModified,
      ),
      ...buildRawRows(
        "diagnostics_chat",
        diagnosticChatsFile.body as Record<string, unknown>[],
        diagnosticChatsFile.lastModified,
        (row, index) => asString(row.chat_id) ?? `row-${index}`,
        (row) => parseIso(row.created_at) ?? diagnosticChatsFile.lastModified,
      ),
      ...buildRawRows(
        "motor_usage",
        motorUsageFile.body as Record<string, unknown>[],
        motorUsageFile.lastModified,
        (row, index) =>
          `${asString(row.database) ?? "all"}:${normalizeMonth(asString(row.month)) ?? index}`,
        (row) =>
          normalizeMonth(asString(row.month))
            ? new Date(`${normalizeMonth(asString(row.month))}T00:00:00.000Z`)
            : motorUsageFile.lastModified,
      ),
      buildCostRawRow(costAnalysisFile.body, costAnalysisFile.lastModified),
    ];

    return {
      sourceKey: "core_app",
      rowsRead:
        userStatsFile.body.length +
        diagnosticsFile.body.length +
        diagnosticChatsFile.body.length +
        motorUsageFile.body.length +
        1,
      metrics,
      rawRows,
      users,
      workshops,
      diagnostics,
      diagnosticChats,
      motorUsage,
      costEntries,
      metadata: {
        bucket: getEnv("DATA_BUCKET"),
        customer_io_enrichment: customerIoEnrichment.summary,
        stripe_enrichment: stripeEnrichment.summary,
        files: {
          cost_analysis: {
            etag: costAnalysisFile.etag,
            key: costAnalysisFile.key,
            last_modified: costAnalysisFile.lastModified.toISOString(),
          },
          diagnostics: {
            etag: diagnosticsFile.etag,
            key: diagnosticsFile.key,
            last_modified: diagnosticsFile.lastModified.toISOString(),
          },
          diagnostics_chat: {
            etag: diagnosticChatsFile.etag,
            key: diagnosticChatsFile.key,
            last_modified: diagnosticChatsFile.lastModified.toISOString(),
          },
          motor_usage: {
            etag: motorUsageFile.etag,
            key: motorUsageFile.key,
            last_modified: motorUsageFile.lastModified.toISOString(),
          },
          user_stats: {
            etag: userStatsFile.etag,
            key: userStatsFile.key,
            last_modified: userStatsFile.lastModified.toISOString(),
          },
        },
      },
    };
  },
};
