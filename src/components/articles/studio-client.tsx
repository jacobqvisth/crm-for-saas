"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { SourcePicker, type SourceTotals } from "./source-picker";
import { ArticleOptions } from "./article-options";
import { ImpactForm } from "./impact-form";
import { DraftPanel, type DraftView } from "./draft-panel";
import { FORMAT_ORDER, FORMAT_SPECS, getFormatSpec } from "@/lib/articles/formats";
import { DEFAULT_ARTICLE_OPTIONS } from "@/lib/articles/generation-options";
import type { DiagnosticCandidate } from "@/lib/articles/sources";
import type { StatStoryAvailability } from "@/lib/articles/stat-stories";
import {
  EMPTY_IMPACT,
  type ArticleFormat,
  type ArticleGenerationOptions,
  type ArticleImpact,
  type ArticleSourceKind,
} from "@/lib/articles/types";

type ArticleRow = {
  id: string;
  format: ArticleFormat;
  language: string;
  published_url: string | null;
  title: string | null;
  body: string | null;
  hooks: unknown;
  hashtags: string[] | null;
  claims: unknown;
  seo: unknown;
};

function toDraft(row: ArticleRow): DraftView {
  return {
    id: row.id,
    format: row.format,
    language: row.language,
    publishedUrl: row.published_url ?? null,
    title: row.title,
    body: row.body ?? "",
    hooks: Array.isArray(row.hooks) ? (row.hooks as string[]) : [],
    hashtags: row.hashtags ?? [],
    claims: Array.isArray(row.claims) ? (row.claims as DraftView["claims"]) : [],
    seo: (row.seo as DraftView["seo"]) ?? null,
  };
}

export function StudioClient({ onSaved }: { onSaved?: () => void }) {
  const [kind, setKind] = useState<ArticleSourceKind>("diagnostic");
  const [format, setFormat] = useState<ArticleFormat>("linkedin_post");
  const [options, setOptions] = useState<ArticleGenerationOptions>(DEFAULT_ARTICLE_OPTIONS);
  const [impact, setImpact] = useState<ArticleImpact>(EMPTY_IMPACT);

  const [diagnostics, setDiagnostics] = useState<DiagnosticCandidate[]>([]);
  const [statStories, setStatStories] = useState<StatStoryAvailability[]>([]);
  const [totals, setTotals] = useState<SourceTotals | null>(null);
  const [loadingSources, setLoadingSources] = useState(true);

  const [diagnosticId, setDiagnosticId] = useState<string | null>(null);
  const [statStory, setStatStory] = useState<string | null>(null);
  const [freeTopic, setFreeTopic] = useState("");
  const [search, setSearch] = useState("");

  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/articles/sources");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setDiagnostics(data.diagnostics ?? []);
        setStatStories(data.statStories ?? []);
        setTotals(data.totals ?? null);
      } catch {
        if (!cancelled) toast.error("Could not load the diagnostics data");
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The data-insight angle is the right default for a stats-backed piece, and
  // case_study is right for a single diagnostic. Nudge rather than force, so a
  // deliberate choice is never overwritten.
  useEffect(() => {
    setOptions((prev) => {
      if (kind === "stats" && prev.angle === "case_study") return { ...prev, angle: "data_insight" };
      if (kind === "diagnostic" && prev.angle === "data_insight")
        return { ...prev, angle: "case_study" };
      return prev;
    });
  }, [kind]);

  // Hashtags only make sense on some channels.
  useEffect(() => {
    const spec = getFormatSpec(format);
    if (spec && !spec.wantsHashtags) setOptions((prev) => ({ ...prev, hashtags: false }));
    if (spec?.wantsHashtags) setOptions((prev) => ({ ...prev, hashtags: true }));
  }, [format]);

  const ready =
    kind === "diagnostic"
      ? Boolean(diagnosticId)
      : kind === "stats"
        ? Boolean(statStory)
        : freeTopic.trim().length > 2;

  const generate = useCallback(async () => {
    if (!ready) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/articles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          sourceKind: kind,
          sourceRef: kind === "diagnostic" ? diagnosticId : kind === "stats" ? statStory : undefined,
          freeTopic: kind === "free_topic" ? freeTopic.trim() : undefined,
          options,
          impact,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Capacity failures are worth retrying and are nobody's fault, so they
        // get a longer-lived toast and their own note rather than a raw blob.
        setFailure({
          message: data.error ?? `Generation failed (${res.status})`,
          retryable: Boolean(data.retryable),
        });
        toast.error(data.error ?? `Generation failed (${res.status})`, {
          duration: data.retryable ? 8000 : 6000,
        });
        return;
      }
      setFailure(null);
      setDraft(toDraft(data.article as ArticleRow));
      if (data.usedFallbackModel) {
        toast.success("Draft ready, written by Sonnet 5 because Opus was busy", { duration: 7000 });
      } else {
        toast.success("Draft ready");
      }
      onSaved?.();
    } catch {
      setFailure({ message: "Could not reach the server. Check your connection and try again.", retryable: true });
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [ready, format, kind, diagnosticId, statStory, freeTopic, options, impact, onSaved]);

  const saveEdits = useCallback(
    async (patch: { title?: string | null; body?: string }) => {
      if (!draft) return;
      const res = await fetch("/api/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, ...patch }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      setDraft(toDraft(data.article as ArticleRow));
    },
    [draft],
  );

  return (
    <div className="space-y-5">
      <SourcePicker
        kind={kind}
        onKindChange={setKind}
        diagnostics={diagnostics}
        statStories={statStories}
        totals={totals}
        loading={loadingSources}
        selectedDiagnosticId={diagnosticId}
        onSelectDiagnostic={setDiagnosticId}
        selectedStatStory={statStory}
        onSelectStatStory={setStatStory}
        freeTopic={freeTopic}
        onFreeTopicChange={setFreeTopic}
        search={search}
        onSearchChange={setSearch}
      />

      {/* Format */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">2. Where is it going?</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {FORMAT_ORDER.map((key) => {
            const spec = FORMAT_SPECS[key];
            const active = format === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFormat(key)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span
                  className={`block text-sm font-medium ${active ? "text-indigo-700" : "text-slate-800"}`}
                >
                  {spec.label}
                </span>
                <span className="mt-1 block text-xs leading-snug text-slate-500">{spec.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Options */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">3. How should it read?</h2>
        <ArticleOptions value={options} onChange={setOptions} format={format} />
      </section>

      {/* Impact */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          4. Real numbers you can stand behind{" "}
          <span className="font-normal text-slate-400">(optional)</span>
        </h2>
        <ImpactForm value={impact} onChange={setImpact} />
      </section>

      {/* Generate */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={!ready || generating}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {generating ? "Writing…" : "Write it"}
        </button>
        {!ready && (
          <span className="text-xs text-slate-400">
            {kind === "free_topic" ? "Type a topic first." : "Pick a source above first."}
          </span>
        )}
        {generating && (
          <span className="text-xs text-slate-400">
            Opus 5 with thinking on. A long article can take a minute.
          </span>
        )}
      </div>

      {failure && !generating && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-sm text-amber-900">{failure.message}</p>
            {failure.retryable && (
              <button
                type="button"
                onClick={generate}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {draft && (
        <DraftPanel
          draft={draft}
          onRegenerate={generate}
          regenerating={generating}
          onSave={saveEdits}
        />
      )}
    </div>
  );
}
