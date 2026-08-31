// Pulls Google Ads conversion-action config and daily conversion counts into
// dashboard_ad_conversion_* for /dashboard/paying-customers.
//
// Two reads, both cheap:
//   1. conversion_action        which actions exist, and which ones bidding sees
//   2. customer + campaign      daily conversions per action, account and campaign
//
// The point of storing Google's own numbers is the comparison, not the numbers.
// Google's `WrenchLane (web) purchase` action tracks card entry, not payment,
// and the only way to demonstrate that is to line its counts up against our own
// checkout and first-payment tables month by month.

import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import {
  createGoogleAdsAccess,
  googleAdsSearch,
  GoogleAdsApiError,
  type GoogleAdsAccess,
} from "@/lib/ceo/sync/google-ads-client";
import { SyncSkippedError } from "@/lib/ceo/sync/errors";

/**
 * Conversion history is short — the first ad ran 2026-05-19 — so a year covers
 * everything with room to spare and keeps the daily pull small.
 */
const DEFAULT_LOOKBACK_DAYS = 400;

const UPSERT_BATCH = 500;

type ActionRow = {
  conversionAction?: {
    id?: string;
    name?: string;
    category?: string;
    type?: string;
    status?: string;
    primaryForGoal?: boolean;
    includeInConversionsMetric?: boolean;
    countingType?: string;
    clickThroughLookbackWindowDays?: string | number;
  };
};

type StatRow = {
  campaign?: { id?: string; name?: string };
  segments?: {
    date?: string;
    conversionAction?: string;
    conversionActionName?: string;
    conversionActionCategory?: string;
  };
  metrics?: { allConversions?: number | string; allConversionsValue?: number | string };
};

export type SyncPayingCustomersResult = {
  ok: boolean;
  syncedAt: string;
  skipped?: boolean;
  reason?: string;
  start?: string;
  end?: string;
  actions?: number;
  statRows?: number;
  error?: string;
};

