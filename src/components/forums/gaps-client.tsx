"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Target,
  Loader2,
  Plus,
  Trash2,
  ExternalLink,
  Check,
} from "lucide-react";
import {
  type FailureStory,
  type FailureOutcome,
  type GapVerdict,
  OUTCOME_META,
  VERDICT_META,
  OUTCOME_OPTIONS,
  VERDICT_OPTIONS,
} from "@/lib/forums/gaps";
import { ForumsTabs } from "./forums-tabs";

// Blank draft for the "log a story" form.
const EMPTY_DRAFT = {
  symptom: "",
  ai_tool: "",
  ai_claimed_cause: "",
  action_taken: "",
  actual_cause: "",
  cost_amount: "",
  source_url: "",
  outcome: "failure" as FailureOutcome,
};

export function GapsClient() {
  const [stories, setStories] = useState<FailureStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forums/gaps");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        if (!cancelled) setStories(data.stories ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const reviewed = stories.filter((s) => s.our_verdict !== "not_reviewed");
    return {
      total: stories.length,
      reviewed: reviewed.length,
      caught: stories.filter((s) => s.our_verdict === "would_have_caught").length,
      missed: stories.filter((s) => s.our_verdict === "would_have_missed").length,
    };
  }, [stories]);

  async function addStory() {
    if (!draft.symptom.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/forums/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symptom: draft.symptom.trim(),
          ai_tool: draft.ai_tool.trim() || null,
          ai_claimed_cause: draft.ai_claimed_cause.trim() || null,
          action_taken: draft.action_taken.trim() || null,
          actual_cause: draft.actual_cause.trim() || null,
          cost_amount: draft.cost_amount === "" ? null : Number(draft.cost_amount),
          source_url: draft.source_url.trim() || null,
          outcome: draft.outcome,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setStories((prev) => [data.story as FailureStory, ...prev]);
      setDraft({ ...EMPTY_DRAFT });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function patchStory(updated: FailureStory) {
    setStories((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function removeStory(id: string) {
    setStories((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          <Target className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Gap log</h1>
          <p className="text-sm text-slate-500">
            The stories people share when AI diagnostics went wrong. Would we have done better?
          </p>
        </div>
      </div>

      <ForumsTabs active="gaps" />

      {/* What this is */}
      <div className="mt-5 rounded-lg border border-orange-100 bg-orange-50/60 px-4 py-3 text-sm text-orange-900">
        <span className="font-medium">The loop:</span> every reply to the &ldquo;AI repair horror
        stories&rdquo; post is a real case with a known outcome, what the car was doing, what the AI
        claimed, what part got replaced, and what it actually was. Log the good ones here, then run
        the same symptoms through Wrenchlane and mark whether we would have caught what the other AI
        missed. That turns a marketing thread into a diagnostic benchmark.
      </div>

      {/* Stats */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <StatChip label="Logged" value={stats.total} />
        <StatChip label="Reviewed" value={`${stats.reviewed}/${stats.total}`} />
        <StatChip label="We'd have caught" value={stats.caught} tone="green" />
        <StatChip label="We'd have missed too" value={stats.missed} tone="red" />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900"
        >
          <Plus className="h-3.5 w-3.5" /> Log a story
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Symptom (what the car was doing)" required className="sm:col-span-2">
              <textarea
                value={draft.symptom}
                onChange={(e) => setDraft({ ...draft, symptom: e.target.value })}
                rows={2}
                placeholder="e.g. Rough idle and occasional misfire on a 2015 Golf"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="AI tool used">
              <input
                value={draft.ai_tool}
                onChange={(e) => setDraft({ ...draft, ai_tool: e.target.value })}
                placeholder="ChatGPT, a code-reader app, etc."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="What the AI claimed was wrong">
              <input
                value={draft.ai_claimed_cause}
                onChange={(e) => setDraft({ ...draft, ai_claimed_cause: e.target.value })}
                placeholder="e.g. Ignition coils"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Part replaced / repair attempted">
              <input
                value={draft.action_taken}
                onChange={(e) => setDraft({ ...draft, action_taken: e.target.value })}
                placeholder="e.g. Replaced all four coils"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="What it actually was (root cause)">
              <input
                value={draft.actual_cause}
                onChange={(e) => setDraft({ ...draft, actual_cause: e.target.value })}
                placeholder="e.g. Cracked intake boot"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Cost of the wrong turn">
              <input
                type="number"
                min="0"
                value={draft.cost_amount}
                onChange={(e) => setDraft({ ...draft, cost_amount: e.target.value })}
                placeholder="e.g. 400"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Outcome">
              <select
                value={draft.outcome}
                onChange={(e) => setDraft({ ...draft, outcome: e.target.value as FailureOutcome })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {OUTCOME_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_META[o].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source (Reddit thread URL)" className="sm:col-span-2">
              <input
                value={draft.source_url}
                onChange={(e) => setDraft({ ...draft, source_url: e.target.value })}
                placeholder="https://www.reddit.com/r/..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setShowForm(false);
                setDraft({ ...EMPTY_DRAFT });
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={addStory}
              disabled={saving || !draft.symptom.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save story
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading gap log…
        </div>
      ) : stories.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <Target className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">No stories logged yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Post the &ldquo;AI repair horror stories&rdquo; topic from Posts → Topic campaigns, then
            log the replies here as they come in.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {stories.map((s) => (
            <StoryCard key={s.id} story={s} onPatched={patchStory} onRemoved={removeStory} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "green" | "red";
}) {
  const valueClass =
    tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : "text-slate-900";
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function StoryCard({
  story,
  onPatched,
  onRemoved,
}: {
  story: FailureStory;
  onPatched: (s: FailureStory) => void;
  onRemoved: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(story.our_notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/gaps/${story.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) onPatched(data.story as FailureStory);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this story from the gap log?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/gaps/${story.id}`, { method: "DELETE" });
      if (res.ok) onRemoved(story.id);
    } finally {
      setBusy(false);
    }
  }

  const outcome = OUTCOME_META[story.outcome] ?? OUTCOME_META.unknown;
  const verdict = VERDICT_META[story.our_verdict] ?? VERDICT_META.not_reviewed;

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
      {/* Symptom + outcome */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{story.symptom}</p>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${outcome.badgeClass}`}>
          {outcome.label}
        </span>
      </div>

      {/* The case */}
      <div className="mt-3 space-y-1.5 text-xs">
        {story.ai_claimed_cause && (
          <Line label="AI said" value={story.ai_claimed_cause} tool={story.ai_tool} />
        )}
        {story.action_taken && <Line label="They did" value={story.action_taken} />}
        {story.actual_cause && (
          <Line label="Actually was" value={story.actual_cause} strong />
        )}
        {typeof story.cost_amount === "number" && (
          <Line
            label="Cost"
            value={`${story.cost_amount.toLocaleString()} ${story.cost_currency ?? ""}`.trim()}
          />
        )}
      </div>

      {/* Verdict */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="text-[11px] font-medium text-slate-500">Would we have caught it?</span>
        <select
          value={story.our_verdict}
          onChange={(e) => patch({ our_verdict: e.target.value as GapVerdict })}
          disabled={busy}
          className={`rounded-full border-0 px-2 py-0.5 text-[11px] font-medium ${verdict.badgeClass}`}
        >
          {VERDICT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {VERDICT_META[v].label}
            </option>
          ))}
        </select>
        {story.source_url && (
          <a
            href={story.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
          >
            <ExternalLink className="h-3 w-3" /> source
          </a>
        )}
        <button
          onClick={remove}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-600 disabled:opacity-50"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Notes */}
      {editingNotes ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Reasoning: would Wrenchlane have caught this, and why?"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setNotes(story.our_notes ?? "");
                setEditingNotes(false);
              }}
              className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                await patch({ our_notes: notes.trim() || null });
                setEditingNotes(false);
              }}
              disabled={busy}
              className="rounded-lg bg-green-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              Save note
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditingNotes(true)}
          className="mt-2 text-left text-[11px] text-slate-500 hover:text-slate-800"
        >
          {story.our_notes ? (
            <span className="whitespace-pre-wrap">{story.our_notes}</span>
          ) : (
            <span className="italic text-slate-400">+ add reasoning note</span>
          )}
        </button>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  tool,
  strong,
}: {
  label: string;
  value: string;
  tool?: string | null;
  strong?: boolean;
}) {
  return (
    <p className="text-slate-600">
      <span className="font-medium text-slate-500">{label}:</span>{" "}
      <span className={strong ? "font-semibold text-slate-900" : ""}>{value}</span>
      {tool && <span className="text-slate-400"> ({tool})</span>}
    </p>
  );
}
