import { gunzipSync } from "node:zlib";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "@/lib/ceo/env";

export type UserStatsEmailIdentity = {
  email: string;
  internalUserId: string;
  workshopId: string | null;
};

export type UserStatsStripeIdentity = {
  internalUserId: string | null;
  workshopId: string | null;
};

export type UserStatsEmailLookup = {
  ambiguousEmails: Set<string>;
  byEmail: Map<string, UserStatsEmailIdentity>;
  // Lookups by the core_app-supplied Stripe IDs from user_stats.json.gz.
  // These are the canonical first-party joins — when present they should be
  // preferred over email-based matching, which is lossy for renamed accounts
  // and shared mailboxes.
  ambiguousCoreStripeCustomerIds: Set<string>;
  byCoreStripeCustomerId: Map<string, UserStatsStripeIdentity>;
  ambiguousCoreStripeSubscriptionIds: Set<string>;
  byCoreStripeSubscriptionId: Map<string, UserStatsStripeIdentity>;
  totalRows: number;
};

type UserStatsLikeRecord = {
  email?: string | null;
  user_id?: number | string | null;
  workshop_id?: number | string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

function asString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

export function normalizeEmail(value: unknown) {
  return asString(value)?.toLowerCase() ?? null;
}

export function buildUserStatsEmailLookup(
  rows: UserStatsLikeRecord[],
): UserStatsEmailLookup {
  const byEmail = new Map<string, UserStatsEmailIdentity>();
  const ambiguousEmails = new Set<string>();
  const byCoreStripeCustomerId = new Map<string, UserStatsStripeIdentity>();
  const ambiguousCoreStripeCustomerIds = new Set<string>();
  const byCoreStripeSubscriptionId = new Map<string, UserStatsStripeIdentity>();
  const ambiguousCoreStripeSubscriptionIds = new Set<string>();

  function recordIdentity(
    map: Map<string, UserStatsStripeIdentity>,
    ambiguous: Set<string>,
    key: string,
    next: UserStatsStripeIdentity,
  ) {
    if (ambiguous.has(key)) return;
    const current = map.get(key);
    if (
      current &&
      (current.internalUserId !== next.internalUserId ||
        current.workshopId !== next.workshopId)
    ) {
      map.delete(key);
      ambiguous.add(key);
      return;
    }
    map.set(key, next);
  }

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const internalUserId = asString(row.user_id);
    const workshopId = asString(row.workshop_id);
    const coreStripeCustomerId = asString(row.stripe_customer_id);
    const coreStripeSubscriptionId = asString(row.stripe_subscription_id);

    if (email && internalUserId && !ambiguousEmails.has(email)) {
      const nextIdentity = { email, internalUserId, workshopId };
      const current = byEmail.get(email);

      if (
        current &&
        (current.internalUserId !== nextIdentity.internalUserId ||
          current.workshopId !== nextIdentity.workshopId)
      ) {
        byEmail.delete(email);
        ambiguousEmails.add(email);
      } else {
        byEmail.set(email, nextIdentity);
      }
    }

    if (coreStripeCustomerId) {
      recordIdentity(
        byCoreStripeCustomerId,
        ambiguousCoreStripeCustomerIds,
        coreStripeCustomerId,
        { internalUserId, workshopId },
      );
    }
    if (coreStripeSubscriptionId) {
      recordIdentity(
        byCoreStripeSubscriptionId,
        ambiguousCoreStripeSubscriptionIds,
        coreStripeSubscriptionId,
        { internalUserId, workshopId },
      );
    }
  }

  return {
    ambiguousEmails,
    byEmail,
    ambiguousCoreStripeCustomerIds,
    byCoreStripeCustomerId,
    ambiguousCoreStripeSubscriptionIds,
    byCoreStripeSubscriptionId,
    totalRows: rows.length,
  };
}

function hasAwsLookupConfig() {
  return Boolean(
    getEnv("AWS_ACCESS_KEY_ID") &&
      getEnv("AWS_SECRET_ACCESS_KEY") &&
      getEnv("AWS_REGION") &&
      getEnv("DATA_BUCKET"),
  );
}

export async function loadUserStatsEmailLookupFromS3() {
  if (!hasAwsLookupConfig()) {
    return null;
  }

  const client = new S3Client({
    credentials: {
      accessKeyId: getEnv("AWS_ACCESS_KEY_ID")!,
      secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY")!,
    },
    region: getEnv("AWS_REGION")!,
  });

  const response = await client.send(
    new GetObjectCommand({
      Bucket: getEnv("DATA_BUCKET")!,
      Key: "latest/user_stats.json.gz",
    }),
  );

  if (!response.Body || !("transformToByteArray" in response.Body)) {
    return null;
  }

  const body = Buffer.from(await response.Body.transformToByteArray());
  const payload = JSON.parse(
    gunzipSync(body).toString("utf8"),
  ) as UserStatsLikeRecord[];

  return buildUserStatsEmailLookup(payload);
}
