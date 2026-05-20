"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Sparkles, RefreshCw, Save, ArrowLeft, Info } from "lucide-react";

type LoadResponse = {
  content_md: string;
  source: "db" | "seed";
  updated_at: string | null;
  updated_by_email: string | null;
  default_md: string;
};

export function AiKnowledgeClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [defaultMd, setDefaultMd] = useState("");
  const [source, setSource] = useState<"db" | "seed">("seed");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/ai-knowledge");
      if (!res.ok) throw new Error("Failed to load knowledge");
      const data = (await res.json()) as LoadResponse;
      setContent(data.content_md);
      setSavedContent(data.content_md);
      setDefaultMd(data.default_md);
      setSource(data.source);
      setUpdatedAt(data.updated_at);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = content !== savedContent;
  const wordCount = useMemo(
    () => (content.trim() ? content.trim().split(/\s+/).length : 0),
    [content],
  );
  const charCount = content.length;

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      toast.error("Knowledge can't be empty");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ai-knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_md: content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      setSavedContent(content);
      setSource("db");
      setUpdatedAt(new Date().toISOString());
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [content]);

  const handleResetToDefaults = useCallback(() => {
    if (!confirm("Replace the editor with the built-in default knowledge? Your unsaved edits will be lost (but nothing is saved until you click Save).")) {
      return;
    }
    setContent(defaultMd);
  }, [defaultMd]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 mb-2"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Settings
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">AI Product Knowledge</h1>
        </div>
        <p className="text-sm text-slate-500">
          What the AI is told about Wrenchlane when it drafts inbox replies and generates cold emails. Edit anything here and the next AI call will use the updated text — no deploy needed.
        </p>
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-slate-700">
        <div className="flex gap-2">
          <Info className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-indigo-900">Where this content is used</p>
            <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5">
              <li>Inbox <strong>draft-reply</strong> suggestions on non-English threads — system prompt sent to Claude.</li>
              <li>Cold-email <strong>AI generation</strong> on the sequence builder (the &ldquo;Generate&rdquo; button).</li>
            </ul>
            <p className="text-xs text-slate-500 pt-1">
              The content is markdown. Sections like the YouTube table, pricing tiers, and objection playbook are recognized by the AI when written as headed lists. To keep the AI from inventing things, keep features/links/stats verbatim.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <span>
                Status:{" "}
                {source === "db" ? (
                  <span className="font-medium text-slate-700">
                    Custom (saved
                    {updatedAt && ` ${new Date(updatedAt).toLocaleString()}`})
                  </span>
                ) : (
                  <span className="font-medium text-amber-700">
                    Using built-in defaults — never edited
                  </span>
                )}
              </span>
              {dirty && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span>
                {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars
              </span>
            </div>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            rows={32}
            className="w-full font-mono text-xs leading-relaxed border border-slate-200 rounded-lg px-3 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleResetToDefaults}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100"
              disabled={content === defaultMd}
              title={
                content === defaultMd
                  ? "Already showing the defaults"
                  : "Replace the editor with the built-in defaults"
              }
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset to defaults
            </button>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  type="button"
                  onClick={() => setContent(savedContent)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Discard changes
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
