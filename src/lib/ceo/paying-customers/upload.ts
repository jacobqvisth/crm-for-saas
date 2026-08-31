// Sends real payments back to Google, so the ad account can eventually be
// judged on revenue rather than on signups.
//
// Scope, deliberately narrow: only workshops that Stripe has ACTUALLY CHARGED,
// and only those whose first touch GA4 attributes to Google Ads. Uploading a
// customer no ad brought in would teach Google that its ads caused something
// they did not; uploading a trial that never paid is the exact mistake the
// account already makes with its `purchase` action.
//
// One event per workshop, ever. The ledger enforces that locally and the
// transaction id enforces it at Google's end, because the two failure modes are
// different: a re-run is ours to prevent, a retry after a network error is not.
//
// NOT YET EXERCISED against a live Data Manager endpoint — the OAuth scope for
// it did not exist when this was written, and the request shape comes from the
// published discovery document rather than from a successful call. Every run
// therefore validates before it writes (see `validateOnly` below), and the
// first real run should be done with `dryRun: true`.

import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";
import { SyncSkippedError } from "@/lib/ceo/sync/errors";
import {
  createDataManagerAccess,
  ingestEvents,
  type ConsentStatus,
  type DataManagerAccess,
  type DataManagerEvent,
} from "./data-manager";

/** Google Ads conversion action that receives these. Category SUBSCRIBE_PAID. */
const CONVERSION_ACTION_ENV = "GOOGLE_ADS_PAID_SUBSCRIPTION_ACTION_ID";

/** Google rejects conversions older than its lookback window. */
const MAX_AGE_DAYS = 90;

const BATCH_SIZE = 100;

type UserRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  email_hash: string | null;
  gclid: string | null;
  signed_up_at: string | null;
};

type AttributionRow = { internal_user_id: string | null; channel: string | null };

type SubscriptionRow = {
  workshop_id: string | null;
  currency: string | null;
  mrr_amount_cents: number | null;
  metadata: Record<string, unknown> | null;
};

type LedgerRow = { workshop_id: string; conversion_action_id: string };

