// Server-side data layer for /ceo/domain-portfolio.
// Reads the curated catalog + CEO-edited decision state from
// dashboard_domain_portfolio. Uses the CEO-namespaced service client
// (RLS-bypass; matches the rest of /ceo/* pages).

import { createSupabaseServiceClient } from "@/lib/ceo/supabase";

export type DomainPortfolioStatus =
  | "not_started"
  | "planning"
  | "bought"
  | "installed"
  | "skipped";

export type DomainPortfolioRegion = "north" | "west" | "south" | "east";

export type DomainPortfolioTldType =
  | "native_cctld"
  | "generic"
  | "domain_hack"
  | "subdomain_convention"
  | "idn"
  | "sponsored";

export type DomainPortfolioRow = {
  id: string;
  country_code: string;
  country_name: string;
  country_flag: string | null;
  region: DomainPortfolioRegion;
  tld: string;
  rank: number;
  tld_type: DomainPortfolioTldType;
  registry: string | null;
  rationale: string;
  market_share: string | null;
  restrictions: string | null;
  is_global_hack: boolean;
  status: DomainPortfolioStatus;
  domain_name: string | null;
  registrar: string | null;
  annual_cost_eur: number | null;
  notes: string | null;
  purchased_at: string | null;
  installed_at: string | null;
  updated_at: string;
};

export type DomainPortfolioSummary = {
  totalRows: number;
  countriesTotal: number;
  countriesCovered: number; // at least one row in bought or installed
  byStatus: Record<DomainPortfolioStatus, number>;
  byRegion: Record<
    DomainPortfolioRegion,
    {
      total: number;
      covered: number; // countries with at least one bought/installed
      countries: number;
    }
  >;
  estimatedAnnualCostEur: number;
};

export type DomainPortfolioData = {
  rows: DomainPortfolioRow[];
  summary: DomainPortfolioSummary;
};

const EMPTY: DomainPortfolioData = {
  rows: [],
  summary: {
    totalRows: 0,
    countriesTotal: 0,
    countriesCovered: 0,
    byStatus: {
      not_started: 0,
      planning: 0,
      bought: 0,
      installed: 0,
      skipped: 0,
    },
    byRegion: {
      north: { total: 0, covered: 0, countries: 0 },
      west: { total: 0, covered: 0, countries: 0 },
      south: { total: 0, covered: 0, countries: 0 },
      east: { total: 0, covered: 0, countries: 0 },
    },
    estimatedAnnualCostEur: 0,
  },
};

function summarize(rows: DomainPortfolioRow[]): DomainPortfolioSummary {
  const byStatus: Record<DomainPortfolioStatus, number> = {
    not_started: 0,
    planning: 0,
    bought: 0,
    installed: 0,
    skipped: 0,
  };
  const byRegion: DomainPortfolioSummary["byRegion"] = {
    north: { total: 0, covered: 0, countries: 0 },
    west: { total: 0, covered: 0, countries: 0 },
    south: { total: 0, covered: 0, countries: 0 },
    east: { total: 0, covered: 0, countries: 0 },
  };

  const countriesAll = new Set<string>();
  const countriesByRegion: Record<DomainPortfolioRegion, Set<string>> = {
    north: new Set(),
    west: new Set(),
    south: new Set(),
    east: new Set(),
  };
  const countriesCovered = new Set<string>();
  const coveredByRegion: Record<DomainPortfolioRegion, Set<string>> = {
    north: new Set(),
    west: new Set(),
    south: new Set(),
    east: new Set(),
  };

  let estimatedAnnualCostEur = 0;

  for (const row of rows) {
    byStatus[row.status] += 1;
    byRegion[row.region].total += 1;

    countriesAll.add(row.country_code);
    countriesByRegion[row.region].add(row.country_code);

    if (row.status === "bought" || row.status === "installed") {
      countriesCovered.add(row.country_code);
      coveredByRegion[row.region].add(row.country_code);
      if (row.annual_cost_eur) {
        estimatedAnnualCostEur += Number(row.annual_cost_eur);
      }
    }
  }

  for (const region of Object.keys(byRegion) as DomainPortfolioRegion[]) {
    byRegion[region].countries = countriesByRegion[region].size;
    byRegion[region].covered = coveredByRegion[region].size;
  }

  return {
    totalRows: rows.length,
    countriesTotal: countriesAll.size,
    countriesCovered: countriesCovered.size,
    byStatus,
    byRegion,
    estimatedAnnualCostEur,
  };
}

export async function getDomainPortfolioData(): Promise<DomainPortfolioData> {
  const supabase = await createSupabaseServerClientSafe();
  if (!supabase) return EMPTY;

  const { data, error } = await supabase
    .from("dashboard_domain_portfolio")
    .select(
      "id, country_code, country_name, country_flag, region, tld, rank, tld_type, registry, rationale, market_share, restrictions, is_global_hack, status, domain_name, registrar, annual_cost_eur, notes, purchased_at, installed_at, updated_at",
    )
    .order("region", { ascending: true })
    .order("country_name", { ascending: true })
    .order("rank", { ascending: true });

  if (error) {
    console.error("[domain-portfolio] read failed", error);
    return EMPTY;
  }

  const rows = (data ?? []) as unknown as DomainPortfolioRow[];
  return { rows, summary: summarize(rows) };
}

// Bound the URL-length risk small data set won't trigger anyway —
// this exists only so the page can render an empty state when
// Supabase env vars aren't set (e.g. local dev without secrets).
async function createSupabaseServerClientSafe() {
  return createSupabaseServiceClient();
}

// Domain-health page tracks a fixed list of sending domains (currently
// wrenchlane.com and wrenchlane.co). When a portfolio row's
// domain_name matches one of those, we expose a link from the row
// drawer over to /ceo/domain-health so health + portfolio stay
// connected. Keep in sync with TRACKED_DOMAINS in
// src/lib/ceo/data/domain-health.ts.
const HEALTH_TRACKED_DOMAINS = new Set(["wrenchlane.com", "wrenchlane.co"]);

export function getDomainHealthLink(domainName: string | null): string | null {
  if (!domainName) return null;
  const normalized = domainName.trim().toLowerCase();
  if (!normalized) return null;
  if (HEALTH_TRACKED_DOMAINS.has(normalized)) {
    return "/ceo/domain-health";
  }
  return null;
}
