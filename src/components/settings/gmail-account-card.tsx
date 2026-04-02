"use client";

import { useState } from "react";
import { Mail, Trash2, RefreshCw, Play, RotateCcw, SkipForward } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";
import type { DomainCheckResult, DomainCheckStatus } from "@/lib/warmup/domain-check";
import { WARMUP_DURATION_DAYS } from "@/lib/warmup/schedule";

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
  setup_pending: { bg: "bg-blue-100", text: "text-blue-700", label: "Setup Required" },
};

function HealthBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-green-100 text-green-700 border-green-200"
      : score >= 50
        ? "bg-yellow-100 text-yellow-700 border-yellow-200"
        : "bg-red-100 text-red-700 border-red-200";

  return (
    <span
      title="Sender health score — based on bounce rate, domain auth, warmup progress, and account age"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold cursor-help ${color}`}
    >
      {score}
    </span>
  );
}

function DomainCheckPill({
  label,
  status,
  detail,
}: {
  label: string;
  status: DomainCheckStatus;
  detail: string;
}) {
  const color =
    status === "pass"
      ? "bg-green-50 text-green-700 border-green-200"
      : status === "warn"
        ? "bg-yellow-50 text-yellow-700 border-yellow-200"
        : "bg-red-50 text-red-700 border-red-200";

  const icon = status === "pass" ? "✅" : status === "warn" ? "⚠️" : "❌";

  return (
    <span
      title={detail}
      className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs font-medium cursor-help ${color}`}
    >
      {icon} {label}
    </span>
  );
}