export type UploadPaymentsResult = {
  ok: boolean;
  syncedAt: string;
  skipped?: boolean;
  reason?: string;
  dryRun?: boolean;
  eligible?: number;
  alreadyUploaded?: number;
  noIdentifier?: number;
  tooOld?: number;
  uploaded?: number;
  failed?: number;
  error?: string;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Stable id for one workshop's first payment.
 *
 * Derived rather than random so that a retry after a timeout — where we do not
 * know whether Google accepted the first attempt — re-sends the SAME id and is
 * deduplicated on their side instead of counting a second conversion.
 */
export function transactionIdFor(workshopId: string, firstPaidAt: string): string {
  return `wl-firstpaid-${workshopId}-${firstPaidAt.slice(0, 10)}`;
}

export async function uploadPaidSubscriptions(options?: {
  dryRun?: boolean;
  consent?: ConsentStatus;
}): Promise<UploadPaymentsResult> {
  const syncedAt = new Date().toISOString();
  const dryRun = options?.dryRun === true;

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return { ok: false, syncedAt, skipped: true, reason: "Supabase is not configured." };
  }

  const conversionActionId = process.env[CONVERSION_ACTION_ENV];
  if (!conversionActionId) {
    return {
      ok: true,
      syncedAt,
      skipped: true,
      reason:
        `${CONVERSION_ACTION_ENV} is not set. Run scripts/google-datamanager-setup.mjs, ` +
        "which creates the SUBSCRIBE_PAID conversion action and prints its id.",
    };
  }

  let access: DataManagerAccess;
  try {
    access = await createDataManagerAccess();
  } catch (error) {
    if (error instanceof SyncSkippedError) {
      return { ok: true, syncedAt, skipped: true, reason: error.message };
    }
    throw error;
  }

  const [usersRes, attributionRes, subsRes, ledgerRes] = await Promise.all([
    pageAll<UserRow>(({ from, to }) =>
      supabase
        .from(TABLES.users)
        .select("internal_user_id, workshop_id, email_hash, gclid, signed_up_at")
        .eq("is_internal_test", false)
        .order("internal_user_id")
        .range(from, to),
    ),
    pageAll<AttributionRow>(({ from, to }) =>
      supabase
        .from(TABLES.userAttribution)
        .select("internal_user_id, channel")
        .eq("channel", "google_ads")
        .order("internal_user_id")
        .range(from, to),
    ),
    pageAll<SubscriptionRow>(({ from, to }) =>
      supabase
        .from(TABLES.subscriptions)
        .select("workshop_id, currency, mrr_amount_cents, metadata")
        .order("stripe_subscription_id")
        .range(from, to),
    ),
    pageAll<LedgerRow>(({ from, to }) =>
      supabase
        .from("dashboard_ad_conversion_uploads")
        .select("workshop_id, conversion_action_id")
        .eq("conversion_action_id", conversionActionId)
        .order("workshop_id")
        .range(from, to),
    ),
  ]);

  const firstError =
    usersRes.error ?? attributionRes.error ?? subsRes.error ?? ledgerRes.error;
  if (firstError) {
    return { ok: false, syncedAt, error: `read failed: ${firstError.message}` };
  }

  const adUsers = new Set(
    attributionRes.data
      .map((row) => row.internal_user_id)
      .filter((id): id is string => Boolean(id)),
  );

  // Best identifier per workshop, preferring the earliest signup as the
  // acquisition event. A gclid beats a hashed email whenever one exists,
  // because it is the click itself rather than a probabilistic match.
  const identity = new Map<
    string,
    { hashedEmail: string | null; gclid: string | null; signedUpAt: string }
  >();
  for (const user of usersRes.data) {
    if (!user.workshop_id || !user.internal_user_id || !user.signed_up_at) continue;
    if (!adUsers.has(user.internal_user_id)) continue;
    const existing = identity.get(user.workshop_id);
    if (existing && existing.signedUpAt <= user.signed_up_at) continue;
    identity.set(user.workshop_id, {
      hashedEmail: user.email_hash,
      gclid: user.gclid,
      signedUpAt: user.signed_up_at,
    });
  }

  const payments = new Map<
    string,
    { firstPaidAt: string; value: number | null; currency: string | null }
  >();
  for (const sub of subsRes.data) {
    if (!sub.workshop_id) continue;
    const meta = sub.metadata ?? {};
    if (String(meta["ever_paid"]) !== "true") continue;
    const paidAt =
      typeof meta["first_paid_at"] === "string" ? (meta["first_paid_at"] as string) : null;
    // No timestamp means no event: Google needs a conversion time, and inventing
    // one would attribute the payment to the wrong day and possibly the wrong
    // click.
    if (!paidAt) continue;
    const existing = payments.get(sub.workshop_id);
    if (existing && existing.firstPaidAt <= paidAt) continue;
    payments.set(sub.workshop_id, {
      firstPaidAt: paidAt,
      // Minor units in the subscription's own currency, as stored.
      value: sub.mrr_amount_cents === null ? null : sub.mrr_amount_cents / 100,
      currency: sub.currency,
    });
  }

  const alreadyUploaded = new Set(ledgerRes.data.map((row) => row.workshop_id));
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;

  let noIdentifier = 0;
  let tooOld = 0;
  const pending: {
    workshopId: string;
    event: DataManagerEvent;
    identifierKind: "gclid" | "hashed_email";
  }[] = [];

  for (const [workshopId, payment] of payments) {
    if (!identity.has(workshopId)) continue; // not ad-acquired
    if (alreadyUploaded.has(workshopId)) continue;

    if (Date.parse(payment.firstPaidAt) < cutoff) {
      tooOld += 1;
      continue;
    }

    const who = identity.get(workshopId)!;
    if (!who.gclid && !who.hashedEmail) {
      noIdentifier += 1;
      continue;
    }

    pending.push({
      workshopId,
      identifierKind: who.gclid ? "gclid" : "hashed_email",
      event: {
        eventTimestamp: new Date(payment.firstPaidAt).toISOString(),
        transactionId: transactionIdFor(workshopId, payment.firstPaidAt),
        ...(payment.value !== null ? { conversionValue: payment.value } : {}),
        ...(payment.currency ? { currency: payment.currency } : {}),
        ...(who.gclid ? { gclid: who.gclid } : {}),
        ...(who.gclid ? {} : { hashedEmail: who.hashedEmail ?? undefined }),
      },
    });
  }

  const summary = {
    ok: true as boolean,
    syncedAt,
    dryRun,
    eligible: pending.length,
    alreadyUploaded: alreadyUploaded.size,
    noIdentifier,
    tooOld,
    uploaded: 0,
    failed: 0,
  };

  if (pending.length === 0) return summary;

  // Validate the exact payload before any of it is recorded. A malformed body
  // that Google accepts loosely would book conversions against the wrong
  // action, which cannot be taken back.
  const check = await ingestEvents(
    access,
    conversionActionId,
    pending.slice(0, 1).map((p) => p.event),
    { validateOnly: true, consent: options?.consent },
  );
  if (!check.ok) {
    return { ...summary, ok: false, error: `validation failed: ${check.error}` };
  }

  if (dryRun) return summary;

  for (const batch of chunk(pending, BATCH_SIZE)) {
    const result = await ingestEvents(
      access,
      conversionActionId,
      batch.map((p) => p.event),
      { consent: options?.consent },
    );

    const rows = batch.map((p) => ({
      workshop_id: p.workshopId,
      conversion_action_id: conversionActionId,
      transaction_id: p.event.transactionId,
      event_timestamp: p.event.eventTimestamp,
      conversion_value: p.event.conversionValue ?? null,
      currency: p.event.currency ?? null,
      identifier_kind: p.identifierKind,
      status: result.ok ? "uploaded" : "failed",
      error: result.ok ? null : (result.error ?? "unknown"),
      uploaded_at: new Date().toISOString(),
    }));

    // The ledger is written for failures too. A failed row is what stops the
    // next run from silently retrying a payload Google will refuse again, and
    // it is the only place the reason survives.
    const { error } = await supabase
      .from("dashboard_ad_conversion_uploads")
      .upsert(rows, { onConflict: "workshop_id,conversion_action_id" });
    if (error) {
      return { ...summary, ok: false, error: `ledger write failed: ${error.message}` };
    }

    if (result.ok) summary.uploaded += batch.length;
    else summary.failed += batch.length;
  }

  return summary;
}
