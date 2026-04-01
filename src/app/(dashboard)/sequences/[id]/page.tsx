"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { SequenceHeader } from "@/components/sequences/sequence-header";
import { SequenceContactsTab } from "@/components/sequences/sequence-contacts-tab";
import { SequenceAnalyticsTab } from "@/components/sequences/sequence-analytics-tab";
import { SequenceSettingsPanel } from "@/components/sequences/sequence-settings";
import { EnrollContactsModal } from "@/components/sequences/enroll-contacts-modal";
import { LaunchCampaignModal } from "@/components/sequences/launch-campaign-modal";
import { ArrowLeft, Mail, Clock, GitBranch, Rocket, BarChart2, Pause } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "contacts" | "analytics">("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [pauseAllOpen, setPauseAllOpen] = useState(false);
  const [pauseAllLoading, setPauseAllLoading] = useState(false);

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

    setLoading(false);
  }, [workspaceId, sequenceId, supabase, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !sequence) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

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
        <div className="flex items-center gap-2">
          <Link
            href={`/sequences/${sequenceId}/analytics`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <BarChart2 className="w-3.5 h-3.5" />
            View Analytics
          </Link>
          <button
            onClick={() => setPauseAllOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Pause className="w-3.5 h-3.5" />
            Pause All
          </button>
          <button
            onClick={() => setLaunchOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Rocket className="w-3.5 h-3.5" />
            Launch Campaign
          </button>
        </div>
      </div>

      <SequenceHeader
        sequence={sequence}
        stats={stats}
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
              {steps.map((step, i) => {
                const Icon = STEP_ICONS[step.type] || Mail;
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
                              <p className="text-sm font-medium text-slate-900 mt-0.5">
                                {step.subject_override || "No subject"}
                              </p>
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
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "contacts" && <SequenceContactsTab sequenceId={sequenceId} />}
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
