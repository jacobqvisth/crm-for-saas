"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AtSign,
  Building2,
  ChevronLeft,
  FlaskConical,
  Globe,
  Handshake,
  Loader2,
  PhoneOff,
  Plus,
  Search,
  ShieldOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";

// Exclusion Lists — one settings surface for every "don't contact these" set:
//
//   Partner companies -> companies.is_partner. Kept in the CRM, but the Call
//                        Planner always skips them and lists exclude them via
//                        the default-on "Partner companies" checkbox.
//   Never-call list   -> the managed call_exclusions rows (domain / email /
//                        company). Always-on for every calling surface,
//                        optional checkbox on email lists. The Call Planner
//                        page has a smaller inline editor for the same list.
//   Internal testers  -> the global dashboard internal-test sets (users /
//                        workshops / patterns) that statistics already exclude.
//                        Edited via /api/settings/internal-testers, which wraps
//                        the /dashboard/settings server actions behind the same
//                        CEO email gate.
//
// All of them feed the exclusion groups in src/lib/lists/exclusions.ts.

type TabKey = "partners" | "never_call" | "internal";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "partners", label: "Partner companies", icon: Handshake },
  { key: "never_call", label: "Never-call list", icon: PhoneOff },
  { key: "internal", label: "Internal testers", icon: FlaskConical },
];

export default function ExclusionListsSettingsPage() {
  return (
    <Suspense>
      <ExclusionListsInner />
    </Suspense>
  );
}

function ExclusionListsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabKey =
    tabParam === "never_call" || tabParam === "internal" ? tabParam : "partners";

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
        <ShieldOff className="w-5 h-5 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Exclusion Lists</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Who outreach should skip. Everyone here stays in the CRM — these lists only control who
        ends up in call lists, sequences, and the Call Planner.
      </p>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => router.replace(`/settings/exclusions?tab=${t.key}`)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                active
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "partners" ? (
        <PartnersTab />
      ) : tab === "never_call" ? (
        <NeverCallTab />
      ) : (
        <InternalTestersTab />
      )}
    </div>
  );
}

// ── Partner companies ─────────────────────────────────────────────────────────

type PartnerRow = {
  id: string;
  name: string;
  domain: string | null;
  city: string | null;
  country_code: string | null;
  contacts: { count: number }[];
};

const PARTNER_SELECT = "id, name, domain, city, country_code, contacts(count)";

