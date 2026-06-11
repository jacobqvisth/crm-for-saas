"use client";

import { useState } from "react";
import { X, Phone, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";

export type CallLoggerTarget = {
  contactId: string;
  name: string;
  phone: string | null;
  companyId: string | null;
  companyName: string | null;
  isCustomer: boolean;
  listId?: string | null;
};

type FeedbackDraft = {
  category: "bug" | "feature_request" | "complaint" | "praise" | "other";
  severity: "" | "low" | "medium" | "high" | "critical";
  body: string;
};

const OUTCOME_TONE: Record<CallOutcome, string> = {
  interested: "border-emerald-300 bg-emerald-50 text-emerald-700",
  closed: "border-emerald-400 bg-emerald-100 text-emerald-800",
  callback_scheduled: "border-amber-300 bg-amber-50 text-amber-700",
  no_answer: "border-slate-300 bg-slate-50 text-slate-600",
  left_voicemail: "border-sky-300 bg-sky-50 text-sky-700",
  not_interested: "border-rose-300 bg-rose-50 text-rose-700",
  wrong_number: "border-slate-300 bg-slate-50 text-slate-500",
};

export function CallLogger({
  target,
  onClose,
  onLogged,
}: {
  target: CallLoggerTarget;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [connected, setConnected] = useState(true);
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [feedback, setFeedback] = useState<FeedbackDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const addFeedback = () =>
    setFeedback((f) => [...f, { category: "feature_request", severity: "", body: "" }]);
  const updateFeedback = (i: number, patch: Partial<FeedbackDraft>) =>
    setFeedback((f) => f.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeFeedback = (i: number) =>
    setFeedback((f) => f.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!outcome) {
      toast.error("Pick an outcome");
      return;
    }
    if (outcome === "callback_scheduled" && !callbackAt) {
      toast.error("Set a callback time");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/calls/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: target.contactId,
          companyId: target.companyId,
          listId: target.listId ?? null,
          outcome,
          connected,
          notes: notes.trim() || null,
          durationSeconds: duration ? Number(duration) * 60 : null,
          callbackAt: outcome === "callback_scheduled" && callbackAt
            ? new Date(callbackAt).toISOString()
            : null,
          feedback: feedback
            .filter((f) => f.body.trim())
            .map((f) => ({
              category: f.category,
              severity: f.severity || null,
              body: f.body.trim(),
            })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to log call");
      toast.success("Call logged");
      if (json.feedbackError) toast.error(`Feedback not saved: ${json.feedbackError}`);
      onLogged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to log call");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Phone className="h-4 w-4 text-indigo-600" />
              Log call
            </div>
            <div className="mt-0.5 text-sm text-slate-600">
              {target.name}
              {target.companyName ? ` · ${target.companyName}` : ""}
              {target.isCustomer && (
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  Customer
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {target.phone && (
            <a
              href={`tel:${target.phone}`}
              className="flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            >
              <Phone className="h-4 w-4" /> Call {target.phone}
            </a>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Connected?</label>
            <div className="flex gap-2">
              <button
                onClick={() => setConnected(true)}
                className={`flex-1 rounded-lg border py-2 text-sm ${connected ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}
              >
                Reached a human
              </button>
              <button
                onClick={() => setConnected(false)}
                className={`flex-1 rounded-lg border py-2 text-sm ${!connected ? "border-slate-300 bg-slate-100 text-slate-700" : "border-slate-200 text-slate-600"}`}
              >
                No contact
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Outcome</label>
            <div className="grid grid-cols-2 gap-2">
              {CALL_OUTCOMES.map((o) => (
                <button
                  key={o}
                  onClick={() => setOutcome(o)}
                  className={`rounded-lg border px-3 py-2 text-sm ${outcome === o ? OUTCOME_TONE[o] : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  {CALL_OUTCOME_LABEL[o]}
                </button>
              ))}
            </div>
          </div>

          {outcome === "callback_scheduled" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Callback time</label>
              <input
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What was said…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Duration (minutes, optional)</label>
            <input
              type="number"
              min={0}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          {target.isCustomer && (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Product feedback</span>
                <button
                  onClick={addFeedback}
                  className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              {feedback.length === 0 && (
                <p className="mt-1 text-xs text-slate-400">Capture fixes, ideas or problems they mentioned.</p>
              )}
              <div className="mt-2 space-y-2">
                {feedback.map((f, i) => (
                  <div key={i} className="rounded-md bg-slate-50 p-2">
                    <div className="flex gap-2">
                      <select
                        value={f.category}
                        onChange={(e) => updateFeedback(i, { category: e.target.value as FeedbackDraft["category"] })}
                        className="rounded border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="bug">Bug</option>
                        <option value="feature_request">Feature</option>
                        <option value="complaint">Complaint</option>
                        <option value="praise">Praise</option>
                        <option value="other">Other</option>
                      </select>
                      <select
                        value={f.severity}
                        onChange={(e) => updateFeedback(i, { severity: e.target.value as FeedbackDraft["severity"] })}
                        className="rounded border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">Severity</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                      <button onClick={() => removeFeedback(i)} className="ml-auto text-slate-400 hover:text-rose-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <textarea
                      value={f.body}
                      onChange={(e) => updateFeedback(i, { body: e.target.value })}
                      rows={2}
                      placeholder="Describe it…"
                      className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Log call"}
          </button>
        </div>
      </div>
    </div>
  );
}
