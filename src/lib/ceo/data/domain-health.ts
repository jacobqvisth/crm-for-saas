// Server-side data loader for the /ceo/domain-health page. Reads the
// last N rows from dashboard_domain_health_checks per tracked domain and
// shapes them for rendering. No transformations beyond unpacking the
// JSONB columns into typed objects so the component layer stays dumb.

import { createServiceClient } from "@/lib/supabase/service";
import type { DomainHealthCheck } from "@/lib/domain-health";

// Keep in sync with DEFAULT_DOMAINS in /api/cron/domain-health/route.ts.
// Order matters — first listed renders first on the page.
const TRACKED_DOMAINS = ["wrenchlane.com", "wrenchlane.co"] as const;

export type DomainHealthPageData = {
  domain: string;
  latest: DomainHealthCheck | null;
  // Chronological order (oldest → newest) so charts can plot left-to-right.
  history: DomainHealthCheck[];
};

async function getOneDomain(
  domain: string,
  limit: number,
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

export async function getDomainHealthData(
  domain: string = TRACKED_DOMAINS[0],
  limit = 30,
): Promise<DomainHealthPageData> {
  return getOneDomain(domain, limit);
}

export async function getAllDomainHealthData(
  limit = 30,
): Promise<DomainHealthPageData[]> {
  return Promise.all(TRACKED_DOMAINS.map((d) => getOneDomain(d, limit)));
}
