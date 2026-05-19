"use client";

import { useState } from "react";
import { Sparkles, X, Check, Plus } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type StepVariant = Tables<"sequence_step_variants">;

type GeneratedDraft = {
  name: string;
  subject: string;
  body: string;
};

interface GenerateVariantsModalProps {
  workspaceId: string;
  sequenceId: string;
  stepId: string;
  onClose: () => void;
  onSaved: (variants: StepVariant[]) => void;
}

const COUNT_OPTIONS = [3, 5, 10];

type PersonaAngle = "shop_owner" | "service_advisor" | "technician";

export function GenerateVariantsModal({
  workspaceId,
  sequenceId,
  stepId,
  onClose,
  onSaved,
}: GenerateVariantsModalProps) {
  const [count, setCount] = useState(5);
  const [persona, setPersona] = useState<PersonaAngle>("shop_owner");
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<GeneratedDraft[] | null>(null);
  const [savedIdx, setSavedIdx] = useState<Set<number>>(new Set());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{
    requestedCount: number;
    rejectedForInvalidTokens: number;
    rejectedForCtaLockMiss: number;
    remainingBudget: number;
  } | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError("");
    setSavedIdx(new Set());
    try {
      const res = await fetch("/api/ai/generate-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          sequenceId,
          stepId,
          count,
          personaAngle: persona,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed");
        setGenerating(false);
        return;
      }
      setDrafts(data.variants);
      setMeta({
        requestedCount: data.requestedCount,
        rejectedForInvalidTokens: data.rejectedForInvalidTokens,
        rejectedForCtaLockMiss: data.rejectedForCtaLockMiss,
        remainingBudget: data.remainingBudget,
      });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const saveOne = async (idx: number) => {
    if (!drafts) return;
    const draft = drafts[idx];
    setSavingIdx(idx);
    const res = await fetch(
      `/api/sequences/${sequenceId}/steps/${stepId}/variants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          subject: draft.subject,
          body_html: draft.body,
        }),
      },
    );
    setSavingIdx(null);
    if (!res.ok) {
      toast.error("Failed to save variant");
      return;
    }
    const data = (await res.json()) as { variants: StepVariant[] };
    setSavedIdx(new Set([...savedIdx, idx]));
    onSaved(data.variants);
  };

  const saveAll = async () => {
    if (!drafts) return;
    for (let i = 0; i < drafts.length; i++) {
      if (!savedIdx.has(i)) {
        await saveOne(i);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900 inline-flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            Generate variants
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!drafts ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  How many variants?
                </label>
                <div className="flex gap-2">
                  {COUNT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      className={`px-4 py-2 text-sm rounded-lg border ${
                        count === n
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                          : "border-slate-300 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Persona angle
                </label>
                {(
                  [
                    ["shop_owner", "Shop Owner / Manager"],
                    ["service_advisor", "Service Advisor"],
                    ["technician", "Technician / Tech Manager"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 py-1 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="persona"
                      checked={persona === value}
                      onChange={() => setPersona(value)}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>

              <p className="text-xs text-slate-500">
                AI will use the step&apos;s current content + any existing variants as context, and produce {count} alternates that preserve intent and CTA but vary opener, structure, and word choice. If the step has a CTA lock phrase, every variant will include it verbatim. Tokens outside the allowlist are rejected.
              </p>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              {meta && (
                <div className="text-xs text-slate-500 px-1">
                  Got {drafts.length} variant{drafts.length !== 1 ? "s" : ""}
                  {meta.rejectedForInvalidTokens > 0 &&
                    ` • ${meta.rejectedForInvalidTokens} rejected for invalid tokens`}
                  {meta.rejectedForCtaLockMiss > 0 &&
                    ` • ${meta.rejectedForCtaLockMiss} rejected for CTA-lock miss`}
                  {" • "}
                  {meta.remainingBudget} batch{meta.remainingBudget !== 1 ? "es" : ""} left today
                </div>
              )}
              {drafts.map((d, i) => {
                const isSaved = savedIdx.has(i);
                return (
                  <div
                    key={i}
                    className={`border rounded-lg p-4 ${
                      isSaved
                        ? "border-green-200 bg-green-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-900">
                        {d.name}
                      </span>
                      {isSaved ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <Check className="w-3 h-3" />
                          Saved as variant
                        </span>
                      ) : (
                        <button
                          onClick={() => saveOne(i)}
                          disabled={savingIdx === i}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {savingIdx === i ? (
                            "Saving..."
                          ) : (
                            <>
                              <Plus className="w-3 h-3" />
                              Save
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mb-1">Subject</p>
                    <p className="text-sm text-slate-800 mb-3">{d.subject}</p>
                    <p className="text-xs text-slate-500 mb-1">Body</p>
                    <div
                      className="text-sm text-slate-700 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: d.body }}
                    />
                  </div>
                );
              })}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white"
          >
            {drafts ? "Close" : "Cancel"}
          </button>
          {drafts ? (
            <button
              onClick={saveAll}
              disabled={savedIdx.size === drafts.length}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {savedIdx.size === drafts.length
                ? "All saved"
                : `Save all (${drafts.length - savedIdx.size})`}
            </button>
          ) : (
            <button
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Generate {count} variants
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
