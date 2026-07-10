"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  MessagesSquare,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Sparkles,
  Search,
  Link2,
  ArrowUpToLine,
  MessageSquare,
  RefreshCw,
  Trash2,
  Send,
  AlertTriangle,
  Info,
  User,
  Pencil,
} from "lucide-react";
import { REPLY_SUBREDDITS, type ForumReply, type ReplySource } from "@/lib/forums/replies";
import type { ForumMentionLevel } from "@/lib/forums/types";
import type { RedditPost } from "@/lib/forums/reddit";
import type { RedditAccount } from "@/lib/forums/accounts";
import { ForumsTabs } from "./forums-tabs";

const MENTION_LABEL: Record<ForumMentionLevel, string> = {
  none: "No mention",
  subtle: "Subtle mention",
  explicit: "Explicit mention",
};

const STATUS_FILTERS = ["all", "draft", "posted", "archived"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

// "Owner · u/handle" (or just the owner when the handle isn't filled in yet).
function accountLabel(a: RedditAccount): string {
  return a.username ? `${a.owner_label} · u/${a.username}` : `${a.owner_label} (handle pending)`;
}

function timeAgo(unixSeconds: number | null): string {
  if (!unixSeconds) return "";
  const secs = Math.max(0, Date.now() / 1000 - unixSeconds);
  const h = secs / 3600;
  if (h < 1) return `${Math.round(secs / 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AnswersClient() {
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Shared mention level for all drafting actions.
  const [mentionLevel, setMentionLevel] = useState<ForumMentionLevel>("none");

  // Discovery state.
  const [subs, setSubs] = useState<Set<string>>(
    () => new Set(REPLY_SUBREDDITS.map((s) => s.name)),
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"new" | "hot">("new");
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [redditConfigured, setRedditConfigured] = useState<boolean | null>(null);
  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [searched, setSearched] = useState(false);
  // Live progress while the async Reddit scrape runs (one run per subreddit).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Which source is currently being drafted (keyed by a stable id).
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
  // Newest drafted reply — briefly highlighted so the user sees where it landed.
  const [newReplyId, setNewReplyId] = useState<string | null>(null);
  const draftedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rRes, aRes] = await Promise.all([
          fetch("/api/forums/replies"),
          fetch("/api/forums/accounts"),
        ]);
        const rData = await rRes.json();
        if (!rRes.ok) throw new Error(rData.error ?? "Failed to load");
        const aData = aRes.ok ? await aRes.json() : { accounts: [] };
        if (!cancelled) {
          setReplies(rData.replies ?? []);
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

  function toggleSub(name: string) {
    setSubs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function discover() {
    setDiscovering(true);
    setDiscoverError(null);
    setSearched(true);
    setPosts([]);
    setProgress(null);
    try {
      const res = await fetch("/api/forums/replies/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subreddits: Array.from(subs),
          query: query.trim() || undefined,
          sort,
        }),
      });
      const data = await res.json();
      setRedditConfigured(data.redditConfigured ?? null);

      // Async Apify path: poll for progress, streaming posts in as each
      // subreddit's run finishes.
      if (data.mode === "async" && Array.isArray(data.runs) && data.runs.length > 0) {
        const runs = data.runs;
        setProgress({ done: 0, total: runs.length });
        const deadline = Date.now() + 300_000; // give up after ~5 min
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          let poll: {
            done?: boolean;
            posts?: RedditPost[];
            perSub?: { sub: string; status: string }[];
          };
          try {
            const pres = await fetch("/api/forums/replies/discover/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ runs }),
            });
            poll = await pres.json();
          } catch {
            continue; // transient — try again on the next tick
          }
          if (Array.isArray(poll.posts)) setPosts(poll.posts);
          const finished = (poll.perSub ?? []).filter(
            (s) => s.status === "succeeded" || s.status === "failed",
          ).length;
          setProgress({ done: finished, total: runs.length });
          if (poll.done) {
            const allFailed =
              (poll.perSub ?? []).length > 0 &&
              (poll.perSub ?? []).every((s) => s.status === "failed");
            if ((poll.posts?.length ?? 0) === 0 && allFailed) {
              setDiscoverError("Reddit search failed or timed out. Try again in a moment.");
            }
            break;
          }
        }
        return;
      }

      // Inline "done" path (nothing configured, or a start error).
      if (data.error) setDiscoverError(data.error);
      setPosts(data.posts ?? []);
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : "Failed to search");
    } finally {
      setDiscovering(false);
      setProgress(null);
    }
  }

  // Draft a reply from any source; prepend the new reply to the board. The
  // board sits well below the post list, so on success we toast + scroll to it
  // and briefly highlight the new card — otherwise the click looks like a no-op.
  async function draftReply(source: ReplySource, key: string) {
    setDraftingKey(key);
    const toastId = toast.loading("Drafting a reply…");
    try {
      const res = await fetch("/api/forums/replies/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, mentionLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to draft reply");
        toast.error(data.error ?? "Failed to draft reply", { id: toastId });
        return;
      }
      const reply = data.reply as ForumReply;
      setReplies((prev) => [reply, ...prev]);
      setStatusFilter("all");
      setError(null);
      toast.success("Reply drafted — added below", { id: toastId });
      setNewReplyId(reply.id);
      // Let the new card render, then bring it into view + fade the highlight.
      setTimeout(() => draftedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      setTimeout(() => setNewReplyId(null), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to draft reply";
      setError(msg);
      toast.error(msg, { id: toastId });
    } finally {
      setDraftingKey(null);
    }
  }

  async function refreshAllTraction() {
    setRefreshingAll(true);
    try {
      const res = await fetch("/api/forums/replies/refresh", { method: "POST" });
      const data = await res.json();
      if (res.ok) setReplies(data.replies ?? []);
    } finally {
      setRefreshingAll(false);
    }
  }

  const filtered = replies.filter((r) => statusFilter === "all" || r.status === statusFilter);

  const stats = useMemo(() => {
    const posted = replies.filter((r) => r.status === "posted");
    return {
      total: replies.length,
      posted: posted.length,
      upvotes: posted.reduce((n, r) => n + (r.score ?? 0), 0),
      comments: posted.reduce((n, r) => n + (r.num_comments ?? 0), 0),
    };
  }, [replies]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          <MessagesSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Answer posts</h1>
          <p className="text-sm text-slate-500">
            Find real questions people are asking and draft a genuinely helpful reply — then track
            who posted it and how it&apos;s doing.
          </p>
        </div>
      </div>

      <ForumsTabs active="answers" />

      {/* How this works */}
      <div className="mt-4 rounded-lg border border-orange-100 bg-orange-50/60 px-4 py-3 text-sm text-orange-900">
        <span className="font-medium">How this works:</span> find an open question below (or paste a
        Reddit post URL), and I&apos;ll draft a helpful reply grounded in the actual problem. Copy it,
        post it as a comment from one of your team&apos;s Reddit accounts, then mark it posted — pick{" "}
        <span className="font-medium">who posted it</span> and paste the link so we can{" "}
        <span className="font-medium">pull its upvotes and replies</span> later. Keep replies
        genuinely useful — the mention level controls whether Wrenchlane comes up at all.
      </div>

      {/* Shared mention-level control */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Wrenchlane mention:</span>
        {(["none", "subtle", "explicit"] as ForumMentionLevel[]).map((m) => (
          <button
            key={m}
            onClick={() => setMentionLevel(m)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              mentionLevel === m
                ? "border-orange-400 bg-orange-50 text-orange-700"
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
            }`}
          >
            {MENTION_LABEL[m]}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Find posts */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Search className="h-4 w-4 text-orange-600" /> Find posts to answer
        </h2>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {REPLY_SUBREDDITS.map((s) => (
            <button
              key={s.name}
              onClick={() => toggleSub(s.name)}
              title={s.blurb}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                subs.has(s.name)
                  ? "border-orange-300 bg-orange-50 text-orange-700"
                  : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 min-w-[220px]">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && discover()}
              placeholder="Optional keywords, e.g. brakes soft, P0300, won't start…"
              className="w-full text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
            {(["new", "hot"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-3 py-2 font-medium capitalize ${
                  sort === s ? "bg-orange-50 text-orange-700" : "bg-white text-slate-500"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={discover}
            disabled={discovering || subs.size === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {discovering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Find posts
          </button>
        </div>

        {redditConfigured === false && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              Reddit reads aren&apos;t set up, so live search is off. Add an{" "}
              <code className="rounded bg-amber-100 px-1">APIFY_TOKEN</code> to enable it. You can
              still paste a post URL below to draft a reply.
            </span>
          </div>
        )}
        {discoverError && redditConfigured !== false && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> {discoverError}
          </div>
        )}

        {/* Live progress while the async scrape runs */}
        {discovering && progress && (
          <div className="mt-3 space-y-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs font-medium text-orange-800">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching Reddit… {progress.done}/{progress.total} subreddits done
              {posts.length > 0 && ` · ${posts.length} found so far`}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-orange-100">
              <div
                className="h-full rounded-full bg-orange-500 transition-all duration-500"
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-orange-700/80">
              The first search can take a couple of minutes while the scraper warms up — results
              appear here as each subreddit finishes.
            </p>
          </div>
        )}

        {/* Results */}
        {posts.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {posts.map((p) => {
              const key = `post:${p.id}`;
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-slate-200 p-3 hover:border-orange-200"
                >
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                      r/{p.subreddit}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpToLine className="h-3 w-3" />
                      {p.score ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {p.num_comments ?? 0}
                    </span>
                    <span>{timeAgo(p.created_utc)}</span>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-slate-800"
                    >
                      <ExternalLink className="h-3 w-3" /> open
                    </a>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-slate-800">{p.title}</p>
                  {p.body && (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-500">
                      {p.body}
                    </p>
                  )}
                  <div className="mt-2">
                    <button
                      onClick={() =>
                        draftReply(
                          {
                            url: p.url,
                            subreddit: p.subreddit,
                            title: p.title,
                            body: p.body,
                            author: p.author,
                            score: p.score,
                            num_comments: p.num_comments,
                          },
                          key,
                        )
                      }
                      disabled={draftingKey === key}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                    >
                      {draftingKey === key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Draft reply
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {searched && !discovering && posts.length === 0 && !discoverError && redditConfigured && (
          <p className="mt-3 text-sm text-slate-400">No posts found. Try different keywords.</p>
        )}
      </section>

      {/* Paste a URL */}
      <PastePanel
        mentionLevel={mentionLevel}
        onDraft={draftReply}
        draftingKey={draftingKey}
      />

      {/* Drafted replies board */}
      <section className="mt-10 scroll-mt-4" ref={draftedRef}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Your drafted replies</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Mark each one posted with who sent it, then refresh to see its traction.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                  statusFilter === f
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Stats + bulk refresh */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatChip label="Drafted" value={stats.total} />
          <StatChip label="Posted" value={`${stats.posted}/${stats.total}`} />
          <StatChip
            label="Total upvotes"
            value={stats.upvotes}
            icon={<ArrowUpToLine className="h-3.5 w-3.5" />}
          />
          <StatChip
            label="Total replies"
            value={stats.comments}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
          />
          <button
            onClick={refreshAllTraction}
            disabled={refreshingAll || stats.posted === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            title={stats.posted === 0 ? "Mark a reply posted first" : "Pull live upvotes + replies from Reddit"}
          >
            {refreshingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh traction
          </button>
        </div>

        {loading ? (
          <div className="mt-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-400">
            No drafted replies yet. Find a post or paste a URL above to draft one.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {filtered.map((r) => (
              <div
                key={r.id}
                className={
                  r.id === newReplyId
                    ? "rounded-xl ring-2 ring-orange-400 transition-shadow"
                    : "transition-shadow"
                }
              >
                <ReplyCard
                  reply={r}
                  accounts={accounts}
                  onChange={(u) => setReplies((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
                  onRemoved={() => setReplies((prev) => prev.filter((x) => x.id !== r.id))}
                />
              </div>
            ))}
          </div>
        )}
      </section>
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

// --- Paste-a-URL panel (always-works path) ---------------------------------

function PastePanel({
  mentionLevel,
  onDraft,
  draftingKey,
}: {
  mentionLevel: ForumMentionLevel;
  onDraft: (source: ReplySource, key: string) => Promise<void>;
  draftingKey: string | null;
}) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subreddit, setSubreddit] = useState("");

  async function loadUrl() {
    if (!url.trim()) return;
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/forums/replies/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data.error ?? "Could not load that post");
        setManual(true);
        return;
      }
      const p = data.post as RedditPost;
      setTitle(p.title);
      setBody(p.body);
      setSubreddit(p.subreddit);
      setManual(true);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Could not load that post");
      setManual(true);
    } finally {
      setFetching(false);
    }
  }

  const key = "paste";
  const canDraft = title.trim().length > 0;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Link2 className="h-4 w-4 text-orange-600" /> Or paste a Reddit post
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadUrl()}
          placeholder="https://www.reddit.com/r/MechanicAdvice/comments/…"
          className="flex-1 min-w-[240px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
        />
        <button
          onClick={loadUrl}
          disabled={fetching || !url.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          Load
        </button>
        {!manual && (
          <button
            onClick={() => setManual(true)}
            className="text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            or type it in
          </button>
        )}
      </div>

      {fetchError && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" /> {fetchError} — paste the title and body below.
        </div>
      )}

      {manual && (
        <div className="mt-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Post title / the question"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Post body (optional but helps a lot)"
            rows={4}
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
          />
          <div className="flex items-center gap-2">
            <input
              value={subreddit}
              onChange={(e) => setSubreddit(e.target.value)}
              placeholder="subreddit (e.g. MechanicAdvice)"
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
            />
            <button
              onClick={() =>
                onDraft(
                  {
                    url: url.trim() || null,
                    subreddit: subreddit.trim() || null,
                    title: title.trim(),
                    body: body.trim() || null,
                  },
                  key,
                )
              }
              disabled={!canDraft || draftingKey === key}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {draftingKey === key ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Draft reply
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// --- One drafted reply -----------------------------------------------------

function StatusBadge({ status }: { status: ForumReply["status"] }) {
  const map: Record<ForumReply["status"], string> = {
    draft: "bg-slate-100 text-slate-600",
    posted: "bg-green-100 text-green-700",
    archived: "bg-slate-100 text-slate-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${map[status]}`}>
      {status}
    </span>
  );
}

function ReplyCard({
  reply,
  accounts,
  onChange,
  onRemoved,
}: {
  reply: ForumReply;
  accounts: RedditAccount[];
  onChange: (r: ForumReply) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.generated_body ?? "");
  const [showPosted, setShowPosted] = useState(false);
  const [postedUrl, setPostedUrl] = useState(reply.posted_url ?? "");
  const [postedByAccountId, setPostedByAccountId] = useState(reply.posted_by_account_id ?? "");
  const [editingTraction, setEditingTraction] = useState(false);
  const [manualScore, setManualScore] = useState(reply.score?.toString() ?? "");
  const [manualComments, setManualComments] = useState(reply.num_comments?.toString() ?? "");

  const posted = reply.status === "posted";
  const postedByAccount = accounts.find((a) => a.id === reply.posted_by_account_id) ?? null;
  // Flag when Reddit reports a different author than the picked account.
  const authorMismatch =
    !!reply.posted_by_username &&
    !!postedByAccount?.username &&
    reply.posted_by_username.toLowerCase() !== postedByAccount.username.toLowerCase();

  async function patch(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.reply) {
        onChange(data.reply as ForumReply);
        return true;
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!reply.generated_body) return;
    await navigator.clipboard.writeText(reply.generated_body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function saveEdit() {
    const ok = await patch({ generated_body: draft });
    if (ok) setEditing(false);
  }

  async function markPosted() {
    // Save URL + who posted first and return immediately — never block the save
    // on a Reddit traction fetch (it can be slow or blocked). Pull traction
    // afterwards in the background so the numbers still fill in on their own.
    const ok = await patch({
      status: "posted",
      posted_url: postedUrl || null,
      posted_by_account_id: postedByAccountId || null,
    });
    if (ok) {
      setShowPosted(false);
      if (postedUrl) void patch({ refresh: true });
    }
  }

  async function saveManualTraction() {
    const ok = await patch({
      score: manualScore === "" ? null : Number(manualScore),
      num_comments: manualComments === "" ? null : Number(manualComments),
    });
    if (ok) setEditingTraction(false);
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/replies/${reply.id}`, { method: "DELETE" });
      if (res.ok) onRemoved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {reply.source_subreddit && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
            r/{reply.source_subreddit}
          </span>
        )}
        <span className="rounded-full bg-orange-50 px-2 py-0.5 font-medium text-orange-700">
          {MENTION_LABEL[reply.mention_level]}
        </span>
        <StatusBadge status={reply.status} />
        {reply.source_url && (
          <a
            href={reply.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
          >
            <ExternalLink className="h-3 w-3" /> original post
          </a>
        )}
        {reply.posted_url && (
          <a
            href={reply.posted_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-green-600 hover:text-green-800"
          >
            <ExternalLink className="h-3 w-3" /> my reply
          </a>
        )}
      </div>

      {/* Traction (posted only) */}
      {posted && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-green-100 bg-green-50/50 px-3 py-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium text-green-800">
            <ArrowUpToLine className="h-3.5 w-3.5" />
            {reply.score ?? "—"}
            <span className="font-normal text-green-700">upvotes</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-green-800">
            <MessageSquare className="h-3.5 w-3.5" />
            {reply.num_comments ?? "—"}
            <span className="font-normal text-green-700">replies</span>
          </span>
          {typeof reply.upvote_ratio === "number" && (
            <span className="text-green-700">{Math.round(reply.upvote_ratio * 100)}% upvoted</span>
          )}
          <button
            onClick={() => patch({ refresh: true })}
            disabled={busy || !reply.posted_url}
            title={reply.posted_url ? "Auto-refresh from Reddit" : "Add the reply URL to auto-refresh"}
            className="inline-flex items-center gap-1 text-green-700 hover:text-green-900 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
          <button
            onClick={() => setEditingTraction((v) => !v)}
            className="inline-flex items-center gap-1 text-green-700 hover:text-green-900"
            title="Enter upvotes / replies manually"
          >
            <Pencil className="h-3 w-3" />
          </button>
          {reply.last_checked_at && (
            <span className="text-green-600/70">
              checked {new Date(reply.last_checked_at).toLocaleDateString()}
            </span>
          )}
          {reply.traction_note && <span className="text-amber-700">{reply.traction_note}</span>}
        </div>
      )}

      {posted && editingTraction && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-500">
            <ArrowUpToLine className="h-3.5 w-3.5" />
            <input
              type="number"
              value={manualScore}
              onChange={(e) => setManualScore(e.target.value)}
              placeholder="upvotes"
              className="w-20 rounded-lg border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="inline-flex items-center gap-1 text-slate-500">
            <MessageSquare className="h-3.5 w-3.5" />
            <input
              type="number"
              value={manualComments}
              onChange={(e) => setManualComments(e.target.value)}
              placeholder="replies"
              className="w-20 rounded-lg border border-slate-300 px-2 py-1"
            />
          </label>
          <button
            onClick={saveManualTraction}
            disabled={busy}
            className="rounded-lg bg-green-600 px-3 py-1 font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      )}

      {/* Posted-by attribution */}
      {posted && (postedByAccount || reply.posted_by_username) && (
        <p className="mt-2 inline-flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <User className="h-3 w-3 text-slate-400" />
          <span className="font-medium text-slate-600">Posted by</span>{" "}
          {postedByAccount ? (
            <span>{accountLabel(postedByAccount)}</span>
          ) : (
            <span>u/{reply.posted_by_username}</span>
          )}
          {authorMismatch && (
            <span className="text-amber-700">— Reddit says u/{reply.posted_by_username}</span>
          )}
        </p>
      )}

      {/* Source question */}
      {reply.source_title && (
        <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <MessagesSquare className="h-3 w-3" /> question
          </p>
          <p className="mt-0.5 text-sm font-medium text-slate-700">{reply.source_title}</p>
          {reply.source_body && (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">
              {reply.source_body}
            </p>
          )}
        </div>
      )}

      {/* Reply body */}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          className="mt-3 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
        />
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{reply.generated_body}</p>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              onClick={saveEdit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Save
            </button>
            <button
              onClick={() => {
                setDraft(reply.generated_body ?? "");
                setEditing(false);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy reply"}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Edit
            </button>
            <button
              onClick={() => patch({ regenerate: true })}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              title="Draft a fresh version from the same post"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenerate
            </button>
            {reply.status !== "posted" ? (
              <button
                onClick={() => setShowPosted((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
              >
                <Send className="h-3.5 w-3.5" /> Mark posted
              </button>
            ) : (
              <button
                onClick={() => patch({ status: "draft" })}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                Unmark posted
              </button>
            )}
            {reply.status !== "archived" ? (
              <button
                onClick={() => patch({ status: "archived" })}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-50 disabled:opacity-50"
              >
                Archive
              </button>
            ) : (
              <button
                onClick={() => patch({ status: "draft" })}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                Restore
              </button>
            )}
            <button
              onClick={remove}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Mark-posted panel — who posted it + the comment URL */}
      {showPosted && reply.status !== "posted" && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <select
              value={postedByAccountId}
              onChange={(e) => setPostedByAccountId(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
            >
              <option value="">Posted by… (which Reddit account?)</option>
              {accounts
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={postedUrl}
              onChange={(e) => setPostedUrl(e.target.value)}
              placeholder="Link to your comment (optional)"
              className="flex-1 min-w-[220px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-green-400"
            />
            <button
              onClick={markPosted}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
