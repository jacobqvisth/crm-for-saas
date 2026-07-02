"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type {
  DomainPortfolioData,
  DomainPortfolioRegion,
  DomainPortfolioRow,
  DomainPortfolioStatus,
} from "@/lib/ceo/data/domain-portfolio";
import {
  updateDomainPortfolioRowAction,
  type DomainPortfolioPatch,
} from "./actions";

const REGION_LABEL: Record<DomainPortfolioRegion, string> = {
  north: "Northern Europe",
  west: "Western Europe",
  south: "Southern Europe",
  east: "Eastern Europe + Balkans",
};

const REGION_ORDER: DomainPortfolioRegion[] = ["north", "west", "south", "east"];

const STATUS_LABEL: Record<DomainPortfolioStatus, string> = {
  not_started: "Not started",
  planning: "Planning",
  bought: "Bought",
  installed: "Installed",
  skipped: "Skipped",
};

const STATUS_COLOR: Record<DomainPortfolioStatus, string> = {
  not_started: "bg-slate-100 text-slate-600 border-slate-200",
  planning: "bg-amber-50 text-amber-700 border-amber-200",
  bought: "bg-blue-50 text-blue-700 border-blue-200",
  installed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  skipped: "bg-slate-50 text-slate-400 border-slate-200 line-through",
};

const STATUS_DOT: Record<DomainPortfolioStatus, string> = {
  not_started: "bg-slate-400",
  planning: "bg-amber-500",
  bought: "bg-blue-500",
  installed: "bg-emerald-500",
  skipped: "bg-slate-300",
};

const TLD_TYPE_LABEL: Record<DomainPortfolioRow["tld_type"], string> = {
  native_cctld: "native ccTLD",
  generic: "generic",
  domain_hack: "domain hack",
  subdomain_convention: "subdomain",
  idn: "IDN",
  sponsored: "sponsored",
};

const HEALTH_TRACKED_DOMAINS = new Set(["wrenchlane.com", "wrenchlane.co"]);

function healthLinkFor(domain: string | null): string | null {
  if (!domain) return null;
  return HEALTH_TRACKED_DOMAINS.has(domain.trim().toLowerCase())
    ? "/ceo/domain-health"
    : null;
}

