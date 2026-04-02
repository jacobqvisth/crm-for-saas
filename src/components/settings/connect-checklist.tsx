"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, Loader2, Mail } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";
import type { DomainCheckResult, DomainCheckStatus } from "@/lib/warmup/domain-check";

type GmailAccount = Tables<"gmail_accounts">;

interface ConnectChecklistProps {
  account: GmailAccount;
  onActivated: () => void;
}

type CheckStatus = "pending" | "loading" | "done";

const statusIcon = (s: DomainCheckStatus | undefined) => {
  if (!s) return <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />;
  if (s === "pass") return <CheckCircle className="h-3.5 w-3.5 text-green-600" />;
  if (s === "warn") return <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />;
  return <XCircle className="h-3.5 w-3.5 text-red-600" />;
};

export function ConnectChecklist({ account, onActivated }: ConnectChecklistProps) {
  const [domainCheck, setDomainCheck] = useState<DomainCheckResult | null>(
    account.domain_health && (account.domain_health as unknown as DomainCheckResult).checkedAt
      ? (account.domain_health as unknown as DomainCheckResult)
      : null
  );
  const [checkStatus, setCheckStatus] = useState<CheckStatus>(domainCheck ? "done" : "pending");
  const [displayName, setDisplayName] = useState(account.display_name ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    // Auto-run domain check on mount if not done
    if (!domainCheck) {
      runDomainCheck();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runDomainCheck() {
    setCheckStatus("loading");
    try {
      const res = await fetch(`/api/settings/email/${account.id}/domain-check`);
      if (res.ok) {
        const data: DomainCheckResult = await res.json();
        setDomainCheck(data);
        setCheckStatus("done");
      } else {
        setCheckStatus("done");
      }
    } catch {
      setCheckStatus("done");
    }
  }

  const spfPass = domainCheck?.spf?.status === "pass";
  const dkimPass = domainCheck?.dkim?.status === "pass";
  const authOk = spfPass && dkimPass;
  const authWarn = !authOk && domainCheck !== null;

  const canActivate = acknowledged && displayName.trim().length > 0;

  async function handleActivate() {
    setActivating(true);
    try {
      const res = await fetch(`/api/settings/email/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "active",
          display_name: displayName.trim(),
          warmup_start_date: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        toast.error("Failed to activate account");
      } else {
        toast.success("Account activated — warmup has started");
        onActivated();
      }
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-white p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
            <Mail className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{account.email_address}</p>
            <p className="text-xs text-slate-500">Connected — complete setup to activate</p>
          </div>
        </div>
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          Setup Required
        </span>
      </div>

      <div className="space-y-3 mb-5">
        {/* Step 1: Gmail connected */}
        <div className="flex items-start gap-3">
          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-slate-900">Gmail connected</p>
            <p className="text-xs text-slate-500">{account.email_address}</p>
          </div>
        </div>

        {/* Step 2: Domain authentication */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {checkStatus === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            ) : authOk ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : authWarn ? (
              <AlertCircle className="h-4 w-4 text-yellow-600" />
            ) : (
              <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900">Domain authentication</p>
            {checkStatus === "loading" && (
              <p className="text-xs text-slate-500">Checking DNS records...</p>
            )}
            {domainCheck && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["spf", "dkim", "dmarc", "mx"] as const).map((key) => {
                  const check = domainCheck[key];
                  return (
                    <span
                      key={key}
                      title={check?.detail}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium cursor-help ${
                        check?.status === "pass"
                          ? "bg-green-50 text-green-700"
                          : check?.status === "warn"
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-red-50 text-red-700"
                      }`}
                    >
                      {statusIcon(check?.status)}
                      {key.toUpperCase()}
                    </span>
                  );
                })}
                <button
                  onClick={runDomainCheck}
                  className="text-xs text-indigo-600 hover:underline ml-1"
                >
                  Re-check
                </button>
              </div>
            )}
            {!domainCheck && checkStatus === "done" && (
              <button
                onClick={runDomainCheck}
                className="mt-1 text-xs text-indigo-600 hover:underline"
              >
                Check now
              </button>
            )}
          </div>
        </div>

        {/* Step 3: Display name */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {displayName.trim() ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900">Display name</p>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice from Acme"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          </div>
        </div>

        {/* Step 4: Acknowledge warmup */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {acknowledged ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
            )}
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
            />
            <span className="text-sm text-slate-700">
              I understand this account will start with limited sending (5/day) and ramp up over 3 weeks
            </span>
          </label>
        </div>
      </div>

      {/* Domain auth warning banner */}
      {authWarn && (
        <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2">
          <p className="text-xs text-yellow-800">
            Your domain authentication has issues. You can still activate, but deliverability may be affected.
            Check Google Admin → Apps → Gmail → Authenticate email for setup instructions.
          </p>
        </div>
      )}

      <button
        onClick={handleActivate}
        disabled={!canActivate || activating}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {activating ? "Activating..." : "Activate Account"}
      </button>
    </div>
  );
}
