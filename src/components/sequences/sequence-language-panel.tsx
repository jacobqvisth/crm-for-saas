"use client";

import { useCallback, useEffect, useState } from "react";
import { Languages, RefreshCw, Check, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { languageLabel } from "@/lib/i18n/languages";

type StepCoverage = {
  stepId: string;
  stepOrder: number | null;
  subject: string;
  covered: string[];
  missing: string[];
};

type Coverage = {
  languages: string[];
  sourceLanguage: string;
  steps: StepCoverage[];
  complete: boolean;
};

/**
 * Multi-language status for a sequence, on the sequence page.
 *
 * Answers "does this actually send in every language I ticked, on every
 * step?" without opening each step, and gives one button to fill the gaps.
 * Renders nothing for a single-language sequence, so it stays out of the way
 * of the sequences that don't use this.
 */
export function SequenceLanguagePanel({
  sequenceId,
  onGenerated,
}: {
  sequenceId: string;
  onGenerated?: () => void;
}) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sequences/${sequenceId}/languages`);
      if (!res.ok) return;
      setCoverage((await res.json()) as Coverage);
    } finally {
      setLoading(false);
    }
  }, [sequenceId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTranslateAll = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/sequences/${sequenceId}/languages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as {
        error?: string;
        createdTotal?: number;
        failedTotal?: number;
        stepsWithoutCopy?: number;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not translate");
        return;
      }
      const created = data.createdTotal ?? 0;
      if (created > 0) {
        toast.success(
          `Wrote ${created} translation${created === 1 ? "" : "s"}. Review them before sending.`,
        );
      } else if ((data.failedTotal ?? 0) === 0) {
        toast("Every step already has all its languages");
      }
      if (data.stepsWithoutCopy) {
        toast.error(
          `${data.stepsWithoutCopy} step${data.stepsWithoutCopy === 1 ? " has" : "s have"} no copy to translate yet`,
        );
      }
      if (data.failedTotal) {
        toast.error(`${data.failedTotal} translation(s) failed`);
      }
      await load();
      onGenerated?.();
    } catch {
      toast.error("Could not translate");
    } finally {
      setGenerating(false);
    }
  };

  // Single-language sequence: nothing to say.
  if (loading || !coverage || coverage.languages.length === 0) return null;

  const totalMissing = coverage.steps.reduce(
    (n, s) => n + s.missing.length,
    0,
  );

  return (
    <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-indigo-600 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900">
              Sends in {coverage.languages.length} languages
            </h3>
            {coverage.complete ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <Check className="w-3 h-3" />
                All steps translated
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                <AlertTriangle className="w-3 h-3" />
                {totalMissing} missing
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Each contact gets the version in their own language, chosen when
            they enroll from their contact language, then their country.
            Anyone we can&apos;t place gets{" "}
            {languageLabel(coverage.sourceLanguage)}.
          </p>
          <div className="flex flex-wrap gap-1 mt-2">
            {coverage.languages.map((code) => (
              <span
                key={code}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                  code === coverage.sourceLanguage
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 border border-slate-200"
                }`}
                title={
                  code === coverage.sourceLanguage
                    ? "Master copy — translations are generated from this"
                    : languageLabel(code)
                }
              >
                {languageLabel(code)}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleTranslateAll}
          disabled={generating}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 shrink-0"
          title="Translate every email step into every language above. Existing translations you have edited are left alone."
        >
          <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Translating…" : "Translate all steps"}
        </button>
      </div>

      {!coverage.complete && (
        <div className="mt-3 pt-3 border-t border-indigo-200 space-y-1">
          {coverage.steps
            .filter((s) => s.missing.length > 0)
            .map((s) => (
              <p key={s.stepId} className="text-xs text-slate-600">
                <span className="font-medium text-slate-800">
                  Step {(s.stepOrder ?? 0) + 1}
                </span>
                {s.subject ? ` · ${s.subject}` : ""} — missing{" "}
                {s.missing.map((c) => languageLabel(c)).join(", ")}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