function num(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `customers/123/conversionActions/456` -> `456`. */
function actionIdFromResourceName(resourceName: string | undefined): string | null {
  if (!resourceName) return null;
  const last = resourceName.split("/").pop();
  return last && /^\d+$/.test(last) ? last : null;
}

async function readActions(access: GoogleAdsAccess): Promise<ActionRow[]> {
  return googleAdsSearch<ActionRow>(
    access,
    `SELECT conversion_action.id, conversion_action.name, conversion_action.category,
            conversion_action.type, conversion_action.status,
            conversion_action.primary_for_goal,
            conversion_action.include_in_conversions_metric,
            conversion_action.counting_type,
            conversion_action.click_through_lookback_window_days
     FROM conversion_action`,
  );
}

/**
 * Account-level daily conversions per action.
 *
 * `metrics.conversions` cannot be selected from `conversion_action` at all
 * (PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE), so the counts have to come
 * from `customer`/`campaign` segmented by conversion action instead. That is
 * also why only `all_conversions` is stored: it is the metric these resources
 * agree to report, and the config table already says which actions the
 * `conversions` metric would have counted.
 */
async function readAccountStats(
  access: GoogleAdsAccess,
  start: string,
  end: string,
): Promise<StatRow[]> {
  return googleAdsSearch<StatRow>(
    access,
    `SELECT segments.date, segments.conversion_action, segments.conversion_action_name,
            segments.conversion_action_category,
            metrics.all_conversions, metrics.all_conversions_value
     FROM customer
     WHERE segments.date BETWEEN '${start}' AND '${end}'`,
  );
}

async function readCampaignStats(
  access: GoogleAdsAccess,
  start: string,
  end: string,
): Promise<StatRow[]> {
  return googleAdsSearch<StatRow>(
    access,
    `SELECT campaign.id, campaign.name, segments.date,
            segments.conversion_action, segments.conversion_action_name,
            metrics.all_conversions, metrics.all_conversions_value
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}'
       AND metrics.all_conversions > 0`,
  );
}

export async function syncPayingCustomers(options?: {
  lookbackDays?: number;
}): Promise<SyncPayingCustomersResult> {
  const syncedAt = new Date().toISOString();

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      ok: false,
      syncedAt,
      skipped: true,
      reason: "Supabase service client is not configured.",
    };
  }

  let access: GoogleAdsAccess;
  try {
    access = await createGoogleAdsAccess();
  } catch (error) {
    if (error instanceof SyncSkippedError) {
      return { ok: true, syncedAt, skipped: true, reason: error.message };
    }
    throw error;
  }

  const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 86_400_000);
  const start = isoDate(startDate);
  const end = isoDate(endDate);

  // ---- config -----------------------------------------------------------
  let actionRows: ActionRow[];
  try {
    actionRows = await readActions(access);
  } catch (error) {
    return {
      ok: false,
      syncedAt,
      start,
      end,
      error:
        error instanceof GoogleAdsApiError
          ? `conversion_action: ${error.message}`
          : String(error),
    };
  }

  const actions = actionRows
    .map((row) => row.conversionAction)
    .filter((a): a is NonNullable<ActionRow["conversionAction"]> => Boolean(a?.id))
    .map((a) => ({
      conversion_action_id: a.id as string,
      name: a.name ?? a.id ?? "",
      category: a.category ?? null,
      type: a.type ?? null,
      status: a.status ?? null,
      primary_for_goal: a.primaryForGoal ?? null,
      include_in_conversions_metric: a.includeInConversionsMetric ?? null,
      counting_type: a.countingType ?? null,
      click_lookback_days: a.clickThroughLookbackWindowDays
        ? num(a.clickThroughLookbackWindowDays)
        : null,
      synced_at: syncedAt,
    }));

  for (const batch of chunk(actions, UPSERT_BATCH)) {
    const { error } = await supabase
      .from("dashboard_ad_conversion_actions")
      .upsert(batch, { onConflict: "conversion_action_id" });
    if (error) {
      return { ok: false, syncedAt, start, end, error: `actions: ${error.message}` };
    }
  }

  // ---- daily stats ------------------------------------------------------
  type StatRecord = {
    conversion_action_id: string;
    campaign_id: string;
    campaign_name: string | null;
    stat_date: string;
    all_conversions: number;
    all_conversions_value: number;
  };

  const stats = new Map<string, StatRecord>();
  const add = (
    actionId: string,
    campaignId: string,
    campaignName: string | null,
    date: string,
    conversions: number,
    value: number,
  ) => {
    const key = `${actionId}|${campaignId}|${date}`;
    const existing = stats.get(key);
    if (existing) {
      // Google can return several rows for one (action, campaign, day) when
      // other segments differ. Summing is right; upserting each in turn would
      // let the last one win and quietly drop the rest.
      existing.all_conversions += conversions;
      existing.all_conversions_value += value;
      return;
    }
    stats.set(key, {
      conversion_action_id: actionId,
      campaign_id: campaignId,
      campaign_name: campaignName,
      stat_date: date,
      all_conversions: conversions,
      all_conversions_value: value,
    });
  };

  try {
    for (const row of await readAccountStats(access, start, end)) {
      const actionId = actionIdFromResourceName(row.segments?.conversionAction);
      const date = row.segments?.date;
      if (!actionId || !date) continue;
      add(
        actionId,
        "",
        null,
        date,
        num(row.metrics?.allConversions),
        num(row.metrics?.allConversionsValue),
      );
    }
  } catch (error) {
    return {
      ok: false,
      syncedAt,
      start,
      end,
      error: `account stats: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    for (const row of await readCampaignStats(access, start, end)) {
      const actionId = actionIdFromResourceName(row.segments?.conversionAction);
      const date = row.segments?.date;
      const campaignId = row.campaign?.id;
      if (!actionId || !date || !campaignId) continue;
      add(
        actionId,
        campaignId,
        row.campaign?.name ?? null,
        date,
        num(row.metrics?.allConversions),
        num(row.metrics?.allConversionsValue),
      );
    }
  } catch (error) {
    // Per-campaign detail is a nicety; the account-level series is what the
    // reconciliation actually needs. Losing one should not lose the other.
    return {
      ok: true,
      syncedAt,
      start,
      end,
      actions: actions.length,
      statRows: stats.size,
      error: `campaign stats: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const statRows = [...stats.values()];
  for (const batch of chunk(statRows, UPSERT_BATCH)) {
    const { error } = await supabase
      .from("dashboard_ad_conversion_stats")
      .upsert(batch, { onConflict: "conversion_action_id,campaign_id,stat_date" });
    if (error) {
      return { ok: false, syncedAt, start, end, error: `stats: ${error.message}` };
    }
  }

  return {
    ok: true,
    syncedAt,
    start,
    end,
    actions: actions.length,
    statRows: statRows.length,
  };
}
