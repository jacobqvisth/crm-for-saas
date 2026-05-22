"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { countryFlag } from "@/lib/countries";
import toast from "react-hot-toast";

type CompanySide = {
  id: string;
  name: string | null;
  country_code: string | null;
  org_number: string | null;
  domain: string | null;
  source: string | null;
  wl_workshop_id: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  lifecycle_stage: string | null;
  customer_status: string | null;
  plan: string | null;
  created_at: string;
  tags: string[] | null;
  contact_count: number;
  contact_sample: Array<{ email: string; source: string | null }>;
};

type Candidate = {
  id: string;
  similarity_score: number;
  match_signals: Record<string, unknown>;
  created_at: string;
  primary: CompanySide;
  candidate: CompanySide;
};

export function DuplicatesPageClient() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    const { data: candidates, error } = await supabase
      .from("company_merge_candidates")
      .select(
        "id, similarity_score, match_signals, created_at, primary_company_id, candidate_company_id",
      )
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .order("similarity_score", { ascending: false });

    if (error) {
      toast.error(`Failed to load candidates: ${error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    const companyIds = new Set<string>();
    for (const c of candidates ?? []) {
      companyIds.add(c.primary_company_id);
      companyIds.add(c.candidate_company_id);
    }
    if (companyIds.size === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data: companies } = await supabase
      .from("companies")
      .select(
        "id, name, country_code, org_number, domain, source, wl_workshop_id, city, address, phone, lifecycle_stage, customer_status, plan, created_at, tags",
      )
      .in("id", Array.from(companyIds));

    const byId = new Map<string, CompanySide>();
    for (const c of companies ?? []) {
      byId.set(c.id, {
        ...(c as Omit<CompanySide, "contact_count" | "contact_sample">),
        contact_count: 0,
        contact_sample: [],
      });
    }

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, email, source, company_id")
      .in("company_id", Array.from(companyIds));

    for (const c of contacts ?? []) {
      if (!c.company_id) continue;
      const side = byId.get(c.company_id);
      if (!side) continue;
      side.contact_count += 1;
      if (side.contact_sample.length < 3) {
        side.contact_sample.push({
          email: c.email ?? "",
          source: c.source,
        });
      }
    }

    const built: Candidate[] = [];
    for (const cand of candidates ?? []) {
      const primary = byId.get(cand.primary_company_id);
      const candidate = byId.get(cand.candidate_company_id);
      if (!primary || !candidate) continue;
      built.push({
        id: cand.id,
        similarity_score: Number(cand.similarity_score),
        match_signals: (cand.match_signals as Record<string, unknown>) ?? {},
        created_at: cand.created_at,
        primary,
        candidate,
      });
    }
    setRows(built);
    setLoading(false);
  }, [supabase, workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMerge(row: Candidate, keepSide: "primary" | "candidate") {
    setPendingId(row.id);
    const keepId = keepSide === "primary" ? row.primary.id : row.candidate.id;
    const dropId = keepSide === "primary" ? row.candidate.id : row.primary.id;
    try {
      const res = await fetch(
        `/api/companies/merge-candidates/${row.id}/merge`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keepId, dropId }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Merge failed");
        return;
      }
      toast.success(
        `Merged. Moved ${body.contactsMoved} contact${body.contactsMoved === 1 ? "" : "s"}.`,
      );
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDismiss(row: Candidate) {
    setPendingId(row.id);
    try {
      const res = await fetch(
        `/api/companies/merge-candidates/${row.id}/dismiss`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Dismiss failed");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dismiss failed");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Link
            href="/companies"
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Companies
          </Link>
          <h1 className="text-xl font-semibold text-slate-900">
            Duplicate companies
          </h1>
          <p className="text-sm text-slate-500">
            Pairs flagged by trigram similarity between 0.6 and 0.95. Pick the
            row to keep — contacts, deals, and activities from the other row
            move over. Nothing is overwritten on the kept row except merged
            tags.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded border border-dashed border-slate-200 p-12 text-center text-sm text-slate-500">
          No pending duplicates. New fuzzy matches show up here whenever the
          hourly cron picks up a wl-app signup that looks similar to an
          existing prospect row.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Similarity {(row.similarity_score * 100).toFixed(0)}% · queued{" "}
                  {new Date(row.created_at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleDismiss(row)}
                  disabled={pendingId === row.id}
                  className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <X className="h-3 w-3" /> Not duplicates
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr]">
                <CompanyCard
                  side="primary"
                  company={row.primary}
                  onKeep={() => handleMerge(row, "primary")}
                  pending={pendingId === row.id}
                />
                <div className="hidden items-center justify-center text-slate-400 md:flex">
                  <ArrowRight className="h-5 w-5" />
                </div>
                <CompanyCard
                  side="candidate"
                  company={row.candidate}
                  onKeep={() => handleMerge(row, "candidate")}
                  pending={pendingId === row.id}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompanyCard({
  side,
  company,
  onKeep,
  pending,
}: {
  side: "primary" | "candidate";
  company: CompanySide;
  onKeep: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-slate-400" />
        <Link
          href={`/companies/${company.id}`}
          className="font-medium text-slate-900 hover:underline"
        >
          {company.name ?? "(no name)"}
        </Link>
        {company.country_code && (
          <span className="text-sm">{countryFlag(company.country_code)}</span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
        {company.org_number && (
          <>
            <dt className="text-slate-400">Org #</dt>
            <dd>{company.org_number}</dd>
          </>
        )}
        {company.domain && (
          <>
            <dt className="text-slate-400">Domain</dt>
            <dd>{company.domain}</dd>
          </>
        )}
        {company.city && (
          <>
            <dt className="text-slate-400">City</dt>
            <dd>{company.city}</dd>
          </>
        )}
        {company.phone && (
          <>
            <dt className="text-slate-400">Phone</dt>
            <dd>{company.phone}</dd>
          </>
        )}
        <dt className="text-slate-400">Source</dt>
        <dd>{company.source ?? "—"}</dd>
        {company.wl_workshop_id && (
          <>
            <dt className="text-slate-400">WL workshop</dt>
            <dd className="truncate" title={company.wl_workshop_id}>
              {company.wl_workshop_id.slice(0, 8)}…
            </dd>
          </>
        )}
        {company.plan && (
          <>
            <dt className="text-slate-400">Plan</dt>
            <dd>{company.plan}</dd>
          </>
        )}
        {company.lifecycle_stage && (
          <>
            <dt className="text-slate-400">Lifecycle</dt>
            <dd>{company.lifecycle_stage}</dd>
          </>
        )}
        <dt className="text-slate-400">Contacts</dt>
        <dd>{company.contact_count}</dd>
      </dl>
      {company.contact_sample.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-500">
          {company.contact_sample.map((c, idx) => (
            <li key={`${company.id}-c-${idx}`} className="truncate">
              {c.email} {c.source ? `· ${c.source}` : ""}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onKeep}
        disabled={pending}
        className="mt-2 flex items-center justify-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        <Check className="h-3 w-3" /> Keep this {side === "primary" ? "row" : "row"}
      </button>
    </div>
  );
}
