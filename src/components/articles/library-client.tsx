"use client";

// The article list, in two modes.
//
//   published=false  the working list: drafts and anything not yet live
//   published=true   the Published tab: only what actually went out
//
// A row's action set depends on where it can still go, which is why not every row
// shows the same buttons. See BUTTON RULES below.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BarChart3, Car, ChevronDown, ChevronUp, Copy, Loader2, PenLine, ShieldAlert, Trash2 } from "lucide-react";
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
  webflow_item_id?: string | null;
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

export function LibraryClient({ published = false }: { published?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [formatFilter, setFormatFilter] = useState<ArticleFormat | "">("");
  const [sourceFilter, setSourceFilter] = useState<ArticleSourceKind | "">("");
  // Which rows are expanded to full text, so a piece can be read before publishing.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (formatFilter) params.set("format", formatFilter);
      if (published) params.set("status", "published");
      const qs = params.toString() ? `?${params}` : "";
      const res = await fetch(`/api/articles${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const all: Row[] = data.articles ?? [];
      // The Published tab shows only live rows; the working list hides them, so a
      // row moves from one tab to the other rather than appearing in both.
      setRows(published ? all : all.filter((r) => r.status !== "published"));
    } catch {
      toast.error("Could not load the library");
    } finally {
      setLoading(false);
    }
  }, [formatFilter, published]);

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

  const visible = sourceFilter ? rows.filter((r) => r.source_kind === sourceFilter) : rows;

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

      {/* Second axis: what the piece was built from. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Built from
        </span>
        <button
          type="button"
          onClick={() => setSourceFilter("")}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            sourceFilter === ""
              ? "border-indigo-400 bg-indigo-50 text-indigo-700"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
          }`}
        >
          Any
        </button>
        {(["diagnostic", "stats", "free_topic"] as ArticleSourceKind[]).map((k) => {
          const Icon = SOURCE_ICON[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSourceFilter(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                sourceFilter === k
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}
            >
              <Icon className="h-3 w-3" />
              {SOURCE_LABEL[k]}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">
          {published
            ? "Nothing published yet. Publish a blog article from the Library, or mark a post as published once you have put it out."
            : "Nothing here yet. Write something in the Studio."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((row) => {
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
                    // Hover card rather than a title attribute: this is the one
                    // badge whose meaning actually changes whether you publish.
                    <span className="group relative inline-flex">
                      <span className="inline-flex cursor-help items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        <ShieldAlert className="h-3 w-3" />
                        {unsourced} unsourced
                      </span>
                      <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-80 rounded-lg border border-slate-200 bg-white p-3 text-left text-[11px] leading-relaxed text-slate-600 shadow-lg group-hover:block">
                        <span className="mb-1 block font-semibold text-slate-900">
                          {unsourced} {unsourced === 1 ? "claim is" : "claims are"} not traceable to data
                        </span>
                        Every factual statement in a draft is labelled with where it came
                        from: our platform data, a figure you typed in, or a product fact.
                        These {unsourced} are the model&apos;s own words, so nothing backs
                        them up. That is allowed, but read them before this goes public.
                        {claims.length > 0 && (
                          <span className="mt-1.5 block text-slate-400">
                            {claims.length - unsourced} of {claims.length} claims in this
                            piece are sourced.
                          </span>
                        )}
                      </span>
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-slate-400">
                    {new Date(row.created_at).toLocaleDateString()}
                  </span>
                </div>

                {row.title && (
                  <p className="mt-2 text-sm font-semibold text-slate-900">{row.title}</p>
                )}
                <p
                  className={`mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600 ${
                    expanded[row.id] ? "" : "line-clamp-3"
                  }`}
                >
                  {row.body}
                </p>
                {(row.body?.length ?? 0) > 240 && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                    }
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
                  >
                    {expanded[row.id] ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        Read the whole thing
                      </>
                    )}
                  </button>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => copy(row)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                  {/* BUTTON RULES
                      "Mark published" is the manual record for channels we cannot
                      post to (LinkedIn, X, Facebook). It is pointless once a URL
                      is already recorded, so it hides then.
                      The link to the piece is rendered by PublishToSite below, so
                      there is deliberately no second "View" button here. */}
                  {!row.published_url && (
                    <button
                      type="button"
                      onClick={() => markPublished(row)}
                      title="Record that you posted this yourself, on LinkedIn or anywhere else"
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300"
                    >
                      Mark published
                    </button>
                  )}
                  {row.status !== "archived" && !published && (
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
                    status={row.status}
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
