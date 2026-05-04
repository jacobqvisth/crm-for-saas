"use client";

import { useState } from "react";
import { Mail, Trash2, RefreshCw, Play } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

interface GmailAccountCardProps {
  account: GmailAccount;
  onUpdate: () => void;
  connectedByName?: string | null;
}

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "bg-green-100", text: "text-green-700", label: "Active" },
  paused: { bg: "bg-red-100", text: "text-red-700", label: "Paused" },
  disconnected: { bg: "bg-slate-100", text: "text-slate-600", label: "Disconnected" },
  rate_limited: { bg: "bg-yellow-100", text: "text-yellow-700", label: "Rate Limited" },
};

export function GmailAccountCard({ account, onUpdate, connectedByName }: GmailAccountCardProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [maxSends, setMaxSends] = useState(account.max_daily_sends);
  const [savingLimit, setSavingLimit] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(
    account.min_send_interval_seconds ?? 60
  );
  const [savingInterval, setSavingInterval] = useState(false);

  const status = statusColors[account.status] || statusColors.disconnected;
  const sendPercentage = Math.min(
    100,
    Math.round((account.daily_sends_count / account.max_daily_sends) * 100)
  );

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect this Gmail account?")) return;

    setDisconnecting(true);
    const res = await fetch(`/api/settings/email/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disconnected" }),
    });

    if (!res.ok) {
      toast.error("Failed to disconnect account");
    } else {
      toast.success("Account disconnected");
      onUpdate();
    }
    setDisconnecting(false);
  }

  async function handleResume() {
    setResuming(true);
    const res = await fetch(`/api/settings/email/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });

    if (!res.ok) {
      toast.error("Failed to resume account");
    } else {
      toast.success("Account resumed");
      onUpdate();
    }
    setResuming(false);
  }

  async function handleUpdateMaxSends() {
    if (maxSends === account.max_daily_sends) return;
    if (maxSends < 1 || maxSends > 500) {
      toast.error("Daily limit must be between 1 and 500");
      return;
    }

    setSavingLimit(true);
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
    setSavingLimit(false);
  }

  async function handleUpdateInterval() {
    if (intervalSeconds === (account.min_send_interval_seconds ?? 60)) return;
    if (intervalSeconds < 30 || intervalSeconds > 3600) {
      toast.error("Interval must be between 30 and 3600 seconds");
      return;
    }

    setSavingInterval(true);
    const res = await fetch(`/api/settings/email/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ min_send_interval_seconds: intervalSeconds }),
    });

    if (!res.ok) {
      toast.error("Failed to update interval");
    } else {
      toast.success("Send interval updated");
      onUpdate();
    }
    setSavingInterval(false);
  }

  function handleReconnect() {
    window.location.href = "/api/auth/gmail/connect";
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
            <Mail className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {account.email_address}
            </p>
            {account.display_name && (
              <p className="text-xs text-slate-500">{account.display_name}</p>
            )}
            {connectedByName && (
              <p className="text-xs text-slate-400 mt-0.5">Connected by {connectedByName}</p>
            )}
          </div>
        </div>

        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg} ${status.text}`}
        >
          {status.label}
        </span>
      </div>

      {/* Pause reason */}
      {account.status === "paused" && account.pause_reason && (
        <div className="mt-3 rounded-md bg-red-50 border border-red-100 px-3 py-2">
          <p className="text-xs text-red-700">{account.pause_reason}</p>
        </div>
      )}

      {/* Daily sends progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>Daily sends</span>
          <span>
            {account.daily_sends_count} / {account.max_daily_sends}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
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
      </div>

      {/* Max daily sends input */}
      <div className="mt-4 flex items-center gap-2">
        <label className="text-xs text-slate-500 whitespace-nowrap">
          Max daily sends:
        </label>
        <input
          type="number"
          min={1}
          max={500}
          value={maxSends}
          onChange={(e) => setMaxSends(Number(e.target.value))}
          className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
        {maxSends !== account.max_daily_sends && (
          <button
            onClick={handleUpdateMaxSends}
            disabled={savingLimit}
            className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
          >
            {savingLimit ? "Saving..." : "Save"}
          </button>
        )}
      </div>

      {/* Min send interval input */}
      <div className="mt-2 flex items-center gap-2">
        <label
          className="text-xs text-slate-500 whitespace-nowrap"
          title="Minimum seconds between two consecutive sends from this account. Raise for warm/established inboxes; keep low for fresh ones."
        >
          Min seconds between sends:
        </label>
        <input
          type="number"
          min={30}
          max={3600}
          step={30}
          value={intervalSeconds}
          onChange={(e) => setIntervalSeconds(Number(e.target.value))}
          className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
        {intervalSeconds !== (account.min_send_interval_seconds ?? 60) && (
          <button
            onClick={handleUpdateInterval}
            disabled={savingInterval}
            className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
          >
            {savingInterval ? "Saving..." : "Save"}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
        {account.status === "paused" ? (
          <button
            onClick={handleResume}
            disabled={resuming}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            {resuming ? "Resuming..." : "Resume"}
          </button>
        ) : account.status === "disconnected" ? (
          <button
            onClick={handleReconnect}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reconnect
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </button>
        )}
      </div>
    </div>
  );
}
