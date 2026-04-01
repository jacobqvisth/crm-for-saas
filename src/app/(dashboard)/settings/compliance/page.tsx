"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { ShieldCheck, Plus, Upload, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import Papa from "papaparse";
import { format } from "date-fns";

type Suppression = {
  id: string;
  email: string | null;
  domain: string | null;
  reason: string;
  source: string | null;
  active: boolean;
  created_at: string;
};

const REASON_LABELS: Record<string, string> = {
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  objection: "Objection",
  manual: "Manual",
  dnclist: "DNC List",
  gdpr_erasure: "GDPR Erasure",
};

const REASON_COLORS: Record<string, string> = {
  unsubscribed: "bg-amber-100 text-amber-700",
  bounced: "bg-red-100 text-red-700",
  objection: "bg-orange-100 text-orange-700",
  manual: "bg-slate-100 text-slate-700",
  dnclist: "bg-purple-100 text-purple-700",
  gdpr_erasure: "bg-pink-100 text-pink-700",
};

export default function CompliancePage() {
  const { workspaceId } = useWorkspace();

  const [items, setItems] = useState<Suppression[]>([]);
  const [total, setTotal] = useState(0);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [page, setPage] = useState(0);
  const [filterReason, setFilterReason] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Add email/domain dialogs
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addReason, setAddReason] = useState("manual");
  const [addSource, setAddSource] = useState("");
  const [adding, setAdding] = useState(false);

  // CSV import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const params = new URLSearchParams({
      workspaceId,
      page: String(page),
      limit: "50",
    });
    if (filterReason) params.set("reason", filterReason);
    if (search) params.set("search", search);

    const res = await fetch(`/api/settings/compliance?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
      setBreakdown(data.breakdown || {});
    }
    setLoading(false);
  }, [workspaceId, page, filterReason, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRemove = async (id: string) => {
    const res = await fetch(`/api/settings/compliance/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    if (res.ok) {
      toast.success("Suppression removed");
      fetchData();
    } else {
      toast.error("Failed to remove suppression");
    }
  };

  const handleAdd = async (type: "email" | "domain") => {
    if (!workspaceId || !addValue.trim()) return;
    setAdding(true);
    const body: Record<string, string> = {
      workspaceId,
      reason: addReason,
      source: addSource || (type === "email" ? "manual entry" : "manual domain block"),
    };
    if (type === "email") body.email = addValue.trim().toLowerCase();
    else body.domain = addValue.trim().toLowerCase();

    const res = await fetch("/api/settings/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setAdding(false);

    if (!res.ok) {
      toast.error(data.error || "Failed to add suppression");
      return;
    }

    toast.success(`${type === "email" ? "Email" : "Domain"} suppressed`);
    setAddValue("");
    setAddSource("");
    setAddReason("manual");
    setShowAddEmail(false);
    setShowAddDomain(false);
    fetchData();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!workspaceId) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const filename = file.name;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const emails: string[] = [];
        for (const row of results.data) {
          const email = row.email || row.Email || row.EMAIL || Object.values(row)[0];
          if (email && typeof email === "string" && email.includes("@")) {
            emails.push(email.trim().toLowerCase());
          }
        }

        if (emails.length === 0) {
          toast.error("No valid emails found in CSV. Ensure an 'email' column exists.");
          setImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        const res = await fetch("/api/settings/compliance/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            emails,
            reason: "dnclist",
            source: `CSV import (${filename})`,
          }),
        });

        const data = await res.json();
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";

        if (!res.ok) {
          toast.error(data.error || "Import failed");
          return;
        }

        toast.success(`Imported ${data.imported} emails, skipped ${data.skipped} duplicates`);
        fetchData();
      },
      error: () => {
        toast.error("Failed to parse CSV");
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
    });
  };

  const totalActive = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const pageCount = Math.ceil(total / 50);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/settings" className="text-sm text-indigo-600 hover:text-indigo-700">
          &larr; Settings
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Compliance & DNC</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Manage your suppression list. Suppressed addresses are never emailed, regardless of sequence enrollment.
      </p>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Suppressed" value={totalActive} />
        <StatCard label="Unsubscribed" value={breakdown.unsubscribed || 0} />
        <StatCard label="Bounced" value={breakdown.bounced || 0} />
        <StatCard label="DNC / Manual" value={(breakdown.dnclist || 0) + (breakdown.manual || 0) + (breakdown.objection || 0) + (breakdown.gdpr_erasure || 0)} />
      </div>

      {/* Actions + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => { setShowAddEmail(true); setShowAddDomain(false); setAddValue(""); setAddReason("manual"); setAddSource(""); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          Add Email
        </button>
        <button
          onClick={() => { setShowAddDomain(true); setShowAddEmail(false); setAddValue(""); setAddReason("manual"); setAddSource(""); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <Plus className="w-4 h-4" />
          Add Domain
        </button>
        <label className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer ${importing ? "opacity-50 cursor-not-allowed" : ""}`}>
          <Upload className="w-4 h-4" />
          {importing ? "Importing..." : "Import CSV"}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            disabled={importing}
            onChange={handleImport}
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={filterReason}
            onChange={(e) => { setFilterReason(e.target.value); setPage(0); }}
            className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All reasons</option>
            {Object.entries(REASON_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="Search email or domain..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(0); } }}
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
            />
            <button
              onClick={() => { setSearch(searchInput); setPage(0); }}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Add email dialog */}
      {showAddEmail && (
        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Add Email to Suppression List</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              placeholder="email@example.com"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="manual">Manual</option>
              <option value="objection">Objection</option>
              <option value="dnclist">DNC List</option>
            </select>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={addSource}
              onChange={(e) => setAddSource(e.target.value)}
              className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2 mt-3 justify-end">
            <button onClick={() => setShowAddEmail(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              onClick={() => handleAdd("email")}
              disabled={adding || !addValue.trim()}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add Email"}
            </button>
          </div>
        </div>
      )}

      {/* Add domain dialog */}
      {showAddDomain && (
        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Add Domain to Suppression List</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="example.com"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="manual">Manual</option>
              <option value="objection">Objection</option>
              <option value="dnclist">DNC List</option>
            </select>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={addSource}
              onChange={(e) => setAddSource(e.target.value)}
              className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2 mt-3 justify-end">
            <button onClick={() => setShowAddDomain(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              onClick={() => handleAdd("domain")}
              disabled={adding || !addValue.trim()}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add Domain"}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No suppressions found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email / Domain</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Reason</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden sm:table-cell">Source</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Date Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-800">
                    {item.email || item.domain}
                    {item.domain && !item.email && (
                      <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">domain</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${REASON_COLORS[item.reason] || "bg-slate-100 text-slate-700"}`}>
                      {REASON_LABELS[item.reason] || item.reason}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden sm:table-cell max-w-[200px] truncate">
                    {item.source || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell whitespace-nowrap">
                    {format(new Date(item.created_at), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove suppression"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">
              Showing {page * 50 + 1}–{Math.min((page + 1) * 50, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-600 px-1">
                {page + 1} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</p>
    </div>
  );
}
