// Engaged prospects: outbound contacts who keep opening and clicking our email
// but have not signed up. They are not app users, so the app-usage scorer in
// scoring.ts has nothing to read on them (every wl_* field is null) and they
// never appear in the planner's candidate pool.
//
// This replaces the "Hot lead: opened 3 times" task generator, which counted
// opens of a single tracking_id rather than a contact's engagement. See
// supabase/migrations/20260810080000_engaged_prospects_rpc.sql.

import type { createClient } from "@/lib/supabase/server";
import type { ScoreReason, ScoreResult } from "@/lib/calls/scoring";

export type EngagementBar = {
  /** Minimum opens across all of this contact's emails. */
  minOpens: number;
  /** Minimum link clicks. 1 is the "strict" bar, 0 the broad one. */
  minClicks: number;
  /** Only count contacts who engaged within this many days. */
  sinceDays: number;
};

/**
 * The default bar: opened 3+ times, clicked at least once, active in the last
 * 30 days. Clicks matter more than opens because open tracking is inflated by
 * privacy proxies (Apple Mail Privacy Protection defeats it entirely), while a
 * click is a deliberate act.
 *
 * On production data this yields ~174 contacts, 146 of them with a phone
 * number. Dropping minClicks to 0 widens it to ~394.
 */
export const DEFAULT_ENGAGEMENT_BAR: EngagementBar = {
  minOpens: 3,
  minClicks: 1,
  sinceDays: 30,
};

/**
 * Hard ceiling on rows returned by the RPC. Well above the ~174 the default bar
 * produces, and low enough to stay a cheap query. If a result ever hits this we
 * want to know rather than silently rank a truncated set.
 */
export const ENGAGED_PROSPECT_LIMIT = 1000;

export type EngagedProspect = {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  company_id: string | null;
  company_name: string | null;
  lead_status: string | null;
  country_code: string | null;
  primary_owner_id: string | null;
  last_contacted_at: string | null;
  opens: number;
  clicks: number;
  emails_opened: number;
  first_engaged_at: string | null;
  last_engaged_at: string | null;
  last_clicked_at: string | null;
};

export async function fetchEngagedProspects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  bar: EngagementBar = DEFAULT_ENGAGEMENT_BAR,
  limit: number = ENGAGED_PROSPECT_LIMIT,
): Promise<{ rows: EngagedProspect[]; truncated: boolean; error: string | null }> {
  const since = new Date(Date.now() - bar.sinceDays * 86_400_000).toISOString();
  const { data, error } = await supabase.rpc("get_engaged_prospects", {
    p_workspace_id: workspaceId,
    p_min_opens: bar.minOpens,
    p_min_clicks: bar.minClicks,
    p_since: since,
    p_limit: limit,
  });

  if (error) return { rows: [], truncated: false, error: error.message };
  const rows = (data ?? []) as unknown as EngagedProspect[];
  return { rows, truncated: rows.length >= limit, error: null };
}

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

/**
 * Score an engaged prospect for call-relevance.
 *
 * Same shape and tone vocabulary as scoreContact() so the planner UI renders
 * both kinds of candidate identically, but the inputs are email engagement
 * rather than app usage. Weights are tuned so a clicking prospect lands in the
 * same band as a trialing app user, and a merely-opening one sits below.
 */
export function scoreProspect(p: EngagedProspect, now: number = Date.now()): ScoreResult {
  const reasons: ScoreReason[] = [];
  const add = (label: string, tone: ScoreReason["tone"], weight: number) => {
    reasons.push({ label, tone, weight });
  };

  const clicks = p.clicks ?? 0;
  const opens = p.opens ?? 0;
  const emailsOpened = p.emails_opened ?? 0;
  const daysSinceEngaged = daysSince(p.last_engaged_at, now);
  const daysSinceClicked = daysSince(p.last_clicked_at, now);
  const daysSinceContacted = daysSince(p.last_contacted_at, now);

  // ---- Clicks: the strongest signal available on a prospect ---------------
  if (clicks >= 3) {
    add(`Clicked ${clicks} links — strong intent`, "good", 45);
  } else if (clicks === 2) {
    add("Clicked twice", "good", 34);
  } else if (clicks === 1) {
    add("Clicked a link", "good", 26);
  }

  if (daysSinceClicked != null && daysSinceClicked <= 3) {
    add("Clicked in the last 3 days", "danger", 22);
  } else if (daysSinceClicked != null && daysSinceClicked <= 7) {
    add("Clicked this week", "warn", 14);
  }

  // ---- Breadth of opens: several emails beats one email opened often -----
  if (emailsOpened >= 3) {
    add(`Opened ${emailsOpened} different emails`, "good", 20);
  } else if (emailsOpened === 2) {
    add("Opened 2 different emails", "info", 10);
  }

  if (opens >= 10) {
    add(`Opened ${opens} times`, "info", 10);
  } else if (opens >= 5) {
    add(`Opened ${opens} times`, "info", 6);
  }

  // ---- Recency ------------------------------------------------------------
  if (daysSinceEngaged != null && daysSinceEngaged <= 2) {
    add("Engaged in the last 48h", "danger", 18);
  } else if (daysSinceEngaged != null && daysSinceEngaged <= 7) {
    add("Engaged this week", "warn", 10);
  } else if (daysSinceEngaged != null && daysSinceEngaged > 21) {
    add(`Last engaged ${daysSinceEngaged}d ago`, "info", -8);
  }

  // ---- No phone means no call --------------------------------------------
  if (!p.phone) {
    add("No phone number on file", "info", -12);
  }

  // ---- Recency penalty, mirroring the app-user scorer ---------------------
  if (daysSinceContacted != null && daysSinceContacted <= 30) {
    add(`Called ${daysSinceContacted}d ago`, "info", -8);
  }

  const score = reasons.reduce((s, r) => s + r.weight, 0);
  reasons.sort((a, b) => b.weight - a.weight);
  const priority: ScoreResult["priority"] = score >= 45 ? "high" : score >= 22 ? "medium" : "low";

  return { score, reasons, priority };
}
