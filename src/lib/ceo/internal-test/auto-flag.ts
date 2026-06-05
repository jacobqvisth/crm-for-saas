import type { createSupabaseServiceClient } from "@/lib/ceo/supabase";

// Email domains whose users are automatically flagged as internal-test
// (dashboard_users.is_internal_test = true). Applied at every core_app sync
// and via the matching backfill migration. Add a new entry here to start
// filtering anyone with that domain out of CEO dashboard metrics.
//
// The per-user exempt flag (dashboard_users.is_internal_test_exempt) overrides
// this, so individual customers inside a flagged domain stay counted.
//
// codeoc.ai is CodeOC, the dev company behind Wrenchlane — every account on
// that domain is an internal team member, not a customer.
export const INTERNAL_TEST_EMAIL_DOMAINS = [
  "wrenchlane.com",
  "codeoc.ai",
] as const;

type ServiceClient = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

export type AutoFlagResult = {
  flagged: number;
};

export async function applyInternalTestDomainFlag(
  supabase: ServiceClient,
  domains: readonly string[] = INTERNAL_TEST_EMAIL_DOMAINS,
): Promise<AutoFlagResult> {
  if (domains.length === 0) {
    return { flagged: 0 };
  }

  const now = new Date().toISOString();
  const { error, count } = (await supabase
    .from("dashboard_users")
    .update(
      {
        is_internal_test: true,
        internal_test_note: "auto: internal email domain",
        internal_test_set_at: now,
        internal_test_set_by: "auto-domain-filter",
      },
      { count: "exact" },
    )
    .in("metadata->>email_domain", [...domains])
    .eq("is_internal_test", false)
    .eq("is_internal_test_exempt", false)) as {
    error: Error | null;
    count: number | null;
  };

  if (error) throw error;
  return { flagged: count ?? 0 };
}
