"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MessagesSquare,
  Share2,
  Car,
  Layers,
  Loader2,
  ArrowUpToLine,
  MessageSquare,
  ExternalLink,
  ArrowRight,
  Search,
  User,
} from "lucide-react";
import { ForumsTabs } from "./forums-tabs";
import { ForumsClient, PostCard } from "./forums-client";
import { DistributionClient } from "./distribution-client";
import { TOPICS, type DistributionRec } from "@/lib/forums/distribution";
import { getForumTarget } from "@/lib/forums/targets";
import type { ForumPost } from "@/lib/forums/types";
import type { RedditAccount } from "@/lib/forums/accounts";

// The three views of the unified Posts board. "topics" is the Distribution
// campaign workflow, "diagnostics" is the AI post generator, "all" is a
// read-only federated list of everything tracked across both.
export type HubView = "all" | "topics" | "diagnostics";

const VIEWS: Array<{ key: HubView; label: string; icon: typeof Layers; hint: string }> = [
  { key: "all", label: "All posts", icon: Layers, hint: "Every post you're tracking, both kinds" },
  { key: "topics", label: "New: topic campaign", icon: Share2, hint: "One message across many subreddits" },
  { key: "diagnostics", label: "New: from a diagnostic", icon: Car, hint: "AI-written from a real diagnostic case" },
];

