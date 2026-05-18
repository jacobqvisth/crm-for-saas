// Server-side data loader for the /ceo/domain-health page. Reads the
// last N rows from dashboard_domain_health_checks and shapes them for
// rendering. No transformations beyond unpacking the JSONB columns into
// typed objects so the component layer stays dumb.

import { createServiceClient } from "@/lib/supabase/service";
import type { DomainHealthCheck } from "@/lib/domain-health";

const DEFAULT_DOMAIN = "wrenchlane.com";

export type DomainHealthPageData = {
  domain: string;
  latest: DomainHealthCheck | null;
  // Chronological order (oldest → newest) so charts can plot left-to-right.
  history: DomainHealthCheck[];
};

export async function getDomainHealthData(
  domain: string = DEFAULT_DOMAIN,
  limit = 30,
): Promise<DomainHealthPageData> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dashboard_domain_health_checks")
    .select(
      "domain, checked_at, dns_records, blocklists, send_metrics, status, alerts, run_notes",
    )
    .eq("domain", domain)
    .order("checked_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as DomainHealthCheck[];
  const latest = rows[0] ?? null;
  const history = [...rows].reverse(); // oldest first for charts

  return { domain, latest, history };
}
