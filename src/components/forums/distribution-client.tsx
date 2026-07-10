"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Share2,
  Loader2,
  ArrowUpToLine,
  MessageSquare,
  RefreshCw,
  MessagesSquare,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import {
  DEFAULT_TOPIC,
  TOPICS,
  TIER_META,
  type DistributionRec,
  type DistributionTier,
} from "@/lib/forums/distribution";
import { ContributorsPanel } from "./contributors-panel";
import { ForumsTabs } from "./forums-tabs";

const TIER_ORDER: DistributionTier[] = ["best_fit", "trade", "ai_angle"];

type BoardView = "todo" | "posted";

// Topics in dropdown order (object insertion order in TOPICS).
const TOPIC_LIST = Object.values(TOPICS);

export function DistributionClient() {
  const [selectedTopic, setSelectedTopic] = useState<string>(DEFAULT_TOPIC);
  const topic = TOPICS[selectedTopic] ?? TOPICS[DEFAULT_TOPIC];
  const [recs, setRecs] = useState<DistributionRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [view, setView] = useState<BoardView>("todo");

  // Load (and seed on first visit) the board for the selected topic. Re-runs
  // whenever the topic changes so switching the dropdown swaps the board.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/forums/distribution?topic=${encodeURIComponent(selectedTopic)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        if (!cancelled) setRecs(data.recs ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTopic]);

  async function refreshAll() {
    setRefreshingAll(true);
    try {
      const res = await fetch(
        `/api/forums/distribution/refresh?topic=${encodeURIComponent(selectedTopic)}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok) setRecs(data.recs ?? []);
    } finally {
      setRefreshingAll(false);
    }
  }

  const stats = useMemo(() => {
    const posted = recs.filter((r) => r.status === "posted");
    return {
      total: recs.length,
      posted: posted.length,
      upvotes: posted.reduce((n, r) => n + (r.score ?? 0), 0),
      comments: posted.reduce((n, r) => n + (r.num_comments ?? 0), 0),
    };
  }, [recs]);

  // "To be posted" = anything not yet posted (recommended first, skipped last).
  // "Posted" = the ones live on Reddit. Tier grouping is preserved inside each.
  const todoRecs = useMemo(
    () =>
      recs
        .filter((r) => r.status !== "posted")
        .sort((a, b) => Number(a.status === "skipped") - Number(b.status === "skipped")),
    [recs],
  );
  const postedRecs = useMemo(() => recs.filter((r) => r.status === "posted"), [recs]);
  const shown = view === "posted" ? postedRecs : todoRecs;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          <Share2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Distribution</h1>
          <p className="text-sm text-slate-500">
            Where to post <span className="font-medium text-slate-700">“{topic.title}”</span>.
            Track what you&apos;ve posted and how it&apos;s doing.
          </p>
        </div>
      </div>

      <ForumsTabs active="distribution" />

      {/* Topic picker — rotate the angle so we're not posting the same thing every week */}
      <div className="mt-5 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <label
          htmlFor="topic-select"
          className="flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Topic to post
        </label>
        <select
          id="topic-select"
          value={selectedTopic}
          onChange={(e) => setSelectedTopic(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-300 sm:min-w-[18rem]"
        >
          {TOPIC_LIST.map((t) => (
            <option key={t.key} value={t.key}>
              {t.menuLabel ?? t.title}
            </option>
          ))}
        </select>
        {topic.goal && (
          <p className="text-xs text-slate-500 sm:border-l sm:border-slate-200 sm:pl-4">
            <span className="font-medium text-slate-600">Goal:</span> {topic.goal}
          </p>
        )}
      </div>

      {/* What this is */}
      <div className="mt-5 rounded-lg border border-orange-100 bg-orange-50/60 px-4 py-3 text-sm text-orange-900">
        <span className="font-medium">The post:</span> {topic.summary} Below are the communities to
        post it in, ranked by how welcome a discussion post is. Open one to see the full post, mark
        it posted (paste the URL) — that also pings <span className="font-medium">#forum-posts</span>{" "}
        in Slack with a ready-to-paste reply so the team can jump in from their own Reddit accounts.
        Then hit <span className="font-medium">Refresh traction</span> to auto-pull upvotes and
        comments.
        <div className="mt-2 text-xs text-orange-800/90">
          <span className="font-medium">Careful:</span> don&apos;t post the same text to every sub
          the same day — Reddit&apos;s spam filter flags rapid cross-posting. Space them out, tweak
          the title per sub (each row has a tailored one), and never drop a Wrenchlane link or it
          gets removed as an ad.
        </div>
      </div>

      {/* Stats + refresh */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <StatChip label="Recommended" value={stats.total} />
        <StatChip label="Posted" value={`${stats.posted}/${stats.total}`} />
        <StatChip label="Total upvotes" value={stats.upvotes} icon={<ArrowUpToLine className="h-3.5 w-3.5" />} />
        <StatChip label="Total comments" value={stats.comments} icon={<MessageSquare className="h-3.5 w-3.5" />} />
        <button
          onClick={refreshAll}
          disabled={refreshingAll || stats.posted === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          title={stats.posted === 0 ? "Mark something posted first" : "Pull live upvotes + comments from Reddit"}
        >
          {refreshingAll ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh traction
        </button>
      </div>

      <ContributorsPanel />

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading recommendations…
        </div>
      ) : (
        <>
          {/* Posted / To be posted toggle */}
          <div className="mt-8 flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
            <ViewTab
              label="To be posted"
              count={todoRecs.length}
              active={view === "todo"}
              onClick={() => setView("todo")}
            />
            <ViewTab
              label="Posted"
              count={postedRecs.length}
              active={view === "posted"}
              onClick={() => setView("posted")}
            />
          </div>

          {shown.length === 0 ? (
            <p className="mt-8 text-sm text-slate-500">
              {view === "posted"
                ? "Nothing posted yet. Open a recommendation under “To be posted” and mark it once it's live."
                : "All recommendations have been posted. 🎉"}
            </p>
          ) : (
            <div className="mt-6 space-y-10">
              {TIER_ORDER.map((tier) => {
                const group = shown.filter((r) => r.tier === tier);
                if (group.length === 0) return null;
                const meta = TIER_META[tier];
                return (
                  <section key={tier}>
                    <div className="mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                        <span className="text-xs text-slate-500">{meta.blurb}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {group.map((rec) => (
                        <SummaryCard key={rec.id} rec={rec} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ViewTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
          active ? "bg-slate-100 text-slate-600" : "bg-slate-200/70 text-slate-500"
        }`}
      >
        {count}
      </span>
    </button>
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

// A compact, read-only summary of one recommendation. The whole card links to
// the post's own page (/forums/distribution/[id]) where you copy the text, mark
// it posted, edit traction and manage the thread — everything about that post.
function SummaryCard({ rec }: { rec: DistributionRec }) {
  const posted = rec.status === "posted";
  const skipped = rec.status === "skipped";
  return (
    <Link
      href={`/forums/distribution/${rec.id}`}
      className={`group flex flex-col rounded-xl border bg-white p-4 transition-colors hover:border-orange-300 hover:shadow-sm ${
        posted ? "border-green-200" : skipped ? "border-slate-200 opacity-70" : "border-slate-200"
      }`}
    >
      {/* Header row — subreddit + status + the "open" affordance up top */}
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <MessagesSquare className="h-4 w-4 text-orange-600 flex-shrink-0" />
          <span className="truncate text-sm font-semibold text-slate-900 group-hover:text-orange-700">
            {rec.subreddit}
          </span>
        </span>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <StatusBadge status={rec.status} />
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-orange-500" />
        </div>
      </div>

      {/* Tailored title + why it fits */}
      {rec.suggested_title && (
        <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-800">{rec.suggested_title}</p>
      )}
      {rec.fit_reason && (
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{rec.fit_reason}</p>
      )}

      {/* Footer — traction for posted, "open" for the rest */}
      <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs">
        {posted ? (
          <>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700">
              <ArrowUpToLine className="h-3.5 w-3.5 text-slate-400" />
              {rec.score ?? "—"}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700">
              <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
              {rec.num_comments ?? "—"}
            </span>
            {typeof rec.upvote_ratio === "number" && (
              <span className="text-slate-500">{Math.round(rec.upvote_ratio * 100)}% upvoted</span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-indigo-600 group-hover:text-indigo-700">
              Open thread <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-slate-500 group-hover:text-orange-600">
            {skipped ? "Skipped — open to restore" : "Open to post"}
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    recommended: "bg-slate-100 text-slate-600",
    posted: "bg-green-50 text-green-700",
    skipped: "bg-slate-100 text-slate-400",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
        styles[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}