export function GmailAccountCard({ account, onUpdate, connectedByName }: GmailAccountCardProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [maxSends, setMaxSends] = useState(account.max_daily_sends);
  const [savingLimit, setSavingLimit] = useState(false);
  const [signature, setSignature] = useState(account.signature ?? "");
  const [savingSignature, setSavingSignature] = useState(false);
  const [recheckingDomain, setRecheckingDomain] = useState(false);
  const [domainHealth, setDomainHealth] = useState<DomainCheckResult | null>(
    account.domain_health && (account.domain_health as unknown as DomainCheckResult).checkedAt
      ? (account.domain_health as unknown as DomainCheckResult)
      : null
  );
  const [showSignature, setShowSignature] = useState(false);

  const status = statusColors[account.status] ?? statusColors.disconnected;
  const sendPercentage = Math.min(
    100,
    Math.round((account.daily_sends_count / account.max_daily_sends) * 100)
  );

  const warmupStage = account.warmup_stage ?? "ramp";
  const warmupDay = account.warmup_day ?? 0;
  const targetSends = account.target_daily_sends ?? 50;
  const healthScore = account.health_score ?? 50;

  const warmupProgress = Math.min(100, Math.round((warmupDay / WARMUP_DURATION_DAYS) * 100));

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/settings/email/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res;
  }

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect this Gmail account?")) return;
    setDisconnecting(true);
    const res = await patch({ status: "disconnected" });
    if (!res.ok) toast.error("Failed to disconnect account");
    else {
      toast.success("Account disconnected");
      onUpdate();
    }
    setDisconnecting(false);
  }

  async function handleResume() {
    setResuming(true);
    const res = await patch({ status: "active" });
    if (!res.ok) toast.error("Failed to resume account");
    else {
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
    const res = await patch({ max_daily_sends: maxSends });
    if (!res.ok) toast.error("Failed to update limit");
    else {
      toast.success("Daily limit updated");
      onUpdate();
    }
    setSavingLimit(false);
  }

  async function handleSaveSignature() {
    if (signature === (account.signature ?? "")) return;
    setSavingSignature(true);
    await patch({ signature });
    setSavingSignature(false);
  }

  async function handleSkipWarmup() {
    if (
      !confirm(
        "Skipping warmup may hurt deliverability for new accounts. Continue?"
      )
    )
      return;
    const res = await patch({ warmup_stage: "manual", max_daily_sends: targetSends });
    if (!res.ok) toast.error("Failed to skip warmup");
    else {
      toast.success("Warmup skipped — manual mode enabled");
      onUpdate();
    }
  }

  async function handleResetWarmup() {
    if (
      !confirm(
        "Reset warmup? This will set your daily limit back to 5 and restart the ramp."
      )
    )
      return;
    const res = await patch({ warmup_stage: "ramp", warmup_day: 0, max_daily_sends: 5 });
    if (!res.ok) toast.error("Failed to reset warmup");
    else {
      toast.success("Warmup reset");
      onUpdate();
    }
  }

  async function handleRecheckDomain() {
    setRecheckingDomain(true);
    try {
      const res = await fetch(`/api/settings/email/${account.id}/domain-check`);
      if (res.ok) {
        const data: DomainCheckResult = await res.json();
        setDomainHealth(data);
        toast.success("Domain check updated");
      } else {
        toast.error("Domain check failed");
      }
    } catch {
      toast.error("Domain check failed");
    } finally {
      setRecheckingDomain(false);
    }
  }

  function handleReconnect() {
    window.location.href = "/api/auth/gmail/connect";
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
            <Mail className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{account.email_address}</p>
            {account.display_name && (
              <p className="text-xs text-slate-500">{account.display_name}</p>
            )}
            {connectedByName && (
              <p className="text-xs text-slate-400 mt-0.5">Connected by {connectedByName}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {account.status !== "setup_pending" && <HealthBadge score={healthScore} />}
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg} ${status.text}`}
          >
            {status.label}
          </span>
        </div>
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

      {/* Warmup progress */}
      {warmupStage === "ramp" && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="text-indigo-700 font-medium">
              Warming up — Day {warmupDay}/{WARMUP_DURATION_DAYS}
            </span>
            <span>{warmupProgress}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-400 transition-all"
              style={{ width: `${warmupProgress}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Current limit: {account.max_daily_sends}/day → Target: {targetSends}/day
          </p>
        </div>
      )}
      {warmupStage === "graduated" && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 border border-green-200">
            ✅ Warmup complete
          </span>
        </div>
      )}
      {warmupStage === "manual" && (
        <div className="mt-3">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 border border-slate-200">
            Manual mode
          </span>
        </div>
      )}

      {/* Domain health */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500">Domain auth</span>
          <button
            onClick={handleRecheckDomain}
            disabled={recheckingDomain}
            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
          >
            {recheckingDomain ? "Checking..." : "Re-check"}
          </button>
        </div>
        {domainHealth ? (
          <div className="flex flex-wrap gap-1.5">
            <DomainCheckPill
              label="SPF"
              status={domainHealth.spf.status}
              detail={domainHealth.spf.detail}
            />
            <DomainCheckPill
              label="DKIM"
              status={domainHealth.dkim.status}
              detail={domainHealth.dkim.detail}
            />
            <DomainCheckPill
              label="DMARC"
              status={domainHealth.dmarc.status}
              detail={domainHealth.dmarc.detail}
            />
            <DomainCheckPill
              label="MX"
              status={domainHealth.mx.status}
              detail={domainHealth.mx.detail}
            />
          </div>
        ) : (
          <button
            onClick={handleRecheckDomain}
            disabled={recheckingDomain}
            className="text-xs text-slate-500 hover:text-indigo-600 disabled:opacity-50"
          >
            {recheckingDomain ? "Checking..." : "Domain not checked yet — Check now"}
          </button>
        )}
      </div>

      {/* Max daily sends input */}
      <div className="mt-4 flex items-center gap-2">
        <label className="text-xs text-slate-500 whitespace-nowrap">Max daily sends:</label>
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

      {/* Signature field (collapsible) */}
      <div className="mt-4">
        <button
          onClick={() => setShowSignature((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          {showSignature ? "▲ Hide signature" : "▼ Email signature (reference)"}
        </button>
        {showSignature && (
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            onBlur={handleSaveSignature}
            placeholder="Paste your email signature here for reference..."
            rows={3}
            className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300 resize-none"
          />
        )}
        {savingSignature && <p className="text-xs text-slate-400 mt-1">Saving...</p>}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
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

        {/* Warmup controls */}
        {warmupStage === "ramp" && (
          <button
            onClick={handleSkipWarmup}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip warmup
          </button>
        )}
        {(warmupStage === "graduated" || warmupStage === "manual") && (
          <button
            onClick={handleResetWarmup}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset warmup
          </button>
        )}
      </div>
    </div>
  );
}
