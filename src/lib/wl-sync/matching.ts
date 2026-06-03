// Company-matching helpers used by discover-new.ts.
//
// When a wl-app signup lands, we want to attach it to an existing CRM
// company row (from SCB registry, Lemlist CSV, or discovery) instead of
// creating a duplicate. This module provides the strict-match path
// (auto-link) and the fuzzy-match path (logs candidates to
// company_merge_candidates for /companies/duplicates review).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Common Nordic legal-entity suffixes we strip before name comparison.
// Word-boundary so we don't eat "abrahamssons".
const LEGAL_SUFFIX_RE =
  /\b(ab|aktiebolag|as|a\/s|aps|oy|o[uüy]|sia|uab|ltd|llc|gmbh|sa|sas|sarl|kg|gbr|ehf|mc|bv|nv|spzoo)\b\.?/gi;

export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type CompanyMatchResult = {
  companyId: string;
  matchType: "org_number" | "exact_normalized_name" | "strict_trigram";
  similarity?: number;
};

type FindCompanyParams = {
  workspaceId: string;
  countryCode: string | null;
  companyName: string | null;
  orgNumber?: string | null;
};

// Strict match: returns at most one existing company.id that is safe to
// auto-link a wl-app signup into. "Safe" = the row must NOT already have a
// wl_workshop_id (those are owned by the propagator). Search order:
//   1. (country, org_number) exact
//   2. (country, normalized name) exact (case + diacritics + suffix-stripped)
//   3. find_strict_company_match RPC (trigram >= 0.95)
export async function findStrictCompanyMatch(
  supabase: SupabaseClient<Database>,
  params: FindCompanyParams,
): Promise<CompanyMatchResult | null> {
  const { workspaceId, countryCode, companyName, orgNumber } = params;
  if (!countryCode) return null;

  if (orgNumber) {
    const { data } = await supabase
      .from("companies")
      .select("id, wl_workshop_id")
      .eq("workspace_id", workspaceId)
      .eq("country_code", countryCode)
      .eq("org_number", orgNumber)
      .is("wl_workshop_id", null)
      .limit(2);
    if (data && data.length === 1) {
      return { companyId: data[0].id, matchType: "org_number" };
    }
  }

  if (!companyName) return null;
  const normalized = normalizeCompanyName(companyName);
  if (!normalized) return null;

  const { data: sameCountry } = await supabase
    .from("companies")
    .select("id, name, wl_workshop_id")
    .eq("workspace_id", workspaceId)
    .eq("country_code", countryCode)
    .is("wl_workshop_id", null);

  const exactMatches = (sameCountry ?? []).filter(
    (c) => c.name && normalizeCompanyName(c.name) === normalized,
  );
  if (exactMatches.length === 1) {
    return {
      companyId: exactMatches[0].id,
      matchType: "exact_normalized_name",
    };
  }
  // If we get multiple exact-normalized matches, don't auto-merge —
  // ambiguity is signal that human review is needed. Fall through to
  // the fuzzy logger (which will queue them all).
  if (exactMatches.length > 1) return null;

  const { data: trigram } = await supabase.rpc("find_strict_company_match", {
    p_workspace_id: workspaceId,
    p_country_code: countryCode,
    p_name: companyName,
  });
  const row = (trigram as Array<{ id: string; wl_workshop_id: string | null; similarity: number }> | null)?.[0];
  if (row && !row.wl_workshop_id) {
    return {
      companyId: row.id,
      matchType: "strict_trigram",
      similarity: Number(row.similarity),
    };
  }

  return null;
}

// Look up trigram candidates in the 0.6–0.95 range and queue them in
// company_merge_candidates for /companies/duplicates review. Safe to call
// even when no candidates exist.
export async function logFuzzyMergeCandidates(
  supabase: SupabaseClient<Database>,
  params: {
    workspaceId: string;
    primaryCompanyId: string;
    companyName: string;
    countryCode: string;
  },
): Promise<number> {
  const { data } = await supabase.rpc("find_fuzzy_company_matches", {
    p_workspace_id: params.workspaceId,
    p_country_code: params.countryCode,
    p_name: params.companyName,
    p_min_sim: 0.6,
    p_max_sim: 0.95,
    p_limit: 5,
  });

  type FuzzyRow = {
    id: string;
    similarity: number;
    wl_workshop_id: string | null;
    source: string | null;
    org_number: string | null;
  };
  const rows = (data as FuzzyRow[] | null) ?? [];
  if (rows.length === 0) return 0;

  let inserted = 0;
  for (const row of rows) {
    if (row.id === params.primaryCompanyId) continue;
    const { error } = await supabase
      .from("company_merge_candidates")
      .insert({
        workspace_id: params.workspaceId,
        primary_company_id: params.primaryCompanyId,
        candidate_company_id: row.id,
        similarity_score: Number(row.similarity),
        match_signals: {
          country_match: true,
          name_similarity: Number(row.similarity),
          candidate_source: row.source,
          candidate_has_workshop: Boolean(row.wl_workshop_id),
          candidate_org_number: row.org_number,
        },
      });
    // 23505 = unique violation (pair already queued). Treat as no-op.
    if (!error || (error.code === "23505")) {
      inserted += error ? 0 : 1;
    }
  }
  return inserted;
}