function formatEur(n: number) {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function registrarGuess(tld: string): string {
  // Best-effort defaults so the registrar field has a useful starting hint.
  const t = tld.toLowerCase();
  if (t === ".se" || t === ".nu") return "Loopia";
  if (t === ".no" || t === ".co.no") return "domeneshop.no";
  if (t === ".dk") return "DanDomain";
  if (t === ".fi") return "Webhotelli";
  if (t === ".de") return "INWX";
  if (t === ".fr") return "OVH";
  if (t === ".nl") return "TransIP";
  if (t === ".co.uk" || t === ".uk") return "123-reg";
  if (t === ".io" || t === ".ai" || t === ".com" || t === ".net" || t === ".org") return "Cloudflare";
  if (t === ".eu") return "EuroDNS";
  if (t === ".me") return "Namecheap";
  return "Cloudflare";
}

type Filters = {
  region: DomainPortfolioRegion | "all";
  status: DomainPortfolioStatus | "all" | "any-touched";
  country: string; // ISO-2 or "all"
  search: string;
  topThreeOnly: boolean;
};

const INITIAL_FILTERS: Filters = {
  region: "all",
  status: "all",
  country: "all",
  search: "",
  topThreeOnly: false,
};

export function PortfolioBoard({ data }: { data: DomainPortfolioData }) {
  // Source-of-truth state; mutated optimistically on save and reconciled
  // against the server response.
  const [rows, setRows] = useState<DomainPortfolioRow[]>(data.rows);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const countries = useMemo(() => {
    const seen = new Map<string, { code: string; name: string; flag: string | null }>();
    for (const row of data.rows) {
      if (!seen.has(row.country_code)) {
        seen.set(row.country_code, {
          code: row.country_code,
          name: row.country_name,
          flag: row.country_flag,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.rows]);

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.region !== "all" && row.region !== filters.region) return false;
      if (filters.country !== "all" && row.country_code !== filters.country) return false;
      if (filters.topThreeOnly && row.rank > 3) return false;

      if (filters.status === "any-touched") {
        if (row.status === "not_started") return false;
      } else if (filters.status !== "all") {
        if (row.status !== filters.status) return false;
      }

      if (search) {
        const haystack = [
          row.country_name,
          row.country_code,
          row.tld,
          row.rationale,
          row.registry ?? "",
          row.notes ?? "",
          row.domain_name ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const grouped = useMemo(() => {
    const map = new Map<
      DomainPortfolioRegion,
      Map<string, DomainPortfolioRow[]>
    >();
    for (const region of REGION_ORDER) {
      map.set(region, new Map());
    }
    for (const row of filtered) {
      const regionMap = map.get(row.region)!;
      if (!regionMap.has(row.country_code)) regionMap.set(row.country_code, []);
      regionMap.get(row.country_code)!.push(row);
    }
    return map;
  }, [filtered]);

  // Reactive summary that reflects local optimistic updates.
  const summary = useMemo(() => {
    const byStatus: Record<DomainPortfolioStatus, number> = {
      not_started: 0,
      planning: 0,
      bought: 0,
      installed: 0,
      skipped: 0,
    };
    const coveredCountries = new Set<string>();
    let estimatedAnnualCostEur = 0;
    for (const row of rows) {
      byStatus[row.status] += 1;
      if (row.status === "bought" || row.status === "installed") {
        coveredCountries.add(row.country_code);
        if (row.annual_cost_eur) {
          estimatedAnnualCostEur += Number(row.annual_cost_eur);
        }
      }
    }
    return {
      byStatus,
      countriesCovered: coveredCountries.size,
      countriesTotal: data.summary.countriesTotal,
      estimatedAnnualCostEur,
    };
  }, [rows, data.summary.countriesTotal]);

  function applyPatch(id: string, patch: DomainPortfolioPatch) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row };
        if (patch.status !== undefined) next.status = patch.status;
        if (patch.domain_name !== undefined) next.domain_name = patch.domain_name;
        if (patch.registrar !== undefined) next.registrar = patch.registrar;
        if (patch.annual_cost_eur !== undefined)
          next.annual_cost_eur = patch.annual_cost_eur;
        if (patch.notes !== undefined) next.notes = patch.notes;
        if (
          (patch.status === "bought" || patch.status === "installed") &&
          !next.purchased_at
        ) {
          next.purchased_at = new Date().toISOString();
        }
        if (patch.status === "installed" && !next.installed_at) {
          next.installed_at = new Date().toISOString();
        }
        return next;
      }),
    );
  }

  return (
    <div className="space-y-6">
      <StatStrip summary={summary} />

      <FilterBar
        filters={filters}
        setFilters={setFilters}
        countries={countries}
        regionCounts={data.summary.byRegion}
      />

      <div className="space-y-10">
        {REGION_ORDER.map((region) => {
          const regionMap = grouped.get(region);
          if (!regionMap || regionMap.size === 0) return null;

          return (
            <section key={region}>
              <header className="mb-3 flex items-baseline justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  {REGION_LABEL[region]}
                </h2>
                <p className="text-xs text-slate-500">
                  {regionMap.size} countries · {data.summary.byRegion[region].covered}/
                  {data.summary.byRegion[region].countries} covered
                </p>
              </header>

              <div className="grid gap-4 lg:grid-cols-2">
                {[...regionMap.entries()].map(([cc, items]) => (
                  <CountryCard
                    key={cc}
                    rows={items}
                    expandedId={expandedId}
                    setExpandedId={setExpandedId}
                    onApplyPatch={applyPatch}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            No TLD rows match the current filters.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatStrip({
  summary,
}: {
  summary: {
    byStatus: Record<DomainPortfolioStatus, number>;
    countriesCovered: number;
    countriesTotal: number;
    estimatedAnnualCostEur: number;
  };
}) {
  const cards: Array<{
    label: string;
    value: string;
    hint?: string;
    accent?: string;
  }> = [
    {
      label: "Countries covered",
      value: `${summary.countriesCovered}/${summary.countriesTotal}`,
      hint: "≥1 bought or installed",
      accent: "border-indigo-200 bg-indigo-50/40",
    },
    {
      label: "Planning",
      value: String(summary.byStatus.planning),
      hint: "On the shortlist",
      accent: "border-amber-200 bg-amber-50/40",
    },
    {
      label: "Bought",
      value: String(summary.byStatus.bought),
      hint: "Owned, not yet wired up",
      accent: "border-blue-200 bg-blue-50/40",
    },
    {
      label: "Installed",
      value: String(summary.byStatus.installed),
      hint: "Live in the CRM",
      accent: "border-emerald-200 bg-emerald-50/40",
    },
    {
      label: "Est. annual cost",
      value: formatEur(summary.estimatedAnnualCostEur),
      hint: "Only counts rows with a cost entered",
      accent: "border-slate-200 bg-white",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-lg border px-4 py-3 ${card.accent ?? "bg-white"}`}
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {card.label}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {card.value}
          </div>
          {card.hint ? (
            <div className="mt-1 text-xs text-slate-500">{card.hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  countries,
  regionCounts,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  countries: Array<{ code: string; name: string; flag: string | null }>;
  regionCounts: Record<
    DomainPortfolioRegion,
    { total: number; covered: number; countries: number }
  >;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={filters.region === "all"}
          onClick={() => setFilters({ ...filters, region: "all" })}
          label="All regions"
        />
        {REGION_ORDER.map((region) => (
          <Chip
            key={region}
            active={filters.region === region}
            onClick={() => setFilters({ ...filters, region })}
            label={`${REGION_LABEL[region].replace(" + Balkans", "")} · ${regionCounts[region].countries}`}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusChip
          status="all"
          active={filters.status === "all"}
          onClick={() => setFilters({ ...filters, status: "all" })}
          label="All status"
        />
        <StatusChip
          status="any-touched"
          active={filters.status === "any-touched"}
          onClick={() => setFilters({ ...filters, status: "any-touched" })}
          label="Decided"
        />
        {(
          ["planning", "bought", "installed", "skipped", "not_started"] as DomainPortfolioStatus[]
        ).map((status) => (
          <StatusChip
            key={status}
            status={status}
            active={filters.status === status}
            onClick={() => setFilters({ ...filters, status })}
            label={STATUS_LABEL[status]}
          />
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <select
          value={filters.country}
          onChange={(e) => setFilters({ ...filters, country: e.target.value })}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All countries</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag ? `${c.flag} ` : ""}
              {c.name}
            </option>
          ))}
        </select>

        <input
          type="search"
          placeholder="Search TLD, country, rationale…"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        />

        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filters.topThreeOnly}
            onChange={(e) =>
              setFilters({ ...filters, topThreeOnly: e.target.checked })
            }
          />
          Only top 3 per country
        </label>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function StatusChip({
  status,
  active,
  onClick,
  label,
}: {
  status: DomainPortfolioStatus | "all" | "any-touched";
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  const dot =
    status === "all" || status === "any-touched"
      ? "bg-slate-400"
      : STATUS_DOT[status];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </button>
  );
}

function CountryCard({
  rows,
  expandedId,
  setExpandedId,
  onApplyPatch,
}: {
  rows: DomainPortfolioRow[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onApplyPatch: (id: string, patch: DomainPortfolioPatch) => void;
}) {
  const head = rows[0];
  const total = rows.length;
  const decided = rows.filter((row) => row.status !== "not_started").length;
  const bought = rows.filter(
    (row) => row.status === "bought" || row.status === "installed",
  ).length;

  return (
    <article className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{head.country_flag ?? ""}</span>
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {head.country_name}
            </div>
            <div className="text-xs text-slate-500">
              {head.country_code} · {total} options · {decided} decided · {bought} bought
            </div>
          </div>
        </div>
      </header>

      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <TldRow
            key={row.id}
            row={row}
            expanded={expandedId === row.id}
            onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
            onApplyPatch={onApplyPatch}
          />
        ))}
      </ul>
    </article>
  );
}

function TldRow({
  row,
  expanded,
  onToggle,
  onApplyPatch,
}: {
  row: DomainPortfolioRow;
  expanded: boolean;
  onToggle: () => void;
  onApplyPatch: (id: string, patch: DomainPortfolioPatch) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    domain_name: row.domain_name ?? "",
    registrar: row.registrar ?? "",
    annual_cost_eur: row.annual_cost_eur != null ? String(row.annual_cost_eur) : "",
    notes: row.notes ?? "",
  });

  const healthLink = healthLinkFor(row.domain_name);

  function commit(patch: DomainPortfolioPatch) {
    const prevSnapshot = {
      status: row.status,
      domain_name: row.domain_name,
      registrar: row.registrar,
      annual_cost_eur: row.annual_cost_eur,
      notes: row.notes,
    };
    onApplyPatch(row.id, patch);
    setError(null);
    startTransition(async () => {
      const result = await updateDomainPortfolioRowAction(row.id, patch);
      if (!result.ok) {
        // Roll back the optimistic update on failure.
        onApplyPatch(row.id, prevSnapshot);
        setError(result.error);
      }
    });
  }

  function commitDraft() {
    const cost = draft.annual_cost_eur.trim();
    const costNumber = cost === "" ? null : Number(cost.replace(",", "."));
    if (cost !== "" && !Number.isFinite(costNumber)) {
      setError("Cost must be a number");
      return;
    }
    commit({
      domain_name: draft.domain_name,
      registrar: draft.registrar,
      annual_cost_eur: costNumber,
      notes: draft.notes,
    });
  }

  return (
    <li>
      <div
        className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
          expanded ? "bg-slate-50" : "hover:bg-slate-50/60"
        }`}
        onClick={onToggle}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
          {row.rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-900">
              {row.tld}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              {TLD_TYPE_LABEL[row.tld_type]}
            </span>
            {row.is_global_hack ? (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                global hack
              </span>
            ) : null}
            {row.registry ? (
              <span className="hidden text-[11px] text-slate-400 sm:inline">
                {row.registry}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-600">
            {row.rationale}
          </p>
        </div>

        <select
          value={row.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            commit({ status: e.target.value as DomainPortfolioStatus })
          }
          disabled={pending}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_COLOR[row.status]}`}
        >
          {(
            ["not_started", "planning", "bought", "installed", "skipped"] as DomainPortfolioStatus[]
          ).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          <div className="text-xs text-slate-700">
            <p className="text-sm text-slate-800">{row.rationale}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
              {row.registry ? <span>Registry: {row.registry}</span> : null}
              {row.market_share ? <span>Market: {row.market_share}</span> : null}
              {row.restrictions ? (
                <span className="text-amber-700">
                  Restrictions: {row.restrictions}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Domain name">
              <input
                type="text"
                placeholder={`wrenchlane${row.tld}`}
                value={draft.domain_name}
                onChange={(e) =>
                  setDraft({ ...draft, domain_name: e.target.value })
                }
                onBlur={commitDraft}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Field label="Registrar">
              <input
                type="text"
                placeholder={registrarGuess(row.tld)}
                value={draft.registrar}
                onChange={(e) =>
                  setDraft({ ...draft, registrar: e.target.value })
                }
                onBlur={commitDraft}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Field label="Annual cost (€)">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={draft.annual_cost_eur}
                onChange={(e) =>
                  setDraft({ ...draft, annual_cost_eur: e.target.value })
                }
                onBlur={commitDraft}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Field label="Notes">
              <input
                type="text"
                placeholder="Free-text…"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                onBlur={commitDraft}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap gap-3">
              {row.purchased_at ? (
                <span>Purchased {new Date(row.purchased_at).toLocaleDateString()}</span>
              ) : null}
              {row.installed_at ? (
                <span>Installed {new Date(row.installed_at).toLocaleDateString()}</span>
              ) : null}
              {healthLink ? (
                <Link
                  href={healthLink}
                  className="font-medium text-indigo-600 hover:underline"
                >
                  View domain health →
                </Link>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {pending ? <span className="text-slate-400">Saving…</span> : null}
              {error ? <span className="text-rose-600">⚠ {error}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
