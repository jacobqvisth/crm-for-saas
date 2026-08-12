import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { scoreContact } from "@/lib/calls/scoring";
import { pickAgentLanguage } from "./types";
import { voiceSafeInline } from "./sanitize";

type Client = SupabaseClient<Database>;

/**
 * Everything the voice agent may know about the person it is calling.
 * Injected as provider dynamic variables at call start; the agent's prompt
 * instructs it to use these facts naturally, never to recite them.
 */
export interface CallBrief {
  contactId: string;
  companyId: string | null;
  phone: string | null;
  language: string;
  variables: Record<string, string>;
}

const fmtDate = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10) : "unknown";

type BriefContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  language: string | null;
  country_code: string | null;
  company_id: string | null;
  wl_user_id: string | null;
  app_username: string | null;
  signed_up_at: string | null;
  last_login_at: string | null;
  last_active_at: string | null;
  login_count: number | null;
  credits_remaining: number | null;
  user_plan_type: string | null;
  user_subscription_status: string | null;
  diagnostics_total: number | null;
  diagnostics_last_30d: number | null;
  last_contacted_at: string | null;
};

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  one_monthly: "One (monthly)",
  one_yearly: "One (yearly)",
  small_monthly: "Small (monthly)",
  small_yearly: "Small (yearly)",
  large_monthly: "Large (monthly)",
  large_yearly: "Large (yearly)",
};

export async function buildCallBrief(
  supabase: Client,
  contactId: string,
  opts: { languagesEnabled: string[]; objective?: string | null },
): Promise<CallBrief | { error: string }> {
  const { data: contactRaw } = await supabase
    .from("contacts")
    .select(
      "id, first_name, last_name, phone, language, country_code, company_id, " +
        "wl_user_id, app_username, signed_up_at, last_login_at, last_active_at, login_count, " +
        "credits_remaining, user_plan_type, user_subscription_status, " +
        "diagnostics_total, diagnostics_last_30d, last_contacted_at",
    )
    .eq("id", contactId)
    .maybeSingle();
  const contact = contactRaw as unknown as BriefContactRow | null;
  if (!contact) return { error: "contact not found" };

  const { data: company } = contact.company_id
    ? await supabase
        .from("companies")
        .select("id, name, lifecycle_stage, plan, trial_ends_at, payment_status, city")
        .eq("id", contact.company_id)
        .maybeSingle()
    : { data: null };

  const language = pickAgentLanguage(
    contact.language,
    contact.country_code,
    opts.languagesEnabled,
  );

  const score = scoreContact({
    user_plan_type: contact.user_plan_type,
    user_subscription_status: contact.user_subscription_status,
    signed_up_at: contact.signed_up_at,
    diagnostics_total: contact.diagnostics_total,
    diagnostics_last_30d: contact.diagnostics_last_30d,
    login_count: contact.login_count,
    last_active_at: contact.last_active_at,
    credits_remaining: contact.credits_remaining,
    last_contacted_at: contact.last_contacted_at,
    paymentIssue: company?.payment_status === "past_due",
  });

  const firstName = contact.first_name?.trim() || contact.app_username?.trim() || "there";
  const plan = PLAN_LABEL[contact.user_plan_type ?? "free"] ?? contact.user_plan_type ?? "Free";

  const facts: string[] = [];
  if (contact.signed_up_at) facts.push(`Signed up ${fmtDate(contact.signed_up_at)}`);
  if (contact.last_login_at) facts.push(`Last logged in ${fmtDate(contact.last_login_at)}`);
  if (typeof contact.diagnostics_total === "number") {
    facts.push(
      `Has run ${contact.diagnostics_total} diagnostics in total, ${contact.diagnostics_last_30d ?? 0} in the last 30 days`,
    );
  }
  if (typeof contact.credits_remaining === "number") {
    facts.push(`${contact.credits_remaining} credits remaining`);
  }
  if (company?.trial_ends_at) facts.push(`Trial ends/ended ${fmtDate(company.trial_ends_at)}`);
  if (company?.payment_status === "past_due") facts.push("Their last payment failed");

  const variables: Record<string, string> = {
    contact_first_name: voiceSafeInline(firstName),
    workshop_name: voiceSafeInline(company?.name ?? "their workshop"),
    plan_name: plan,
    subscription_status: contact.user_subscription_status ?? "none",
    usage_facts: voiceSafeInline(facts.join(". ") || "No usage data available"),
    why_calling: voiceSafeInline(
      score.reasons.map((r) => r.label).join(". ") || "Routine check-in",
    ),
    call_objective: voiceSafeInline(
      opts.objective ??
        "Learn how Wrenchlane is working for them and help them get more value from it",
    ),
    language,
  };

  return {
    contactId: contact.id,
    companyId: contact.company_id,
    phone: contact.phone,
    language,
    variables,
  };
}
