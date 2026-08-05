"use client";

// The output surface: hook variants, the editable body, hashtags, copy buttons,
// and the claims provenance list.
//
// The claims list is the point of the whole feature. The model self-declares
// where every assertion came from, and unsourced ones are shown in amber so they
// are impossible to miss before publishing. Nothing here blocks a copy: it is a
// reviewing aid, not a gate.

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Check, Copy, Database, PenLine, RefreshCw, ShieldAlert, User } from "lucide-react";
import { getFormatSpec } from "@/lib/articles/formats";
import { PublishToSite } from "./publish-to-site";
import type { ArticleClaim, ArticleClaimSource, ArticleFormat, ArticleSeo } from "@/lib/articles/types";

export interface DraftView {
  id: string;
  format: ArticleFormat;
  language: string;
  publishedUrl: string | null;
  title: string | null;
  body: string;
  hooks: string[];
  hashtags: string[];
  claims: ArticleClaim[];
  seo: ArticleSeo | null;
}

type Props = {
  draft: DraftView;
  onRegenerate: () => void;
  regenerating: boolean;
  /** Persist an edited body/title back to the row. */
  onSave: (patch: { title?: string | null; body?: string }) => Promise<void>;
};

const CLAIM_STYLE: Record<
  ArticleClaimSource,
  { label: string; icon: typeof Database; cls: string }
> = {
  data: {
    label: "From our data",
    icon: Database,
    cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  user: { label: "You supplied", icon: User, cls: "border-sky-200 bg-sky-50 text-sky-800" },
  knowledge: {
    label: "Product fact",
    icon: PenLine,
    cls: "border-slate-200 bg-slate-50 text-slate-700",
  },
  unsourced: {
    label: "Unsourced, verify",
    icon: ShieldAlert,
    cls: "border-amber-300 bg-amber-50 text-amber-900",
  },
};

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy");
  }
}

