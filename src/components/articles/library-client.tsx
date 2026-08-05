"use client";

// Everything written so far. Copy buttons on each row, plus marking something
// published with the URL it went out on, mirroring forum_posts.posted_url.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BarChart3, Car, Copy, ExternalLink, Loader2, PenLine, Trash2 } from "lucide-react";
import { FORMAT_ORDER, FORMAT_SPECS } from "@/lib/articles/formats";
import { PublishToSite } from "./publish-to-site";
import type { ArticleClaim, ArticleFormat, ArticleSourceKind } from "@/lib/articles/types";

type Row = {
  id: string;
  source_kind: ArticleSourceKind;
  source_ref: string | null;
  format: ArticleFormat;
  language: string;
  title: string | null;
  body: string | null;
  hashtags: string[] | null;
  claims: unknown;
  status: string;
  published_url: string | null;
  published_at: string | null;
  created_at: string;
};

const SOURCE_ICON: Record<ArticleSourceKind, typeof Car> = {
  diagnostic: Car,
  stats: BarChart3,
  free_topic: PenLine,
};

const SOURCE_LABEL: Record<ArticleSourceKind, string> = {
  diagnostic: "Real diagnostic",
  stats: "Our data",
  free_topic: "Topic only",
};

export function LibraryClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [formatFilter, setFormatFilter] = useState<ArticleFormat | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = formatFilter ? `?format=${formatFilter}` : "";
      const res = await fetch(`/api/articles${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.articles ?? []);
    } catch {
      toast.error("Could not load the library");
    } finally {
      setLoading(false);
    }
  }, [formatFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(row: Row) {
    const tags = (row.hashtags ?? []).map((h) => `#${h}`).join(" ");
    const text = tags ? `${row.body ?? ""}\n\n${tags}` : row.body ?? "";
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) {
      toast.error("Update failed");
      return;
    }
    await load();
  }

  async function markPublished(row: Row) {
    const url = window.prompt("Where did it go live? Paste the URL.", row.published_url ?? "");
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("A URL is needed to mark it published");
      return;
    }
    await patch(row.id, { status: "published", published_url: trimmed });
    toast.success("Marked published");
  }

  async function remove(row: Row) {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    const res = await fetch(`/api/articles?id=${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Deleted");
    await load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFormatFilter("")}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            formatFilter === ""
              ? "border-indigo-400 bg-indigo-50 text-indigo-700"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
          }`}
        >
          All
        </button>
        {FORMAT_ORDER.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFormatFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              formatFilter === f
                ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
            }`}
          >
            {FORMAT_SPECS[f].label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">
          Nothing here yet. Write something in the Studio.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => {
            const Icon = SOURCE_ICON[row.source_kind] ?? PenLine;
            const claims = Array.isArray(row.claims) ? (row.claims as ArticleClaim[]) : [];
            const unsourced = claims.filter((c) => c.source === "unsourced").length;
            return (
              <li key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {FORMAT_SPECS[row.format]?.label ?? row.format}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <Icon className="h-3 w-3" />
                    {SOURCE_LABEL[row.source_kind] ?? row.source_kind}
                  </span>
                  {row.language !== "en" && (
                    <span className="text-[11px] uppercase text-slate-400">{row.language}</span>
                  )}
                  {row.status === "published" ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      Published
                    </span>
                  ) : (
                    <span className="rounded bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {row.status}
                    </span>
                  )}
                  {unsourced > 0 && (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      {unsourced} unsourced
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-slate-400">
                    {new Date(row.created_at).toLocaleDateString()}
                  </span>
                </div>

                {row.title && (
                  <p className="mt-2 text-sm font-semibold text-slate-900">{row.title}</p>
                )}
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                  {row.body}
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => copy(row)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                  {row.status !== "published" && (
                    <button
                      type="button"
                      onClick={() => markPublished(row)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300"
                    >
                      Mark published
                    </button>
                  )}
                  {row.published_url && (
                    <a
                      href={row.published_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View
                    </a>
                  )}
                  {row.status !== "archived" && (
                    <button
                      type="button"
                      onClick={() => patch(row.id, { status: "archived" })}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-slate-300"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-red-300 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <PublishToSite
                    articleId={row.id}
                    format={row.format}
                    language={row.language}
                    publishedUrl={row.published_url}
                    onPublished={() => void load()}
                    compact
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
