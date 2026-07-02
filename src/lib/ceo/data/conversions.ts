// Per-sequence outreach → signup conversion stats.
// Backed by get_sequence_conversions RPC. Attribution columns are written
// by discover-new.ts when a wl-app signup lands at a company that already
// had prospect contacts.

import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";

const WRENCHLANE_WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

export type ConversionRow = {
  sequenceId: string;
  sequenceName: string;
  sequenceStatus: string | null;
  totalSends: number;
  uniqueRecipients: number;
  // Distinct recipients with at least one open / click event. Inflated by
  // email security scanners, so treat as upper bounds.
  openedRecipients: number;
  clickedRecipients: number;
  attributedSignups: number;
  conversionRate: number | null;
  medianLagDays: number | null;
};

export type ConversionsData = {
  totalSends: number;
  totalUniqueRecipients: number;
  totalAttributedSignups: number;
  overallConversionRate: number | null;
  // Audience-overlap context: cold outreach (workshops) and app signups are
  // largely different populations. These reframe the funnel so the tiny
  // attributed-signups figure reads as "audience mismatch" rather than
  // "email is broken".
  totalAppSignups: number; // all wl-app signups created in the window
  // share of app signups traceable back to outreach (attributed / signups)
  outreachSourcedShare: number | null;
  // Funnel rollups across all sequences (distinct recipients).
  totalOpenedRecipients: number;
  totalClickedRecipients: number;
  rows: ConversionRow[];
};

const EMPTY: ConversionsData = {
  totalSends: 0,
  totalUniqueRecipients: 0,
  totalAttributedSignups: 0,
  overallConversionRate: null,
  totalAppSignups: 0,
  outreachSourcedShare: null,
  totalOpenedRecipients: 0,
  totalClickedRecipients: 0,
  rows: [],
};

export const getConversionsData = unstable_cache(
  getConversionsDataUncached,
  ["ceo-conversions"],
  CEO_CACHE_OPTIONS,
);

async function getConversionsDataUncached(
  sinceIso: string,
): Promise<ConversionsData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return EMPTY;
  }
  const { data, error } = await supabase.rpc("get_sequence_conversions", {
    p_workspace_id: WRENCHLANE_WORKSPACE_ID,
    p_since: sinceIso,
  });
  if (error) {
    console.error("[ceo/conversions] rpc failed", error);
    return EMPTY;
  }

  // Total app signups in the window — the denominator that makes the
  // attributed-signups number interpretable (most signups never touched
  // outreach at all).
  const { count: appSignupCount } = await supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", WRENCHLANE_WORKSPACE_ID)
    .not("wl_user_id", "is", null)
    .gte("created_at", sinceIso);
  type Raw = {
    sequence_id: string;
    sequence_name: string;
    sequence_status: string | null;
    total_sends: number | string;
    unique_recipients: number | string;
    opened_recipients: number | string | null;
    clicked_recipients: number | string | null;
    attributed_signups: number | string;
    conversion_rate: number | string | null;
    median_lag_days: number | string | null;
  };
  const rows: ConversionRow[] = ((data as Raw[]) ?? []).map((r) => ({
    sequenceId: r.sequence_id,
    sequenceName: r.sequence_name,
    sequenceStatus: r.sequence_status,
    totalSends: Number(r.total_sends ?? 0),
    uniqueRecipients: Number(r.unique_recipients ?? 0),
    openedRecipients: Number(r.opened_recipients ?? 0),
    clickedRecipients: Number(r.clicked_recipients ?? 0),
    attributedSignups: Number(r.attributed_signups ?? 0),
    conversionRate:
      r.conversion_rate === null || r.conversion_rate === undefined
        ? null
        : Number(r.conversion_rate),
    medianLagDays:
      r.median_lag_days === null || r.median_lag_days === undefined
        ? null
        : Number(r.median_lag_days),
  }));

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalSends += row.totalSends;
      acc.totalUniqueRecipients += row.uniqueRecipients;
      acc.totalOpenedRecipients += row.openedRecipients;
      acc.totalClickedRecipients += row.clickedRecipients;
      acc.totalAttributedSignups += row.attributedSignups;
      return acc;
    },
    {
      totalSends: 0,
      totalUniqueRecipients: 0,
      totalOpenedRecipients: 0,
      totalClickedRecipients: 0,
      totalAttributedSignups: 0,
    },
  );
  const overall =
    totals.totalUniqueRecipients > 0
      ? Math.round(
          (totals.totalAttributedSignups / totals.totalUniqueRecipients) *
            10000,
        ) / 100
      : null;

  const totalAppSignups = appSignupCount ?? 0;
  const outreachSourcedShare =
    totalAppSignups > 0
      ? Math.round(
          (totals.totalAttributedSignups / totalAppSignups) * 10000,
        ) / 100
      : null;

  return {
    ...totals,
    overallConversionRate: overall,
    totalAppSignups,
    outreachSourcedShare,
    rows,
  };
}
