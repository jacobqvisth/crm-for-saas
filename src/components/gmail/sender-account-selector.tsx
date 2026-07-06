"use client";

import { useState, useEffect } from "react";
import { Mail, AlertCircle } from "lucide-react";

export interface SenderAccount {
  id: string;
  email_address: string;
  display_name: string | null;
  daily_sends_count: number;
  max_daily_sends: number;
  remaining_capacity: number;
  status: string;
  /** True when this account belongs to the logged-in user. */
  is_own?: boolean;
}

interface SenderAccountSelectorProps {
  workspaceId: string;
  value: string | null;
  onChange: (accountId: string | null) => void;
  showCapacity?: boolean;
  /**
   * Optional override for the "Auto-rotate across all accounts" option label.
   * Use this to surface per-sequence rotation pool info, e.g. "Auto-rotate (3 of 7 accounts)".
   */
  autoRotateLabel?: string;
  /**
   * When set and no account is selected yet, preselect the logged-in user's own
   * active account once loaded. Use for interactive sends (one-off email, call
   * follow-up) where the server would default to the acting rep's account anyway —
   * this makes that default visible instead of implicit.
   */
  preferOwnDefault?: boolean;
}

export function SenderAccountSelector({
  workspaceId,
  value,
  onChange,
  showCapacity = true,
  autoRotateLabel,
  preferOwnDefault = false,
}: SenderAccountSelectorProps) {
  const [accounts, setAccounts] = useState<SenderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownDefaultApplied, setOwnDefaultApplied] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/gmail/accounts?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => {
        setAccounts(data.accounts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspaceId]);

  // One-shot: once accounts load, preselect the user's own account if nothing
  // is selected yet. Never fires again, so it can't fight a manual choice.
  useEffect(() => {
    if (!preferOwnDefault || ownDefaultApplied || loading) return;
    setOwnDefaultApplied(true);
    if (value !== null) return;
    const own = accounts.find(
      (a) => a.is_own && a.status === "active" && a.remaining_capacity > 0
    );
    if (own) onChange(own.id);
  }, [preferOwnDefault, ownDefaultApplied, loading, accounts, value, onChange]);

  if (loading) {
    return (
      <div className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-500 flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-400" />
        Loading accounts...
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="w-full border border-red-200 bg-red-50 rounded-lg px-3 py-2 text-sm text-red-700 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        No Gmail accounts connected — go to Settings → Email to connect one
      </div>
    );
  }

  const selectedAccount = accounts.find((a) => a.id === value) ?? null;

  const getOptionLabel = (account: SenderAccount) => {
    const parts = [account.email_address];
    if (showCapacity) {
      parts.push(`${account.daily_sends_count}/${account.max_daily_sends} sent today`);
    }
    if (account.status !== "active") {
      parts.push(`(${account.status})`);
    } else if (account.remaining_capacity <= 0) {
      parts.push("(limit reached)");
    }
    return parts.join(" — ");
  };

  const isUnavailable = (account: SenderAccount) =>
    account.status !== "active" || account.remaining_capacity <= 0;

  return (
    <div className="space-y-1.5">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
      >
        <option value="">{autoRotateLabel ?? "Auto-rotate across all accounts"}</option>
        {accounts.map((account) => (
          <option
            key={account.id}
            value={account.id}
            disabled={isUnavailable(account)}
          >
            {getOptionLabel(account)}
          </option>
        ))}
      </select>
      {selectedAccount && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Mail className="w-3 h-3 shrink-0" />
          All emails will be sent from{" "}
          <strong className="text-slate-700">{selectedAccount.email_address}</strong>
          {showCapacity && (
            <span className="text-slate-400">
              ({selectedAccount.remaining_capacity} sends remaining today)
            </span>
          )}
        </p>
      )}
    </div>
  );
}
