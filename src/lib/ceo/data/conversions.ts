// Per-sequence outreach → signup conversion stats.
// Backed by get_sequence_conversions RPC. Attribution columns are written
// by discover-new.ts when a wl-app signup lands at a company that already
// had prospect contacts.

import { createSupabaseServiceClient } from "@/lib/ceo/supabase";

const WRENCHLANE_WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

export type ConversionRow = {
  sequenceId: string;
  sequenceName: string;
  sequenceStatus: string | null;
  totalSends: number;
  uniqueRecipients: number;
  attributedSignups: number;
  conversionRate: number | null;
  medianLagDays: number | null;
};

export type ConversionsData = {
  totalSends: number;
  totalUniqueRecipients: number;
  totalAttributedSignups: number;
  overallConversionRate: number | null;
  rows: ConversionRow[];
};

export async function getConversionsData(
  sinceIso: string,
): Promise<ConversionsData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      totalSends: 0,
      totalUniqueRecipients: 0,
      totalAttributedSignups: 0,
      overallConversionRate: null,
      rows: [],
    };
  }
  const { data, error } = await supabase.rpc("get_sequence_conversions", {
    p_workspace_id: WRENCHLANE_WORKSPACE_ID,
    p_since: sinceIso,
  });
  if (error) {
    console.error("[ceo/conversions] rpc failed", error);
    return {
      totalSends: 0,
      totalUniqueRecipients: 0,
      totalAttributedSignups: 0,
      overallConversionRate: null,
      rows: [],
    };
  }
  type Raw = {
    sequence_id: string;
    sequence_name: string;
    sequence_status: string | null;
    total_sends: number | string;
    unique_recipients: number | string;
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
      acc.totalAttributedSignups += row.attributedSignups;
      return acc;
    },
    { totalSends: 0, totalUniqueRecipients: 0, totalAttributedSignups: 0 },
  );
  const overall =
    totals.totalUniqueRecipients > 0
      ? Math.round(
          (totals.totalAttributedSignups / totals.totalUniqueRecipients) *
            10000,
        ) / 100
      : null;

  return {
    ...totals,
    overallConversionRate: overall,
    rows,
  };
}
