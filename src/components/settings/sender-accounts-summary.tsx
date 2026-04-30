"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Mail, ArrowRight, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "bg-green-100", text: "text-green-700", label: "Active" },
  paused: { bg: "bg-red-100", text: "text-red-700", label: "Paused" },
  disconnected: { bg: "bg-slate-100", text: "text-slate-600", label: "Disconnected" },
  rate_limited: { bg: "bg-yellow-100", text: "text-yellow-700", label: "Rate Limited" },
};

export function SenderAccountsSummary() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from("gmail_accounts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Failed to load Gmail accounts");
      setLoading(false);
      return;
    }
    setAccounts(data || []);
    setLoading(false);
  }, [workspaceId, supabase]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
        <p className="text-sm text-slate-500">No Gmail accounts connected.</p>
        <Link
          href="/settings/email"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          Connect a Gmail account <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
      {accounts.map((account) => (
        <SenderRow key={account.id} account={account} onUpdate={loadAccounts} />
      ))}
      <div className="px-4 py-2.5 bg-slate-50 rounded-b-xl">
        <Link
          href="/settings/email"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          Manage all sender accounts <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function SenderRow({
  account,
  onUpdate,
}: {
  account: GmailAccount;
  onUpdate: () => void;
}) {
  const [maxSends, setMaxSends] = useState(account.max_daily_sends);
  const [saving, setSaving] = useState(false);
  const status = STATUS_STYLES[account.status] || STATUS_STYLES.disconnected;
  const sendPercentage = Math.min(
    100,
    Math.round((account.daily_sends_count / Math.max(1, account.max_daily_sends)) * 100)
  );

  async function handleSaveLimit() {
    if (maxSends === account.max_daily_sends) return;
    if (maxSends < 1 || maxSends > 500) {
      toast.error("Daily limit must be between 1 and 500");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/settings/email/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_daily_sends: maxSends }),
    });
    if (!res.ok) {
      toast.error("Failed to update limit");
    } else {
      toast.success("Daily limit updated");
      onUpdate();
    }
    setSaving(false);
  }

  return (
    <div className="px-4 py-3 flex items-center gap-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 shrink-0">
        <Mail className="h-4 w-4 text-slate-600" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-900 truncate">
            {account.email_address}
          </p>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text}`}
          >
            {status.label}
          </span>
        </div>

        {account.status === "paused" && account.pause_reason && (
          <p className="mt-1 flex items-start gap-1 text-xs text-red-600">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="truncate">{account.pause_reason}</span>
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 w-32 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                sendPercentage >= 90
                  ? "bg-red-500"
                  : sendPercentage >= 70
                    ? "bg-yellow-500"
                    : "bg-indigo-500"
              }`}
              style={{ width: `${sendPercentage}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 tabular-nums">
            {account.daily_sends_count} / {account.max_daily_sends}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <label className="text-xs text-slate-500 hidden sm:inline">Limit</label>
        <input
          type="number"
          min={1}
          max={500}
          value={maxSends}
          onChange={(e) => setMaxSends(Number(e.target.value))}
          className="w-16 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-900 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
        {maxSends !== account.max_daily_sends && (
          <button
            onClick={handleSaveLimit}
            disabled={saving}
            className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
          >
            {saving ? "…" : "Save"}
          </button>
        )}
      </div>
    </div>
  );
}