export function ForumsHub({ initialView = "all" }: { initialView?: HubView }) {
  const [view, setView] = useState<HubView>(initialView);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-2 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          <MessagesSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Posts</h1>
          <p className="text-sm text-slate-500">
            Everything you post to forums, in one place — pick a subject to campaign across many
            communities, or spin a post out of a real diagnostic. Track who posted each one and how
            it&apos;s doing.
          </p>
        </div>
      </div>

      <ForumsTabs active="posts" />

      {/* View switch */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = view === v.key;
            return (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                title={v.hint}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-orange-600" : "text-slate-400"}`} />
                {v.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 sm:text-right">
          {VIEWS.find((v) => v.key === view)?.hint}
        </p>
      </div>

      {/* Active view. The two workflow panels are the existing clients, embedded
          (they render their own body but not the page header/tabs). */}
      <div className="mt-6">
        {view === "all" && (
          <AllPanel
            onNewTopic={() => setView("topics")}
            onNewDiagnostic={() => setView("diagnostics")}
          />
        )}
        {view === "topics" && <DistributionClient embedded />}
        {view === "diagnostics" && <ForumsClient embedded />}
      </div>
    </div>
  );
}

// --- All posts: a federated, read-only summary across both kinds -----------

type UnifiedStatus = "to_post" | "posted" | "skipped" | "archived";

interface UnifiedRow {
  key: string;
  kind: "topic" | "diagnostic";
  title: string;
  where: string; // subreddit or forum name
  category: string; // topic label or post-type
  status: UnifiedStatus;
  postedByAccountId: string | null;
  postedByUsername: string | null;
  score: number | null;
  numComments: number | null;
  upvoteRatio: number | null;
  postedUrl: string | null;
  href: string | null; // topic recs manage on their own detail page
  diagPostId: string | null; // diagnostic posts manage inline on this board
}

const STATUS_META: Record<UnifiedStatus, { label: string; cls: string }> = {
  to_post: { label: "To post", cls: "bg-slate-100 text-slate-600" },
  posted: { label: "Posted", cls: "bg-green-50 text-green-700" },
  skipped: { label: "Skipped", cls: "bg-slate-100 text-slate-400" },
  archived: { label: "Archived", cls: "bg-slate-100 text-slate-400" },
};

const STATUS_FILTERS: Array<{ key: "all" | UnifiedStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "to_post", label: "To post" },
  { key: "posted", label: "Posted" },
];

function recStatus(s: DistributionRec["status"]): UnifiedStatus {
  if (s === "posted") return "posted";
  if (s === "skipped") return "skipped";
  return "to_post";
}
function postStatus(s: ForumPost["status"]): UnifiedStatus {
  if (s === "posted") return "posted";
  if (s === "archived") return "archived";
  return "to_post"; // idea / drafted
}

function carLabel(p: ForumPost): string {
  const snap = p.scenario_snapshot as { carYear?: number | null; carMake?: string | null; carModel?: string | null };
  const parts = [snap?.carYear, snap?.carMake, snap?.carModel].filter(Boolean);
  return parts.length ? parts.join(" ") : "Diagnostic post";
}

function AllPanel({
  onNewTopic,
  onNewDiagnostic,
}: {
  onNewTopic: () => void;
  onNewDiagnostic: () => void;
}) {
  const [recs, setRecs] = useState<DistributionRec[]>([]);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | UnifiedStatus>("all");
  const [q, setQ] = useState("");
  // Which diagnostic row is expanded to its full inline PostCard.
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dRes, pRes, aRes] = await Promise.all([
          fetch("/api/forums/distribution?topic=all"),
          fetch("/api/forums"),
          fetch("/api/forums/accounts"),
        ]);
        const dData = await dRes.json();
        const pData = await pRes.json();
        const aData = aRes.ok ? await aRes.json() : { accounts: [] };
        if (!dRes.ok) throw new Error(dData.error ?? "Failed to load campaigns");
        if (!pRes.ok) throw new Error(pData.error ?? "Failed to load posts");
        if (!cancelled) {
          setRecs(dData.recs ?? []);
          setPosts(pData.posts ?? []);
          setAccounts(aData.accounts ?? []);
        }
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

  const rows: UnifiedRow[] = useMemo(() => {
    const fromRecs: UnifiedRow[] = recs.map((r) => ({
      key: `topic:${r.id}`,
      kind: "topic",
      title: r.suggested_title || r.subreddit,
      where: r.subreddit,
      category: TOPICS[r.topic]?.menuLabel ?? TOPICS[r.topic]?.title ?? r.topic,
      status: recStatus(r.status),
      postedByAccountId: r.posted_by_account_id,
      postedByUsername: r.posted_by_username,
      score: r.score,
      numComments: r.num_comments,
      upvoteRatio: r.upvote_ratio,
      postedUrl: r.posted_url,
      href: `/forums/distribution/${r.id}`,
      diagPostId: null,
    }));
    const fromPosts: UnifiedRow[] = posts.map((p) => ({
      key: `diag:${p.id}`,
      kind: "diagnostic",
      title: p.generated_title || carLabel(p),
      where: getForumTarget(p.forum_target)?.name ?? p.forum_target,
      category: carLabel(p),
      status: postStatus(p.status),
      postedByAccountId: p.assigned_account_id,
      postedByUsername: null,
      score: p.score,
      numComments: p.num_comments,
      upvoteRatio: p.upvote_ratio,
      postedUrl: p.posted_url,
      href: null,
      diagPostId: p.id,
    }));
    return [...fromRecs, ...fromPosts];
  }, [recs, posts]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (needle && !`${r.title} ${r.where} ${r.category}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, statusFilter, q]);

  const stats = useMemo(() => {
    const posted = rows.filter((r) => r.status === "posted");
    return {
      total: rows.length,
      posted: posted.length,
      upvotes: posted.reduce((n, r) => n + (r.score ?? 0), 0),
      comments: posted.reduce((n, r) => n + (r.numComments ?? 0), 0),
    };
  }, [rows]);

  function ownerLabel(accountId: string | null, username: string | null): string | null {
    if (accountId) {
      const a = accounts.find((x) => x.id === accountId);
      if (a) return a.username ? `${a.owner_label} · u/${a.username}` : a.owner_label;
    }
    if (username) return `u/${username}`;
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading all posts…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div>
      {/* Create a new post — both sources land on this same board */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-400">New post:</span>
        <button
          onClick={onNewTopic}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-orange-300 hover:text-orange-700"
        >
          <Share2 className="h-4 w-4 text-orange-600" /> From a topic
        </button>
        <button
          onClick={onNewDiagnostic}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-orange-300 hover:text-orange-700"
        >
          <Car className="h-4 w-4 text-blue-600" /> From a diagnostic
        </button>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap items-center gap-3">
        <StatChip label="Total posts" value={stats.total} />
        <StatChip label="Posted" value={`${stats.posted}/${stats.total}`} />
        <StatChip label="Total upvotes" value={stats.upvotes} icon={<ArrowUpToLine className="h-3.5 w-3.5" />} />
        <StatChip label="Total comments" value={stats.comments} icon={<MessageSquare className="h-3.5 w-3.5" />} />
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 min-w-[220px]">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by title, subreddit or topic…"
            className="w-full text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-2 font-medium ${
                statusFilter === f.key ? "bg-orange-50 text-orange-700" : "bg-white text-slate-500"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Federated list */}
      {shown.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">
          {rows.length === 0
            ? "Nothing here yet. Start a topic campaign or generate a post from a diagnostic."
            : "No posts match this filter."}
        </p>
      ) : (
        <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {shown.map((r) => {
            const owner = ownerLabel(r.postedByAccountId, r.postedByUsername);
            const inner = (
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                {/* Kind icon */}
                <span
                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                    r.kind === "topic" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"
                  }`}
                  title={r.kind === "topic" ? "Topic campaign" : "From a diagnostic"}
                >
                  {r.kind === "topic" ? <Share2 className="h-4 w-4" /> : <Car className="h-4 w-4" />}
                </span>

                {/* Title + where/category */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{r.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                    <span className="font-medium text-slate-600">{r.where}</span>
                    <span className="text-slate-300">·</span>
                    <span>{r.category}</span>
                    {owner && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-0.5">
                          <User className="h-3 w-3 text-slate-400" /> {owner}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {/* Traction (posted only) */}
                {r.status === "posted" && (
                  <div className="hidden flex-shrink-0 items-center gap-3 text-[11px] text-slate-600 sm:flex">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <ArrowUpToLine className="h-3.5 w-3.5 text-slate-400" />
                      {r.score ?? "—"}
                    </span>
                    <span className="inline-flex items-center gap-1 font-medium">
                      <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                      {r.numComments ?? "—"}
                    </span>
                    {typeof r.upvoteRatio === "number" && (
                      <span className="text-slate-400">{Math.round(r.upvoteRatio * 100)}%</span>
                    )}
                    {r.postedUrl && (
                      <a
                        href={r.postedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-slate-400 hover:text-slate-700"
                        title="Open on Reddit"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}

                {/* Status + affordance */}
                <span
                  className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_META[r.status].cls}`}
                >
                  {STATUS_META[r.status].label}
                </span>
                <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-300" />
              </div>
            );
            if (r.href) {
              return (
                <Link key={r.key} href={r.href} className="block">
                  {inner}
                </Link>
              );
            }
            const diagPost = posts.find((p) => p.id === r.diagPostId) ?? null;
            const isOpen = expanded === r.key;
            return (
              <div key={r.key}>
                <button
                  onClick={() => setExpanded(isOpen ? null : r.key)}
                  className="block w-full text-left"
                  title={isOpen ? "Collapse" : "Open to manage this post"}
                >
                  {inner}
                </button>
                {isOpen && diagPost && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                    <PostCard
                      post={diagPost}
                      accounts={accounts}
                      onPatched={(updated) =>
                        setPosts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
                      }
                      onRemoved={() => {
                        setPosts((prev) => prev.filter((x) => x.id !== diagPost.id));
                        setExpanded(null);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      {icon && <span className="text-slate-400">{icon}</span>}
      <span className="text-sm font-semibold text-slate-900">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}