export type OutreachAttribution = {
  sendId: string;
  sequenceId: string | null;
  sentAt: string;
};

// Strongest attribution: the contact about to be upgraded to wl-app
// received an outreach email themselves and then signed up under the
// same email. Returns their most recent successful send + sequence.
//
// Temporal guard: the send must have happened BEFORE the user signed
// up. `signupAt` should be the earliest wl-app signal we have (typically
// last_login_at or diagnostics_first_at from the propagator). When
// signupAt is null we don't know when they signed up, so we use
// "right now" as a permissive upper bound — that's correct for a
// brand-new signup arriving via the cron, but the backfill should pass
// the actual signup timestamp.
export async function lookupSelfAttribution(
  supabase: SupabaseClient<Database>,
  contactId: string,
  signupAt: string | null = null,
): Promise<OutreachAttribution | null> {
  const upperBound = signupAt ?? new Date().toISOString();
  const { data: sends } = await supabase
    .from("email_queue")
    .select("id, enrollment_id, sent_at, status")
    .eq("contact_id", contactId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .lt("sent_at", upperBound)
    .order("sent_at", { ascending: false })
    .limit(1);
  const send = sends?.[0];
  if (!send || !send.sent_at) return null;

  let sequenceId: string | null = null;
  if (send.enrollment_id) {
    const { data: enrollment } = await supabase
      .from("sequence_enrollments")
      .select("sequence_id")
      .eq("id", send.enrollment_id)
      .maybeSingle();
    sequenceId = enrollment?.sequence_id ?? null;
  }

  return { sendId: send.id, sequenceId, sentAt: send.sent_at };
}

// If the matched company already had non-wl-app contacts (SCB / Lemlist /
// discovery prospects), find the most recent successful outbound send to
// any of them in the last 90 days and return it. That's the most likely
// outreach that caused the signup. Returns null when no prior outreach.
export async function lookupOutreachAttribution(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyId: string,
  signupAt: string | null = null,
): Promise<OutreachAttribution | null> {
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .is("wl_user_id", null)
    .neq("source", "wl-app");

  const contactIds = (contacts ?? []).map((c) => c.id);
  if (contactIds.length === 0) return null;

  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const upperBound = signupAt ?? new Date().toISOString();

  // email_queue has no direct sequence_id — join via enrollment.
  // Temporal guard: send must precede the signup.
  const { data: sends } = await supabase
    .from("email_queue")
    .select("id, enrollment_id, sent_at, status")
    .in("contact_id", contactIds)
    .eq("status", "sent")
    .gte("sent_at", ninetyDaysAgo)
    .lt("sent_at", upperBound)
    .order("sent_at", { ascending: false })
    .limit(1);

  const send = sends?.[0];
  if (!send || !send.sent_at) return null;

  let sequenceId: string | null = null;
  if (send.enrollment_id) {
    const { data: enrollment } = await supabase
      .from("sequence_enrollments")
      .select("sequence_id")
      .eq("id", send.enrollment_id)
      .maybeSingle();
    sequenceId = enrollment?.sequence_id ?? null;
  }

  return {
    sendId: send.id,
    sequenceId,
    sentAt: send.sent_at,
  };
}

// Map a Customer.io / Stripe subscription_status into our companies.customer_status enum.
export function deriveCustomerStatus(
  subStatus: string | null,
): "trialing" | "active" | "paused" | "inactive" | "churned" | null {
  if (!subStatus) return null;
  switch (subStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "past_due":
    case "inactive":
      return "inactive";
    case "canceled":
    case "cancelled":
      return "churned";
    default:
      return null;
  }
}

// A plan_type counts as "paid" if it's set and isn't the free tier.
// Known paid values: small_monthly, small_yearly, large_monthly, large_yearly.
function isPaidPlan(planType: string | null): boolean {
  return planType != null && planType !== "free";
}

// Map (subscription_status, plan_type) into companies.lifecycle_stage.
// Active users split by plan: paid plans → 'paying', free/unknown plans →
// 'freemium'. This keeps the lifecycle column consistent with the plan column
// (an active free user is "Freemium / Free", never the confusing "Paying / Free").
export function deriveLifecycleStage(
  subStatus: string | null,
  planType: string | null,
): "lead" | "trial" | "paying" | "freemium" | "churned" | null {
  if (!subStatus) return null;
  if (subStatus === "trialing") return "trial";
  if (subStatus === "active") {
    // Active users have crossed the activation line. Paid plans are 'paying';
    // free-tier (or not-yet-synced) active users are 'freemium' — activated,
    // not yet revenue-generating, and a clear upgrade target.
    return isPaidPlan(planType) ? "paying" : "freemium";
  }
  if (subStatus === "canceled" || subStatus === "cancelled") return "churned";
  if (planType === null && subStatus === null) return "lead";
  return null;
}