export function DraftPanel({ draft, onRegenerate, regenerating, onSave }: Props) {
  const spec = getFormatSpec(draft.format);
  const [hookIndex, setHookIndex] = useState(0);
  const [body, setBody] = useState(draft.body);
  const [saving, setSaving] = useState(false);

  // A fresh generation replaces the draft entirely, so reset local edits.
  useEffect(() => {
    setBody(draft.body);
    setHookIndex(0);
  }, [draft.id, draft.body]);

  // Swapping the hook rewrites the first line of the body, since the body was
  // generated already opening with hooks[0].
  const composed = useMemo(() => {
    if (!draft.hooks.length || hookIndex === 0) return body;
    const lines = body.split("\n");
    const firstIdx = lines.findIndex((l) => l.trim().length > 0);
    if (firstIdx === -1) return body;
    const next = [...lines];
    next[firstIdx] = draft.hooks[hookIndex];
    return next.join("\n");
  }, [body, draft.hooks, hookIndex]);

  const hashtagLine = draft.hashtags.map((h) => `#${h}`).join(" ");
  const full = hashtagLine ? `${composed}\n\n${hashtagLine}` : composed;

  const unsourced = draft.claims.filter((c) => c.source === "unsourced").length;

  async function save() {
    setSaving(true);
    try {
      await onSave({ body: composed });
      toast.success("Saved");
    } catch {
      toast.error("Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">The draft</h2>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => copyText(full, spec?.label ?? "Draft")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy post
          </button>
          <button
            type="button"
            onClick={() => copyText(composed, "Body")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300"
          >
            Body only
          </button>
          {hashtagLine && (
            <button
              type="button"
              onClick={() => copyText(hashtagLine, "Hashtags")}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300"
            >
              Hashtags
            </button>
          )}
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
            Regenerate
          </button>
        </div>
      </div>

      {/* Straight to the website, for blog articles. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <PublishToSite
          articleId={draft.id}
          format={draft.format}
          language={draft.language}
          publishedUrl={draft.publishedUrl}
        />
      </div>

      {draft.title && (
        <p className="mt-3 text-base font-semibold text-slate-900">{draft.title}</p>
      )}

      {/* Hook variants */}
      {draft.hooks.length > 1 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500">
            Opening line, pick one
            {spec?.hookMaxChars ? ` (under ${spec.hookMaxChars} characters)` : ""}
          </p>
          <div className="mt-1.5 space-y-1.5">
            {draft.hooks.map((h, i) => {
              const over = spec?.hookMaxChars ? h.length > spec.hookMaxChars : false;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setHookIndex(i)}
                  className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    hookIndex === i
                      ? "border-indigo-400 bg-indigo-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      hookIndex === i ? "border-indigo-500 bg-indigo-500" : "border-slate-300"
                    }`}
                  >
                    {hookIndex === i && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-slate-800">{h}</span>
                    <span className={`text-[11px] ${over ? "text-amber-700" : "text-slate-400"}`}>
                      {h.length} characters{over ? ", over the limit for this channel" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium text-slate-500">
            Body {spec?.bodyFlavour === "markdown" ? "(Markdown)" : ""}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving || composed === draft.body}
            className="text-xs font-medium text-indigo-600 hover:underline disabled:text-slate-300 disabled:no-underline"
          >
            {saving ? "Saving…" : "Save edits"}
          </button>
        </div>
        <textarea
          value={composed}
          onChange={(e) => {
            // Editing after a hook swap: keep the edit, drop the swap state so
            // the two cannot fight each other.
            setHookIndex(0);
            setBody(e.target.value);
          }}
          rows={16}
          className="mt-1 w-full rounded-lg border border-slate-200 p-3 font-sans text-sm leading-relaxed outline-none focus:border-indigo-400"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          {composed.trim().split(/\s+/).filter(Boolean).length} words, {composed.length} characters
        </p>
      </div>

      {hashtagLine && (
        <p className="mt-2 text-sm text-indigo-600">{hashtagLine}</p>
      )}

      {/* SEO */}
      {draft.seo && spec?.wantsSeo && (draft.seo.metaTitle || draft.seo.slug) && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700">SEO</p>
          <dl className="mt-1.5 space-y-1 text-xs text-slate-600">
            {draft.seo.metaTitle && (
              <div>
                <dt className="inline font-medium">Meta title: </dt>
                <dd className="inline">{draft.seo.metaTitle}</dd>
              </div>
            )}
            {draft.seo.metaDescription && (
              <div>
                <dt className="inline font-medium">Meta description: </dt>
                <dd className="inline">
                  {draft.seo.metaDescription}{" "}
                  <span className="text-slate-400">({draft.seo.metaDescription.length} chars)</span>
                </dd>
              </div>
            )}
            {draft.seo.slug && (
              <div>
                <dt className="inline font-medium">Slug: </dt>
                <dd className="inline font-mono">{draft.seo.slug}</dd>
              </div>
            )}
            {draft.seo.internalLinkIdeas.length > 0 && (
              <div>
                <dt className="font-medium">Internal links to add:</dt>
                <dd>
                  <ul className="ml-4 list-disc">
                    {draft.seo.internalLinkIdeas.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Claims provenance */}
      {draft.claims.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">
              Every claim this makes, and where it came from
            </p>
            {unsourced > 0 && (
              <span className="text-xs font-medium text-amber-800">
                {unsourced} {unsourced === 1 ? "claim needs" : "claims need"} checking before you post
              </span>
            )}
          </div>
          <ul className="mt-2 space-y-1.5">
            {[...draft.claims]
              // Unsourced first: those are the ones that need a human.
              .sort((a, b) => (a.source === "unsourced" ? -1 : b.source === "unsourced" ? 1 : 0))
              .map((c, i) => {
                const style = CLAIM_STYLE[c.source] ?? CLAIM_STYLE.unsourced;
                const Icon = style.icon;
                return (
                  <li
                    key={i}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-xs ${style.cls}`}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block">{c.text}</span>
                      <span className="text-[11px] opacity-70">{style.label}</span>
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </section>
  );
}
