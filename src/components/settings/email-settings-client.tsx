"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { Tables, WorkspaceSendingSettings } from "@/lib/database.types";
import { ConnectGmailButton } from "./connect-gmail-button";
import { GmailAccountCard } from "./gmail-account-card";
import { ConnectChecklist } from "./connect-checklist";

type GmailAccount = Tables<"gmail_accounts">;

interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export function EmailSettingsClient() {
  const { workspaceId } = useWorkspace();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [sendingSettings, setSendingSettings] = useState<WorkspaceSendingSettings>({
    default_max_daily_sends: 50,
    bounce_threshold: 8,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const supabase = createClient();

  // Show success/error messages from OAuth callback
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    if (success) toast.success(success);
    if (error) toast.error(error);
  }, [searchParams]);

  const loadAccounts = useCallback(async () => {
    if (!workspaceId) return;

    const { data, error } = await supabase
      .from("gmail_accounts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Failed to load Gmail accounts");
      return;
    }

    setAccounts(data || []);
    setLoading(false);
  }, [workspaceId, supabase]);

  const loadSendingSettings = useCallback(async () => {
    const res = await fetch("/api/settings/sending");
    if (res.ok) {
      const data = await res.json();
      setSendingSettings(data);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadSendingSettings();
  }, [loadSendingSettings]);

  useEffect(() => {
    fetch("/api/settings/team")
      .then((r) => r.json())
      .then((data) => setTeamMembers(data.members ?? []))
      .catch(() => {});
  }, []);

  async function handleSaveWorkspaceDefaults() {
    setSavingSettings(true);
    const res = await fetch("/api/settings/sending", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendingSettings),
    });

    if (!res.ok) {
      toast.error("Failed to save workspace defaults");
    } else {
      toast.success("Workspace defaults saved");
    }
    setSavingSettings(false);
  }

  const activeAccounts = accounts.filter((a) => a.status === "active");
  const totalSendsToday = accounts.reduce((sum, a) => sum + a.daily_sends_count, 0);
  const totalCapacity = activeAccounts.reduce(
    (sum, a) => sum + Math.max(0, a.max_daily_sends - a.daily_sends_count),
    0
  );
  const totalMaxCapacity = activeAccounts.reduce(
    (sum, a) => sum + a.max_daily_sends,
    0
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Email Integration
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Connect Gmail accounts, configure sending limits, and manage
              sender rotation.
            </p>
          </div>
          <ConnectGmailButton />
        </div>
      </div>

      {/* Sending Limits Info Panel */}
      {activeAccounts.length > 0 && (
        <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-indigo-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-indigo-900">
                Sending Capacity
              </h3>
              <p className="text-sm text-indigo-700 mt-1">
                <span className="font-medium">{totalCapacity}</span> emails
                remaining today across {activeAccounts.length} active{" "}
                {activeAccounts.length === 1 ? "account" : "accounts"}{" "}
                (total max: {totalMaxCapacity}/day)
              </p>
              <p className="text-xs text-indigo-600 mt-2">
                For best deliverability, keep per-account sends under 80/day.
                Emails are automatically distributed across connected accounts.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Connected Accounts */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Connected Accounts
        </h2>

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl bg-slate-100"
              />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm text-slate-500">
              No Gmail accounts connected yet.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Connect a Gmail account to start sending emails from your CRM.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {accounts.map((account) => {
              const connectedBy = teamMembers.find((m) => m.user_id === account.user_id);
              const connectedByName = connectedBy?.full_name ?? connectedBy?.email ?? null;
              if (account.status === "setup_pending") {
                return (
                  <ConnectChecklist
                    key={account.id}
                    account={account}
                    onActivated={loadAccounts}
                  />
                );
              }
              return (
                <GmailAccountCard
                  key={account.id}
                  account={account}
                  onUpdate={loadAccounts}
                  connectedByName={teamMembers.length > 1 ? connectedByName : null}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Workspace Sending Defaults */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Workspace Defaults
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">Today&apos;s total sends</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Across all accounts
              </p>
            </div>
            <span className="text-lg font-semibold text-slate-900">{totalSendsToday}</span>
          </div>

          <div className="border-t border-slate-100 pt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Default max daily sends
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Applied to newly connected accounts
              </p>
              <input
                type="number"
                min={1}
                max={500}
                value={sendingSettings.default_max_daily_sends ?? 50}
                onChange={(e) =>
                  setSendingSettings((s) => ({
                    ...s,
                    default_max_daily_sends: Number(e.target.value),
                  }))
                }
                className="w-24 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Bounce threshold
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Auto-pause sender if bounce rate exceeds this
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={sendingSettings.bounce_threshold ?? 8}
                  onChange={(e) =>
                    setSendingSettings((s) => ({
                      ...s,
                      bounce_threshold: Number(e.target.value),
                    }))
                  }
                  className="w-20 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 flex justify-end">
            <button
              onClick={handleSaveWorkspaceDefaults}
              disabled={savingSettings}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {savingSettings ? "Saving..." : "Save defaults"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
