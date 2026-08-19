"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Handshake, Loader2, Plus, Search, X } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";

// Manage companies.is_partner — companies we already work with (KGK, Bilia,
// MEKO, …). Flagged companies stay fully visible in the CRM but are excluded
// from outreach via the "Partner companies" exclusion group: by company AND by
// their email domain (see src/lib/lists/exclusions.ts). The Call Planner
// always filters them; call/email lists get a default-on checkbox.

type PartnerRow = {
  id: string;
  name: string;
  domain: string | null;
  city: string | null;
  country_code: string | null;
  contacts: { count: number }[];
};

const ROW_SELECT = "id, name, domain, city, country_code, contacts(count)";

export default function PartnerCompaniesSettingsPage() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PartnerRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPartners = useCallback(async () => {
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from("companies")
      .select(ROW_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("is_partner", true)
      .order("name");
    if (error) {
      toast.error("Failed to load partner companies");
      return;
    }
    setPartners((data ?? []) as unknown as PartnerRow[]);
  }, [workspaceId, supabase]);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    loadPartners().finally(() => setLoading(false));
  }, [workspaceId, loadPartners]);

  // Debounced company search over non-partners (by name or domain).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (!workspaceId || q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const escaped = q.replace(/[%_,()]/g, "");
      const { data } = await supabase
        .from("companies")
        .select(ROW_SELECT)
        .eq("workspace_id", workspaceId)
        .eq("is_partner", false)
        .or(`name.ilike.%${escaped}%,domain.ilike.%${escaped}%`)
        .order("name")
        .limit(15);
      setResults((data ?? []) as unknown as PartnerRow[]);
      setSearching(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, workspaceId, supabase]);

  const setPartnerFlag = async (company: PartnerRow, isPartner: boolean) => {
    if (!workspaceId) {
      toast.error("No workspace");
      return;
    }
    setBusyId(company.id);
    const { error } = await supabase
      .from("companies")
      .update({ is_partner: isPartner })
      .eq("id", company.id)
      .eq("workspace_id", workspaceId);
    setBusyId(null);
    if (error) {
      toast.error(`Failed to update ${company.name}`);
      return;
    }
    toast.success(
      isPartner
        ? `${company.name} added — excluded from outreach lists`
        : `${company.name} removed — back in the calling pool`,
    );
    setResults((prev) => prev.filter((r) => r.id !== company.id));
    await loadPartners();
  };

  const contactCount = (row: PartnerRow) => row.contacts?.[0]?.count ?? 0;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <Handshake className="w-5 h-5 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Partner Companies</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Companies you already work with. They stay in the CRM, but the Call Planner always skips
        them and new call lists exclude them by default (the &ldquo;Partner companies&rdquo;
        checkbox — untick it on a list to include them). A partner with a domain also excludes
        everyone using that email domain.
      </p>

      {/* Add a partner */}
      <div className="mb-8">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Add a company
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies by name or domain…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {search.trim().length >= 2 && (
          <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
            {searching ? (
              <div className="flex items-center gap-2 p-3 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <p className="p-3 text-sm text-slate-400">
                No matching companies (already-added partners are hidden).
              </p>
            ) : (
              results.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{r.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {[r.domain, r.city, r.country_code].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <button
                    onClick={() => setPartnerFlag(r, true)}
                    disabled={busyId === r.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex-shrink-0"
                  >
                    {busyId === r.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    Add partner
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Current partners */}
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Current partners
        </label>
        {!loading && (
          <span className="text-xs text-slate-400">
            {partners.length} compan{partners.length === 1 ? "y" : "ies"}
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : partners.length === 0 ? (
        <p className="p-4 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
          No partner companies yet — search above to add the companies you already work with.
        </p>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
          {partners.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <Link
                  href={`/companies/${p.id}`}
                  className="text-sm font-medium text-slate-900 hover:text-indigo-600 truncate block"
                >
                  {p.name}
                </Link>
                <p className="text-xs text-slate-500 truncate">
                  {[
                    p.domain,
                    p.city,
                    p.country_code,
                    `${contactCount(p)} contact${contactCount(p) === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                onClick={() => setPartnerFlag(p, false)}
                disabled={busyId === p.id}
                title="Remove from partners (back in the calling pool)"
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 hover:text-rose-600 disabled:opacity-50 flex-shrink-0"
              >
                {busyId === p.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <X className="w-3.5 h-3.5" />
                )}
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