function PartnersTab() {
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
      .select(PARTNER_SELECT)
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
        .select(PARTNER_SELECT)
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
    <div>
      <p className="text-sm text-slate-500 mb-6">
        Companies you already work with. The Call Planner always skips them; new call lists exclude
        them by default (the &ldquo;Partner companies&rdquo; checkbox — untick it on a list to
        include them). A partner with a domain also excludes everyone using that email domain.
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

// ── Never-call list ───────────────────────────────────────────────────────────
// Same call_exclusions rows the Call Planner's inline editor manages, via the
// same /api/calls/exclusions endpoints.

type ExclusionKind = "domain" | "email" | "company";
type Exclusion = { id: string; kind: ExclusionKind; value: string; label: string | null };
type CompanyHit = { id: string; name: string };

const KIND_ICON: Record<ExclusionKind, LucideIcon> = {
  domain: Globe,
  email: AtSign,
  company: Building2,
};

function NeverCallTab() {
  const { workspaceId } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Exclusion[]>([]);
  const [input, setInput] = useState("");
  const [companyHits, setCompanyHits] = useState<CompanyHit[]>([]);
  const [saving, setSaving] = useState(false);

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/calls/exclusions");
      if (!res.ok) throw new Error();
      setEntries((await res.json()).exclusions ?? []);
    } catch {
      toast.error("Failed to load the never-call list");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadEntries().finally(() => setLoading(false));
  }, [loadEntries]);

  // A free-typed value is a domain or email; company matches come from a live
  // search of the workspace's companies (browser client, RLS-scoped).
  const typed = input.trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed);
  const looksLikeDomain =
    !looksLikeEmail && /^[^\s@]+\.[^\s@]+$/.test(typed.replace(/^https?:\/\//, ""));

  useEffect(() => {
    const q = input.trim();
    if (!workspaceId || q.length < 2 || q.includes("@")) {
      setCompanyHits([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("companies")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .ilike("name", `%${q}%`)
        .limit(6);
      if (active) setCompanyHits((rows ?? []).filter((r) => r.name) as CompanyHit[]);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [input, workspaceId]);

  const addEntry = async (kind: ExclusionKind, value: string, label?: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/calls/exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value, label }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add");
      setInput("");
      setCompanyHits([]);
      await loadEntries();
      toast.success(`Excluded ${json.exclusion?.label ?? value}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry: Exclusion) => {
    try {
      const res = await fetch(`/api/calls/exclusions?id=${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      toast.success(`Removed ${entry.label ?? entry.value}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  return (
    <div>
      <p className="text-sm text-slate-500 mb-6">
        Competitors, your own domains, and anyone who should never be called. Always applied to
        every calling surface (planner, call lists, worklists); an optional checkbox on email
        lists. Add a whole email domain, a single address, or a company.
      </p>

      {/* Add an entry */}
      <div className="mb-8">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Add an exclusion
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a domain (mekonomen.se), an email, or search a company…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {(looksLikeEmail || looksLikeDomain || companyHits.length > 0) && (
          <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
            {looksLikeEmail && (
              <AddRow
                icon={AtSign}
                label={typed.toLowerCase()}
                hint="Exclude this email address"
                disabled={saving}
                onAdd={() => addEntry("email", typed)}
              />
            )}
            {looksLikeDomain && (
              <AddRow
                icon={Globe}
                label={typed.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")}
                hint="Exclude everyone at this email domain"
                disabled={saving}
                onAdd={() => addEntry("domain", typed)}
              />
            )}
            {companyHits.map((c) => (
              <AddRow
                key={c.id}
                icon={Building2}
                label={c.name}
                hint="Exclude every contact at this company"
                disabled={saving}
                onAdd={() => addEntry("company", c.id, c.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Current entries */}
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Never-call entries
        </label>
        {!loading && (
          <span className="text-xs text-slate-400">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"}
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : entries.length === 0 ? (
        <p className="p-4 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
          No never-call entries yet — add a domain, email, or company above.
        </p>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
          {entries.map((e) => {
            const Icon = KIND_ICON[e.kind];
            return (
              <div key={e.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {e.label ?? e.value}
                    </p>
                    <p className="text-xs text-slate-500 capitalize">{e.kind}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeEntry(e)}
                  title="Remove from the never-call list"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 hover:text-rose-600 flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Internal testers ──────────────────────────────────────────────────────────
// The same dashboard internal-test sets statistics exclude. Reads and flag
// flips go through /api/settings/internal-testers (CEO-email-gated), which
// delegates to the /dashboard/settings server actions. The full editor there
// additionally supports notes and add-by-id.

type InternalKind = "users" | "workshops" | "patterns";

type InternalUserRow = {
  internalUserId: string;
  workshopId: string | null;
  name: string | null;
  emailDomain: string | null;
  username: string | null;
  isInternalTest: boolean;
  isInternalTestExempt: boolean;
  internalTestNote: string | null;
};

type InternalWorkshopRow = {
  workshopId: string;
  name: string | null;
  country: string | null;
  isInternalTest: boolean;
  internalTestNote: string | null;
};

type PatternRow = {
  id: string;
  kind: "email" | "username";
  value: string;
  note: string | null;
};

const INTERNAL_SUB_TABS: { key: InternalKind; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "workshops", label: "Workshops" },
  { key: "patterns", label: "Email / username patterns" },
];

function InternalTestersTab() {
  const [kind, setKind] = useState<InternalKind>("users");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<InternalUserRow[]>([]);
  const [workshops, setWorkshops] = useState<InternalWorkshopRow[]>([]);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [patternKind, setPatternKind] = useState<"email" | "username">("email");
  const [patternValue, setPatternValue] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (k: InternalKind, q: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ kind: k });
        if (q) params.set("q", q);
        const res = await fetch(`/api/settings/internal-testers?${params}`);
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (k === "users") setUsers(json.users ?? []);
        else if (k === "workshops") setWorkshops(json.workshops ?? []);
        else setPatterns(json.patterns ?? []);
      } catch {
        toast.error("Failed to load internal testers");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Load on sub-tab switch, and debounce the search box.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(kind, query.trim()), query ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [kind, query, load]);

  const mutate = async (busy: string, body: Record<string, unknown>) => {
    setBusyId(busy);
    try {
      const res = await fetch("/api/settings/internal-testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      await load(kind, query.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  if (forbidden) {
    return (
      <p className="p-4 text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
        Your account isn&apos;t on the dashboard allow-list, so the internal-tester sets can&apos;t
        be edited from here.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">
        The team &amp; test accounts that statistics already exclude — the same set the
        &ldquo;Internal test users&rdquo; list checkbox subtracts. Flag whole workshops, individual
        users (with per-user <em>Exempt</em> overrides), or fallback email/username patterns.{" "}
        <Link
          href="/dashboard/settings?tab=internal"
          className="text-indigo-600 hover:underline"
        >
          Full editor
        </Link>{" "}
        adds notes and flag-by-id.
      </p>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1.5 mb-4">
        {INTERNAL_SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setKind(t.key);
              setQuery("");
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
              kind === t.key
                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {kind !== "patterns" && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              kind === "users"
                ? "Search users by name, id, workshop, or note… (empty = recently flagged)"
                : "Search workshops by name, id, or note… (empty = recently flagged)"
            }
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      {kind === "patterns" && (
        <div className="flex items-center gap-2 mb-4">
          <select
            value={patternKind}
            onChange={(e) => setPatternKind(e.target.value as "email" | "username")}
            className="px-2 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="email">Email</option>
            <option value="username">Username</option>
          </select>
          <input
            type="text"
            value={patternValue}
            onChange={(e) => setPatternValue(e.target.value)}
            placeholder={patternKind === "email" ? "someone@wrenchlane.com" : "test-account"}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={async () => {
              const value = patternValue.trim();
              if (!value) return;
              await mutate("add-pattern", { action: "add_pattern", kind: patternKind, value });
              setPatternValue("");
            }}
            disabled={busyId === "add-pattern" || !patternValue.trim()}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {busyId === "add-pattern" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Add pattern
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : kind === "users" ? (
        users.length === 0 ? (
          <p className="p-4 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
            No matching users.
          </p>
        ) : (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
            {users.map((u) => (
              <div key={u.internalUserId} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {u.name || u.username || u.internalUserId}
                    {u.isInternalTest && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700">
                        Internal
                      </span>
                    )}
                    {u.isInternalTestExempt && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">
                        Exempt
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {[u.emailDomain, u.workshopId, u.internalTestNote].filter(Boolean).join(" · ") ||
                      u.internalUserId}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() =>
                      mutate(u.internalUserId, {
                        action: "set_user_internal",
                        userId: u.internalUserId,
                        isInternal: !u.isInternalTest,
                      })
                    }
                    disabled={busyId === u.internalUserId}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50"
                  >
                    {u.isInternalTest ? "Unflag internal" : "Flag internal"}
                  </button>
                  <button
                    onClick={() =>
                      mutate(`${u.internalUserId}-exempt`, {
                        action: "set_user_exempt",
                        userId: u.internalUserId,
                        isExempt: !u.isInternalTestExempt,
                      })
                    }
                    disabled={busyId === `${u.internalUserId}-exempt`}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50"
                  >
                    {u.isInternalTestExempt ? "Clear exempt" : "Exempt"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : kind === "workshops" ? (
        workshops.length === 0 ? (
          <p className="p-4 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
            No matching workshops.
          </p>
        ) : (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
            {workshops.map((w) => (
              <div key={w.workshopId} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {w.name || w.workshopId}
                    {w.isInternalTest && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700">
                        Internal
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {[w.country, w.internalTestNote].filter(Boolean).join(" · ") || w.workshopId}
                  </p>
                </div>
                <button
                  onClick={() =>
                    mutate(w.workshopId, {
                      action: "set_workshop_internal",
                      workshopId: w.workshopId,
                      isInternal: !w.isInternalTest,
                    })
                  }
                  disabled={busyId === w.workshopId}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 flex-shrink-0"
                >
                  {w.isInternalTest ? "Unflag internal" : "Flag internal"}
                </button>
              </div>
            ))}
          </div>
        )
      ) : patterns.length === 0 ? (
        <p className="p-4 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
          No patterns yet — add an email or username pattern above.
        </p>
      ) : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
          {patterns.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <AtSign className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{p.value}</p>
                  <p className="text-xs text-slate-500 capitalize">
                    {[p.kind, p.note].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <button
                onClick={() => mutate(p.id, { action: "remove_pattern", id: p.id })}
                disabled={busyId === p.id}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 hover:text-rose-600 disabled:opacity-50 flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddRow({
  icon: Icon,
  label,
  hint,
  disabled,
  onAdd,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{label}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>
      <button
        onClick={onAdd}
        disabled={disabled}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex-shrink-0"
      >
        {disabled ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Exclude
      </button>
    </div>
  );
}
