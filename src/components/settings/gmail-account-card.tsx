"use client";

import { useState } from "react";
import {
  Mail,
  Trash2,
  RefreshCw,
  Play,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

type CheckLevel = "good" | "warn" | "error" | "neutral";
interface CheckResult {
  level: CheckLevel;
  label: string;
  detail?: string | null;
  value?: string | null;
}
interface HealthCheckResponse {
  domain: string;
  email: string;
  overall: CheckLevel;
  summary: string;
  checks: { auth: CheckResult[]; stats: CheckResult[] };
}

const LEVEL_STYLE: Record<CheckLevel, { icon: typeof CheckCircle2; className: string; label: string }> = {
  good: { icon: CheckCircle2, className: "text-green-600", label: "OK" },
  warn: { icon: AlertTriangle, className: "text-yellow-600", label: "Warning" },
  error: { icon: XCircle, className: "text-red-600", label: "Issue" },
  neutral: { icon: MinusCircle, className: "text-slate-400", label: "—" },
};

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
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);

  async function handleCheckHealth() {
    setCheckingHealth(true);
    setHealth(null);
    try {
      const res = await fetch(`/api/gmail/accounts/${account.id}/health-check`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Health check failed");
        return;
      }
      const data: HealthCheckResponse = await res.json();
      setHealth(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Health check failed");
    } finally {
      setCheckingHealth(false);
    }
  }

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

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 flex-wrap">
        <button
          onClick={handleCheckHealth}
          disabled={checkingHealth}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors"
        >
          {checkingHealth ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {checkingHealth ? "Checking..." : "Check health"}
        </button>
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

      {/* Health check results */}
      {health && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start gap-2 mb-3">
            {(() => {
              const Icon = LEVEL_STYLE[health.overall].icon;
              return <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${LEVEL_STYLE[health.overall].className}`} />;
            })()}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-900">{health.summary}</p>
              <p className="text-xs text-slate-500 mt-0.5">Domain: {health.domain}</p>
            </div>
            <button
              onClick={() => setHealth(null)}
              className="text-xs text-slate-400 hover:text-slate-600"
              title="Dismiss"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Authentication (DNS)</p>
            {health.checks.auth.map((c) => (
              <CheckRow key={c.label} check={c} />
            ))}
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium pt-2">Sending stats (last 30 days)</p>
            {health.checks.stats.map((c) => (
              <CheckRow key={c.label} check={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: CheckResult }) {
  const style = LEVEL_STYLE[check.level];
  const Icon = style.icon;
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${style.className}`} />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-slate-700">{check.label}:</span>{" "}
        <span className="text-slate-600">{check.detail ?? "—"}</span>
      </div>
    </div>
  );
}
