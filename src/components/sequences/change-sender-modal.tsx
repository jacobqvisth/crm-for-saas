"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import type { SenderInfo } from "@/components/sequences/sequence-header";

interface GmailAccount {
  id: string;
  email_address: string;
  display_name: string | null;
  daily_sends_count: number;
  max_daily_sends: number;
  remaining_capacity: number;
  status: string;
}

interface ChangeSenderModalProps {
  sequenceId: string;
  workspaceId: string;
  currentSenders: SenderInfo[];
  enrolledCount: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function ChangeSenderModal({
  sequenceId,
  workspaceId,
  currentSenders,
  enrolledCount,
  onClose,
  onSuccess,
}: ChangeSenderModalProps) {
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [scope, setScope] = useState<"future" | "all">("future");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoadingAccounts(true);
    fetch(`/api/gmail/accounts?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => {
        const active = (data.accounts as GmailAccount[] || []).filter(
          (a) => a.status === "active"
        );
        setAccounts(active);
        // Pre-select if there's exactly one current sender
        if (currentSenders.length === 1) {
          setSelectedAccountId(currentSenders[0].id);
        }
        setLoadingAccounts(false);
      })
      .catch(() => setLoadingAccounts(false));
  }, [workspaceId, currentSenders]);

  const handleSubmit = async () => {
    if (!selectedAccountId) {
      toast.error("Please select a sender account");
      return;
    }

    // Require confirmation for "all" scope before actually submitting
    if (scope === "all" && !confirming) {
      setConfirming(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sequences/${sequenceId}/sender`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderAccountId: selectedAccountId, scope }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update sender");
        setSubmitting(false);
        return;
      }
      const selected = accounts.find((a) => a.id === selectedAccountId);
      toast.success(
        `Sender updated — ${data.queueUpdated} email${data.queueUpdated !== 1 ? "s" : ""} will now send from ${selected?.email_address ?? "new account"}`
      );
      onSuccess();
    } catch {
      toast.error("Failed to update sender");
      setSubmitting(false);
    }
  };

  const noEnrollments = enrolledCount === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Change Sender"
      maxWidth="max-w-md"
    >
      {noEnrollments ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            No contacts are enrolled yet. Pick a sender when you enroll contacts using the <strong>Enroll List</strong> or <strong>Add Contacts</strong> button.
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {currentSenders.length > 1 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                This sequence currently uses <strong>{currentSenders.length} senders</strong>. Picking one will reassign all of them.
              </p>
            </div>
          )}

          {/* Account picker */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              New sender account
            </label>
            {loadingAccounts ? (
              <div className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading accounts...
              </div>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-red-600">
                No active Gmail accounts found. Go to Settings → Email to connect one.
              </p>
            ) : (
              <select
                value={selectedAccountId}
                onChange={(e) => { setSelectedAccountId(e.target.value); setConfirming(false); }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="">Select an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email_address} — {a.daily_sends_count}/{a.max_daily_sends} sent today
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Scope picker */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Apply to
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="future"
                  checked={scope === "future"}
                  onChange={() => { setScope("future"); setConfirming(false); }}
                  className="mt-0.5 border-slate-300 text-indigo-600"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900">Future sends only</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Updates all enrollments and any scheduled queue items. Already-sent emails are untouched.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="all"
                  checked={scope === "all"}
                  onChange={() => { setScope("all"); setConfirming(false); }}
                  className="mt-0.5 border-slate-300 text-indigo-600"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900">All enrollments (including history)</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Also rewrites the sender on already-sent records. Note: sent messages remain in the original sender&apos;s Gmail outbox — only the DB record is updated.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Confirmation warning for "all" scope */}
          {confirming && scope === "all" && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">
                This will rewrite the sender on all sent email records. This could affect analytics and threading. Click <strong>Confirm &amp; Update</strong> to proceed.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || loadingAccounts || !selectedAccountId}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {submitting
                ? "Updating…"
                : confirming
                ? "Confirm & Update"
                : "Update Sender"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
