"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { X, CheckCircle, AlertTriangle, XCircle, Info } from "lucide-react";
import toast from "react-hot-toast";

interface PreflightData {
  gmailConnected: boolean;
  gmailAccount: { email: string; maxDailySends: number } | null;
  hasEmailStep: boolean;
  listMemberCount: number;
  missingEmail: number;
  missingFirstName: number;
  alreadyEnrolled: number;
  enrollableCount: number;
  suppressedCount: number;
}

interface ContactList {
  id: string;
  name: string;
  memberCount: number;
}

interface LaunchCampaignModalProps {
  sequenceId: string;
  workspaceId: string;
  onClose: () => void;
  onSuccess: (enrolledCount: number) => void;
}

export function LaunchCampaignModal({
  sequenceId,
  workspaceId,
  onClose,
  onSuccess,
}: LaunchCampaignModalProps) {
  const supabase = createClient();
  const [state, setState] = useState<"select" | "preflight">("select");
  const [lists, setLists] = useState<ContactList[]>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [enrolledCount, setEnrolledCount] = useState(0);

  useEffect(() => {
    async function fetchLists() {
      setLoadingLists(true);
      const { data } = await supabase
        .from("contact_lists")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .order("name");

      if (data) {
        const listsWithCounts = await Promise.all(
          data.map(async (list) => {
            const { count } = await supabase
              .from("contact_list_members")
              .select("id", { count: "exact", head: true })
              .eq("list_id", list.id);
            return { id: list.id, name: list.name, memberCount: count || 0 };
          })
        );
        setLists(listsWithCounts);
      }
      setLoadingLists(false);
    }
    fetchLists();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleNext = async () => {
    if (!selectedListId) return;
    setState("preflight");
    setLoadingPreflight(true);

    const res = await fetch(
      `/api/sequences/${sequenceId}/preflight?listId=${selectedListId}&workspaceId=${workspaceId}`
    );
    const data = await res.json();
    setPreflight(data);
    setLoadingPreflight(false);
  };

  const handleLaunch = async () => {
    if (!preflight) return;
    setLaunching(true);

    const { data: members } = await supabase
      .from("contact_list_members")
      .select("contact_id")
      .eq("list_id", selectedListId);

    const contactIds = (members || []).map((m) => m.contact_id);

    const res = await fetch("/api/sequences/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequenceId, contactIds, workspaceId }),
    });
    const result = await res.json();
    setLaunching(false);

    if (!res.ok) {
      toast.error(result.error || "Failed to launch campaign");
      return;
    }

    const enrolled = result.enrolled || 0;
    setEnrolledCount(enrolled);
    setLaunched(true);
    onSuccess(enrolled);
  };

  const hasBlocker = preflight && (!preflight.gmailConnected || !preflight.hasEmailStep);

  const daysEstimate =
    preflight?.gmailAccount?.maxDailySends && preflight.enrollableCount > 0
      ? Math.ceil(preflight.enrollableCount / preflight.gmailAccount.maxDailySends)
      : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Launch Campaign</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {launched ? (
            <div className="text-center py-6">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-lg font-semibold text-slate-900">Campaign Launched!</p>
              <p className="text-sm text-slate-500 mt-1">
                {enrolledCount} contact{enrolledCount !== 1 ? "s" : ""} enrolled. Emails begin
                sending within 5 minutes.
              </p>
            </div>
          ) : state === "select" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Choose a contact list
                </label>
                {loadingLists ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
                    Loading lists...
                  </div>
                ) : lists.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No contact lists found. Create one on the Lists page first.
                  </p>
                ) : (
                  <select
                    value={selectedListId}
                    onChange={(e) => setSelectedListId(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="">Select a list...</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name} ({list.memberCount} contact{list.memberCount !== 1 ? "s" : ""})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {loadingPreflight ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                </div>
              ) : preflight ? (
                <>
                  <div className="space-y-2">
                    <PreflightItem
                      status={preflight.gmailConnected ? "pass" : "block"}
                      message={
                        preflight.gmailConnected
                          ? `Gmail account connected (${preflight.gmailAccount?.email})`
                          : "No Gmail account connected — go to Settings to connect one"
                      }
                    />
                    <PreflightItem
                      status={preflight.hasEmailStep ? "pass" : "block"}
                      message={
                        preflight.hasEmailStep
                          ? "Sequence has email steps"
                          : "Sequence has no email steps — add at least one email step"
                      }
                    />
                    {preflight.missingEmail > 0 && (
                      <PreflightItem
                        status="warn"
                        message={`${preflight.missingEmail} contact${preflight.missingEmail !== 1 ? "s" : ""} missing email address — will be skipped`}
                      />
                    )}
                    {preflight.missingFirstName > 0 && (
                      <PreflightItem
                        status="warn"
                        message={`${preflight.missingFirstName} contact${preflight.missingFirstName !== 1 ? "s" : ""} missing first name — {{first_name}} will be blank`}
                      />
                    )}
                    {preflight.alreadyEnrolled > 0 && (
                      <PreflightItem
                        status="info"
                        message={`${preflight.alreadyEnrolled} contact${preflight.alreadyEnrolled !== 1 ? "s" : ""} already enrolled — will be skipped`}
                      />
                    )}
                    {preflight.suppressedCount > 0 && (
                      <PreflightItem
                        status="warn"
                        message={`${preflight.suppressedCount} contact${preflight.suppressedCount !== 1 ? "s" : ""} suppressed (unsubscribed, bounced, or DNC) — will be skipped`}
                      />
                    )}
                  </div>

                  {!hasBlocker && (
                    <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 space-y-1">
                      <p>
                        Will enroll{" "}
                        <strong>{preflight.enrollableCount}</strong>{" "}
                        contact{preflight.enrollableCount !== 1 ? "s" : ""}.
                      </p>
                      {daysEstimate !== null && preflight.gmailAccount && (
                        <p>
                          At {preflight.gmailAccount.maxDailySends} emails/day → ~{daysEstimate}{" "}
                          day{daysEstimate !== 1 ? "s" : ""} to complete.
                        </p>
                      )}
                      <p>First email sends within 5 minutes.</p>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        {!launched && (
          <div className="flex items-center justify-between p-6 border-t border-slate-200">
            <button
              onClick={state === "select" ? onClose : () => setState("select")}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {state === "select" ? "Cancel" : "← Back"}
            </button>

            {state === "select" ? (
              <button
                onClick={handleNext}
                disabled={!selectedListId}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={handleLaunch}
                disabled={!preflight || loadingPreflight || launching || !!hasBlocker}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {launching && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                )}
                Launch Campaign →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PreflightItem({
  status,
  message,
}: {
  status: "pass" | "warn" | "block" | "info";
  message: string;
}) {
  const icons = {
    pass: <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />,
    warn: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />,
    block: <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />,
    info: <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />,
  };

  return (
    <div className="flex items-start gap-2 text-sm text-slate-700">
      {icons[status]}
      <span>{message}</span>
    </div>
  );
}
