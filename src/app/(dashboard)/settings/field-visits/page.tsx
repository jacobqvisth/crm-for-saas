"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, MapPin } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { VISIT_OUTCOMES, type VisitOutcome } from "@/lib/routes/visits-decision";

const AUTO_ENROLL_OUTCOMES: VisitOutcome[] = ["interested", "no_answer"];

const OUTCOME_INFO: Record<VisitOutcome, { label: string; helper: string }> = {
  interested: {
    label: "Interested",
    helper: "Hans got a positive signal — auto-enroll the company in this sequence.",
  },
  no_answer: {
    label: "No answer",
    helper: "Nobody at the shop — auto-enroll in a lighter follow-up sequence.",
  },
  closed: { label: "Closed", helper: "Signed up on the spot — no auto-enroll." },
  not_interested: {
    label: "Not interested",
    helper: "Explicit no — no auto-enroll, company is marked Do Not Contact.",
  },
  skipped: { label: "Skipped", helper: "Drove past — no auto-enroll, no further action." },
};

type SequenceOption = { id: string; name: string };

export default function FieldVisitsSettingsPage() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [sequenceByOutcome, setSequenceByOutcome] = useState<Partial<Record<VisitOutcome, string>>>(
    {},
  );
  const [sequences, setSequences] = useState<SequenceOption[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [settingsRes, sequencesRes] = await Promise.all([
        fetch("/api/settings/field-visits").then((r) => r.json()),
        supabase
          .from("sequences")
          .select("id, name")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;

      setEnabled(settingsRes.auto_followup_enabled !== false);
      setSequenceByOutcome(settingsRes.sequence_by_outcome ?? {});
      setSequences(sequencesRes.data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/field-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auto_followup_enabled: enabled,
          sequence_by_outcome: sequenceByOutcome,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <MapPin className="w-5 h-5 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Field Visits</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        Control what happens when a stop on a field route gets logged with an outcome.
      </p>

      <div className="flex items-center justify-between py-4 border-b border-slate-200 mb-6">
        <div>
          <p className="text-sm font-medium text-slate-900">Auto-enroll companies after a field visit</p>
          <p className="text-xs text-slate-500 mt-0.5">
            When off, no enrollments fire regardless of outcome.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            enabled ? "bg-indigo-600" : "bg-slate-200"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div className="space-y-4 mb-8">
        <h2 className="text-sm font-semibold text-slate-900">Sequence per outcome</h2>
        {AUTO_ENROLL_OUTCOMES.map((outcome) => {
          const info = OUTCOME_INFO[outcome];
          return (
            <div key={outcome} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-slate-900">{info.label}</p>
              </div>
              <p className="text-xs text-slate-500 mb-2">{info.helper}</p>
              <select
                value={sequenceByOutcome[outcome] ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setSequenceByOutcome((prev) => {
                    const next = { ...prev };
                    if (v) next[outcome] = v;
                    else delete next[outcome];
                    return next;
                  });
                }}
                disabled={!enabled}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">— No sequence (skip auto-enroll) —</option>
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-8">
        <p className="text-xs font-semibold text-slate-700 mb-2">Other outcomes (no auto-enroll)</p>
        <ul className="text-xs text-slate-600 space-y-1">
          {VISIT_OUTCOMES.filter((o) => !AUTO_ENROLL_OUTCOMES.includes(o)).map((o) => (
            <li key={o}>
              <span className="font-medium text-slate-700">{OUTCOME_INFO[o].label}:</span>{" "}
              {OUTCOME_INFO[o].helper}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2 px-6 rounded-lg text-sm transition-colors"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
