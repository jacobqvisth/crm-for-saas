"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { SequenceHeader } from "@/components/sequences/sequence-header";
import type { SendingStatus } from "@/components/sequences/sequence-header";
import { SequenceContactsTab } from "@/components/sequences/sequence-contacts-tab";
import { SequenceAnalyticsTab } from "@/components/sequences/sequence-analytics-tab";
import { SequenceSettingsPanel } from "@/components/sequences/sequence-settings";
import { EnrollContactsModal } from "@/components/sequences/enroll-contacts-modal";
import { LaunchCampaignModal } from "@/components/sequences/launch-campaign-modal";
import {
  ArrowLeft,
  Mail,
  Clock,
  GitBranch,
  UserPlus,
  BarChart2,
  Play,
  Pause,
  AlertTriangle,
  MoreHorizontal,
  CornerDownRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Sequence = Tables<"sequences">;
type Step = Tables<"sequence_steps">;

interface SequenceStats {
  enrolled: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

const STEP_ICONS = {
  email: Mail,
  delay: Clock,
  condition: GitBranch,
};

export default function SequenceDetailPage() {
  const params = useParams();
  const sequenceId = params.id as string;
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const router = useRouter();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stats, setStats] = useState<SequenceStats>({
    enrolled: 0, sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0,
  });
  const [sendingStatus, setSendingStatus] = useState<SendingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "contacts" | "analytics">("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [pauseAllOpen, setPauseAllOpen] = useState(false);
  const [pauseAllLoading, setPauseAllLoading] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    const { data: seq, error } = await supabase
      .from("sequences")
      .select("*")
      .eq("id", sequenceId)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !seq) {
      toast.error("Sequence not found");
      router.push("/sequences");
      return;
    }

    setSequence(seq);

    // Load steps
    const { data: stepsData } = await supabase
      .from("sequence_steps")
      .select("*")
      .eq("sequence_id", sequenceId)
      .order("step_order");

    setSteps(stepsData || []);

    // Load stats
    const { data: statsData } = await supabase.rpc("get_sequence_stats", {
      p_sequence_id: sequenceId,
    });

    if (statsData) {
      const s = (typeof statsData === "string" ? JSON.parse(statsData) : statsData) as Record<string, number>;
      setStats({
        enrolled: s.enrolled || 0,
        sent: s.sent || 0,
        opened: s.opened || 0,
        clicked: s.clicked || 0,
        replied: s.replied || 0,
        bounced: s.bounced || 0,
        unsubscribed: s.unsubscribed || 0,
      });
    }

    // Load sending status: get distinct senders from this sequence's enrollments,
    // fall back to first active workspace account if no enrollments yet.
    const { data: enrollmentRows } = await supabase
      .from("sequence_enrollments")
      .select("id, sender_account_id")
      .eq("sequence_id", sequenceId);

    const enrollIds = (enrollmentRows || []).map((e) => e.id);

    // Count enrollments per sender_account_id
    const senderCountMap = new Map<string, number>();
    for (const row of enrollmentRows || []) {
      if (!row.sender_account_id) continue;
      senderCountMap.set(
        row.sender_account_id,
        (senderCountMap.get(row.sender_account_id) ?? 0) + 1
      );
    }

    const uniqueSenderIds = Array.from(senderCountMap.keys());

    // Fetch gmail_accounts for those sender IDs (separate query avoids FK type issues)
    let senders: { id: string; email: string; status: string; enrollmentCount: number }[] = [];
    if (uniqueSenderIds.length > 0) {
      const { data: gmailRows } = await supabase
        .from("gmail_accounts")
        .select("id, email_address, status")
        .in("id", uniqueSenderIds);
      senders = (gmailRows || []).map((g) => ({
        id: g.id,
        email: g.email_address,
        status: g.status,
        enrollmentCount: senderCountMap.get(g.id) ?? 0,
      }));
    }

    // Fallback: if no enrollments yet, use first active workspace account
    let fallbackEmail: string | null = null;
    let gmailConnected = senders.length > 0;
    if (senders.length === 0) {
      const { data: fallbackAccounts } = await supabase
        .from("gmail_accounts")
        .select("id, email_address, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .limit(1);
      fallbackEmail = fallbackAccounts?.[0]?.email_address ?? null;
      gmailConnected = (fallbackAccounts?.length ?? 0) > 0;
    }

    let nextSend: string | null = null;
    let lastSent: string | null = null;

    if (enrollIds.length > 0) {
      const [{ data: nextEmail }, { data: lastSentEmail }] = await Promise.all([
        supabase
          .from("email_queue")
          .select("scheduled_for")
          .eq("status", "scheduled")
          .in("enrollment_id", enrollIds)
          .order("scheduled_for", { ascending: true })
          .limit(1),
        supabase
          .from("email_queue")
          .select("sent_at")
          .eq("status", "sent")
          .in("enrollment_id", enrollIds)
          .not("sent_at", "is", null)
          .order("sent_at", { ascending: false })
          .limit(1),
      ]);

      nextSend = nextEmail?.[0]?.scheduled_for ?? null;
      lastSent = lastSentEmail?.[0]?.sent_at ?? null;
    }

    setSendingStatus({
      gmailConnected,
      senders,
      gmailEmail: senders.length === 1 ? senders[0].email : fallbackEmail,
      nextSend,
      lastSent,
    });

    setLoading(false);
  }, [workspaceId, sequenceId, supabase, router]);

  useEffect(() => {
    load();
  }, [load]);

  // Close more-menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleStatus = async () => {
    if (!workspaceId || !sequence) return;
    setToggleLoading(true);
    const newStatus = sequence.status === "active" ? "paused" : "active";

    const res = await fetch(`/api/sequences/${sequence.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!res.ok) {
      toast.error("Failed to update status");
      setToggleLoading(false);
      return;
    }

    toast.success(`Sequence ${newStatus === "active" ? "sending started" : "sending paused"}`);
    setToggleLoading(false);
    load();
  };

  if (loading || !sequence) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const isActive = sequence.status === "active";
  const isPausedOrDraft = sequence.status === "paused" || sequence.status === "draft";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push("/sequences")}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sequences
        </button>

        {/* Top-right action bar: View Analytics | ⋯ | Start/Pause Sending | Enroll List */}
        <div className="flex items-center gap-2">
          <Link
            href={`/sequences/${sequenceId}/analytics`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <BarChart2 className="w-3.5 h-3.5" />
            View Analytics
          </Link>

          {/* ⋯ more menu */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setMoreMenuOpen((o) => !o)}
              className="inline-flex items-center justify-center w-9 h-9 text-slate-500 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => { setMoreMenuOpen(false); setPauseAllOpen(true); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Pause className="w-3.5 h-3.5 text-slate-400" />
                  Pause All
                </button>
              </div>
            )}
          </div>

          {/* Start Sending / Pause Sending */}
          {sequence.status !== "archived" && (
            <button
              onClick={toggleStatus}
              disabled={toggleLoading}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-60 ${
                isActive
                  ? "text-yellow-700 bg-yellow-50 border border-yellow-200 hover:bg-yellow-100"
                  : "text-white bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {isActive ? (
                <><Pause className="w-3.5 h-3.5" /> Pause Sending</>
              ) : (
                <><Play className="w-3.5 h-3.5" /> Start Sending</>
              )}
            </button>
          )}

          {/* Enroll List */}
          <button
            onClick={() => setLaunchOpen(true)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              isActive
                ? "text-white bg-indigo-600 hover:bg-indigo-700"
                : "text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Enroll List
          </button>
        </div>
      </div>

      {/* Amber banner when paused/draft */}
      {isPausedOrDraft && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800">
            This sequence is paused. New enrollments will be queued but no emails will send until you press Start Sending.
          </p>
        </div>
      )}

      <SequenceHeader
        sequence={sequence}
        stats={stats}
        sendingStatus={sendingStatus}
        onRefresh={load}
        onEnrollClick={() => setEnrollOpen(true)}
        onSettingsClick={() => setSettingsOpen(true)}
      />

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-6 w-fit">
        {(["overview", "contacts", "analytics"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
              activeTab === tab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div>
          {steps.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-medium text-slate-900">No steps yet</h3>
              <p className="text-sm text-slate-500 mt-1">
                Add steps to build your sequence flow.
              </p>
              <button
                onClick={() => router.push(`/sequences/${sequenceId}/edit`)}
                className="mt-4 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Build Sequence
              </button>
            </div>
          ) : (
            <div className="space-y-0">
              {(() => {
                // Pre-compute email steps sorted by step_order for threading logic
                const emailSteps = steps.filter((s) => s.type === "email");
                return steps.map((step, i) => {
                const Icon = STEP_ICONS[step.type] || Mail;
                // Compute threading context for email steps
                const thisEmailIdx = step.type === "email"
                  ? emailSteps.findIndex((s) => s.id === step.id)
                  : -1;
                const priorEmailStep = thisEmailIdx > 0 ? emailSteps[thisEmailIdx - 1] : null;
                return (
                  <div key={step.id}>
                    <div className="flex items-start gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          step.type === "email"
                            ? "bg-indigo-100 text-indigo-600"
                            : step.type === "delay"
                            ? "bg-amber-100 text-amber-600"
                            : "bg-purple-100 text-purple-600"
                        }`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        {i < steps.length - 1 && (
                          <div className="w-0.5 h-8 bg-slate-200 my-1" />
                        )}
                      </div>
                      <div className="flex-1 bg-white rounded-lg border border-slate-200 p-4 mb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-medium text-slate-500 uppercase">
                              Step {step.step_order + 1} &middot; {step.type}
                            </span>
                            {step.type === "email" && (
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {step.subject_override ? (
                                  <p className="text-sm font-medium text-slate-900">
                                    {step.subject_override}
                                  </p>
                                ) : priorEmailStep ? (
                                  <>
                                    <p className="text-sm italic text-slate-600">
                                      Re: {priorEmailStep.subject_override || "No subject"}
                                    </p>
                                    <span
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 cursor-default"
                                      title={`Sent in the same Gmail thread as Step ${priorEmailStep.step_order + 1}. Leave the subject blank to keep it threaded.`}
                                    >
                                      <CornerDownRight className="w-3 h-3" />
                                      Threaded reply
                                    </span>
                                  </>
                                ) : (
                                  <p className="text-sm font-medium text-slate-900">No subject</p>
                                )}
                              </div>
                            )}
                            {step.type === "delay" && (
                              <p className="text-sm text-slate-700 mt-0.5">
                                Wait {step.delay_days || 0} day(s) {step.delay_hours || 0} hour(s)
                              </p>
                            )}
                            {step.type === "condition" && (
                              <p className="text-sm text-slate-700 mt-0.5">
                                If previous email was {step.condition_type}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              });
              })()}
            </div>
          )}
        </div>
      )}

      {activeTab === "contacts" && (
        <SequenceContactsTab sequenceId={sequenceId} steps={steps} settings={sequence.settings} />
      )}
      {activeTab === "analytics" && <SequenceAnalyticsTab sequenceId={sequenceId} />}

      <SequenceSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sequence={sequence}
        onSave={load}
      />

      <EnrollContactsModal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        sequenceId={sequenceId}
        sequenceStatus={sequence?.status}
        onEnrolled={load}
      />

      {launchOpen && workspaceId && (
        <LaunchCampaignModal
          sequenceId={sequenceId}
          workspaceId={workspaceId}
          onClose={() => setLaunchOpen(false)}
          onSuccess={(enrolled) => {
            toast.success(`${enrolled} contact${enrolled !== 1 ? "s" : ""} enrolled`);
            setLaunchOpen(false);
            load();
          }}
        />
      )}

      {/* Pause All Confirmation Modal */}
      {pauseAllOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Pause All Enrollments?</h3>
            <p className="text-sm text-slate-600 mb-6">
              This will pause all active enrollments in this sequence and cancel their scheduled
              emails. You can resume individual enrollments from the analytics page.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setPauseAllOpen(false)}
                disabled={pauseAllLoading}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setPauseAllLoading(true);
                  try {
                    const res = await fetch(`/api/sequences/${sequenceId}/pause-all`, {
                      method: "POST",
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      toast.error(data.error || "Failed to pause enrollments");
                    } else {
                      toast.success(`${data.paused} enrollment${data.paused !== 1 ? "s" : ""} paused`);
                      setPauseAllOpen(false);
                      load();
                    }
                  } catch {
                    toast.error("Failed to pause enrollments");
                  } finally {
                    setPauseAllLoading(false);
                  }
                }}
                disabled={pauseAllLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {pauseAllLoading ? "Pausing..." : "Pause All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
