"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  EyeOff,
  RotateCcw,
  CheckCircle2,
  Inbox,
} from "lucide-react";
import { REPLY_SUBREDDITS, type ForumReply, type ReplySource } from "@/lib/forums/replies";
import type { RedditPost } from "@/lib/forums/reddit";
import {
  CANDIDATE_SORTS,
  DEFAULT_CANDIDATE_DAYS,
  type CandidateSort,
  type ForumCandidate,
  type ForumCandidateCounts,
  type ForumCandidateStatus,
} from "@/lib/forums/candidates";
import type { RedditAccount } from "@/lib/forums/accounts";
import {
  DEFAULT_GENERATION_OPTIONS,
  MENTION_LABEL,
  normalizeOptions,
  type ForumGenerationOptions,
} from "@/lib/forums/generation-options";
import { DraftOptionsModal } from "./draft-options-modal";
import { ApiErrorBanner } from "@/components/api-error-banner";
import {
  describeApiFailure,
  failureFromResponse,
  type ApiFailure,
} from "@/lib/auth/api-error";
import { OpenInProfile } from "./open-in-profile";
import { ForumsTabs } from "./forums-tabs";

// Stable draft key for the paste-a-URL panel (post cards key off their post id).
const PASTE_KEY = "paste";

const STATUS_FILTERS = ["all", "draft", "posted", "archived"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

// The queue's own filter chips (forum_candidates.status, plus "all").
const QUEUE_FILTERS = ["new", "answered", "skipped", "all"] as const;
type QueueFilter = (typeof QUEUE_FILTERS)[number];

const QUEUE_FILTER_LABEL: Record<QueueFilter, string> = {
  new: "Open",
  answered: "Answered",
  skipped: "Skipped",
  all: "All",
};

const QUEUE_SORT_LABEL: Record<CandidateSort, string> = {
  newest: "Newest question",
  comments: "Most comments",
  found: "Recently found",
};

// Age windows for the queue. 0 = no window (see DEFAULT_CANDIDATE_DAYS).
const QUEUE_WINDOWS: Array<{ days: number; label: string }> = [
  { days: 7, label: "7 days" },
  { days: DEFAULT_CANDIDATE_DAYS, label: "14 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "All time" },
];

// "Owner · u/handle" (or just the owner when the handle isn't filled in yet).
function accountLabel(a: RedditAccount): string {
  return a.username ? `${a.owner_label} · u/${a.username}` : `${a.owner_label} (handle pending)`;
}

function timeAgoMs(ms: number | null): string {
  if (!ms) return "";
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  const h = secs / 3600;
  if (h < 1) return `${Math.round(secs / 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function timeAgoIso(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "" : timeAgoMs(ms);
}

/**
 * One card in the queue. Normally this is a persisted forum_candidates row, but
 * if the queue write failed we still render what the scrape returned so the
 * search isn't wasted — those carry `id: null` and can't be skipped, because
 * there's no row to skip.
 */
interface QueueCard {
  key: string;
  id: string | null;
  subreddit: string | null;
  title: string;
  body: string | null;
  author: string | null;
  url: string | null;
  score: number | null;
  num_comments: number | null;
  postedAtMs: number | null;
  status: ForumCandidateStatus;
  replyId: string | null;
}

function cardFromCandidate(c: ForumCandidate): QueueCard {
  return {
    key: c.id,
    id: c.id,
    subreddit: c.subreddit,
    title: c.title,
    body: c.body,
    author: c.author,
    url: c.url,
    score: c.score,
    num_comments: c.num_comments,
    postedAtMs: c.posted_at ? Date.parse(c.posted_at) || null : null,
    status: c.status,
    replyId: c.reply_id,
  };
}

function cardFromPost(p: RedditPost): QueueCard {
  return {
    key: `unsaved:${p.id}`,
    id: null,
    subreddit: p.subreddit,
    title: p.title,
    body: p.body,
    author: p.author,
    url: p.url,
    score: p.score,
    num_comments: p.num_comments,
    postedAtMs: p.created_utc ? p.created_utc * 1000 : null,
    status: "new",
    replyId: null,
  };
}

export function AnswersClient() {
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Draft options are picked per post, in a modal, each time Draft reply is
  // clicked. This holds the last-used set so the modal opens pre-filled instead
  // of resetting to the defaults on every post.
  const [lastOptions, setLastOptions] = useState<ForumGenerationOptions>(
    DEFAULT_GENERATION_OPTIONS,
  );
  // The post waiting on a style choice — set by Draft reply, cleared on
  // confirm/cancel.
  const [pending, setPending] = useState<{
    source: ReplySource;
    key: string;
    title: string | null;
  } | null>(null);

  // Discovery state.
  const [subs, setSubs] = useState<Set<string>>(
    () => new Set(REPLY_SUBREDDITS.map((s) => s.name)),
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"new" | "hot">("new");
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [redditConfigured, setRedditConfigured] = useState<boolean | null>(null);
  const [searched, setSearched] = useState(false);
  // Live progress while the async Reddit scrape runs (one run per subreddit).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [foundSoFar, setFoundSoFar] = useState(0);

  // The persistent queue. Found posts are upserted into forum_candidates as the
  // scrape streams them in, so this survives a reload and a re-search no longer
  // costs an Apify run just to see what we already had.
  const [candidates, setCandidates] = useState<ForumCandidate[]>([]);
  const [counts, setCounts] = useState<ForumCandidateCounts | null>(null);
  const [lastFoundAt, setLastFoundAt] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("new");
  const [queueSort, setQueueSort] = useState<CandidateSort>("newest");
  const [queueDays, setQueueDays] = useState<number>(DEFAULT_CANDIDATE_DAYS);
  // Free-text filter over the questions we already hold. Deliberately local:
  // filtering persisted rows costs nothing, whereas the keyword box above fires
  // a fresh (paid, ~2 min) Reddit search.
  const [queueQuery, setQueueQuery] = useState("");
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  // Set only when persisting the scrape failed: render the raw results anyway,
  // flagged as unsaved, rather than pretending the search found nothing.
  const [unsavedPosts, setUnsavedPosts] = useState<RedditPost[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Which source is currently being drafted (keyed by a stable id).
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
  // The source whose draft most recently landed, so it can show a done state.
  const [draftedKey, setDraftedKey] = useState<string | null>(null);
  // Newest drafted reply — briefly highlighted so the user sees where it landed.
  const [newReplyId, setNewReplyId] = useState<string | null>(null);
  const draftedRef = useRef<HTMLElement>(null);

  // Read the queue. Runs on mount and whenever a queue control changes, so the
  // page opens with questions instead of an empty search box.
  const loadCandidates = useCallback(async () => {
    const params = new URLSearchParams({
      status: queueFilter,
      sort: queueSort,
      days: String(queueDays),
    });
    try {
      const res = await fetch(`/api/forums/candidates?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setCandidates(data.candidates ?? []);
      setCounts(data.counts ?? null);
      setLastFoundAt(data.lastFoundAt ?? null);
    } catch {
      // A failed queue read leaves the last-known list on screen; the page-level
      // banner already covers a lapsed session via reload().
    }
  }, [queueFilter, queueSort, queueDays]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  // The discovery poll loop spans many renders, so it reaches the queue read
  // through a ref rather than the version captured when the search began.
  const loadCandidatesRef = useRef(loadCandidates);
  useEffect(() => {
    loadCandidatesRef.current = loadCandidates;
  }, [loadCandidates]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, aRes] = await Promise.all([
        fetch("/api/forums/replies"),
        fetch("/api/forums/accounts"),
      ]);
      if (!rRes.ok) {
        // A 401 here means the session lapsed, not that forums is broken —
        // describeApiFailure turns it into copy with a way out.
        setError(await failureFromResponse(rRes, "Couldn't load the answer board."));
        return;
      }
      const rData = await rRes.json();
      const aData = aRes.ok ? await aRes.json() : { accounts: [] };
      setReplies(rData.replies ?? []);
      setAccounts(aData.accounts ?? []);
      setError(null);
    } catch {
      setError(
        describeApiFailure(0, null, "Couldn't reach the server. Check your connection and try again."),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    setProgress(null);
    setFoundSoFar(0);
    setUnsavedPosts([]);
    setSaveError(null);
    // A search adds to the queue rather than replacing it, so surface the open
    // questions while the scrape runs instead of whatever tab was showing.
    setQueueFilter("new");
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
      if (!res.ok) {
        const failure = await failureFromResponse(res, "Reddit search failed. Try again shortly.");
        // Auth problems aren't a search problem — send them to the page-level
        // banner, which is the one place that offers the way back in.
        if (failure.kind === "other") setDiscoverError(failure.message);
        else setError(failure);
        return;
      }
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
            savedError?: string | null;
          };
          try {
            const pres = await fetch("/api/forums/replies/discover/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // Recorded as provenance on the saved rows.
              body: JSON.stringify({ runs, query: query.trim() || undefined, sort }),
            });
            poll = await pres.json();
          } catch {
            continue; // transient — try again on the next tick
          }
          // The status route banks each tick's posts in forum_candidates, so the
          // queue read is what shows them — no separate ephemeral list to
          // reconcile, and the statuses (already answered? skipped?) come along.
          const batch = Array.isArray(poll.posts) ? poll.posts : [];
          setFoundSoFar((n) => Math.max(n, batch.length));
          if (poll.savedError) {
            setSaveError(poll.savedError);
            setUnsavedPosts(batch);
          } else if (batch.length > 0) {
            // Through the ref: this loop runs across many renders, and the
            // captured loadCandidates would still be querying the filter that
            // was active when the search started.
            await loadCandidatesRef.current();
          }
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

      // Inline "done" path (nothing configured, or a start error). Nothing to
      // persist here — this path never carries posts — so show them as-is.
      if (data.error) setDiscoverError(data.error);
      setUnsavedPosts(data.posts ?? []);
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : "Failed to search");
    } finally {
      setDiscovering(false);
      setProgress(null);
      // Final read, so the queue reflects the last tick even if the loop broke
      // out on `done` or hit its deadline mid-poll.
      void loadCandidatesRef.current();
    }
  }

  // Draft reply asks for the style first: open the modal for this post, and
  // only fire the generate call once the user confirms.
  function requestDraft(source: ReplySource, key: string) {
    setPending({ source, key, title: source.title || null });
  }

  function confirmDraft(options: ForumGenerationOptions) {
    if (!pending) return;
    const { source, key } = pending;
    setLastOptions(options);
    setPending(null);
    void draftReply(source, key, options);
  }

  // Draft a reply from any source; prepend the new reply to the board. The
  // board sits well below the post list, so on success we toast + scroll to it
  // and briefly highlight the new card — otherwise the click looks like a no-op.
  async function draftReply(source: ReplySource, key: string, options: ForumGenerationOptions) {
    setDraftingKey(key);
    const toastId = toast.loading("Drafting a reply…");
    try {
      const res = await fetch("/api/forums/replies/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, options }),
      });
      if (!res.ok) {
        const failure = await failureFromResponse(res, "Failed to draft reply");
        setError(failure);
        toast.error(failure.message, { id: toastId });
        return;
      }
      const data = await res.json();
      const reply = data.reply as ForumReply;
      setReplies((prev) => [reply, ...prev]);
      setStatusFilter("all");
      setError(null);
      // Lets the source that asked for this draft show a "done" state — the
      // paste panel uses it to offer Clear instead of keeping a stale post.
      setDraftedKey(key);
      toast.success("Reply drafted — added below", { id: toastId });
      setNewReplyId(reply.id);
      // The question is answered now: refresh the queue so its card flips out of
      // the open list instead of inviting a second reply to the same post.
      void loadCandidatesRef.current();
      // Let the new card render, then bring it into view + fade the highlight.
      setTimeout(() => draftedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      setTimeout(() => setNewReplyId(null), 2500);
    } catch (e) {
      const failure = describeApiFailure(
        0,
        e instanceof Error ? e.message : null,
        "Failed to draft reply",
      );
      setError(failure);
      toast.error(failure.message, { id: toastId });
    } finally {
      setDraftingKey(null);
    }
  }

  // Skip a question, or restore one skipped by mistake. Skipping is what keeps a
  // rejected post from reappearing at the top of every future search.
  async function setCandidateStatus(id: string, status: "new" | "skipped") {
    setSavingIds((prev) => new Set(prev).add(id));
    // Optimistic: the card either greys out or comes back immediately, then the
    // reload settles the chip counts.
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    try {
      const res = await fetch(`/api/forums/candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const failure = await failureFromResponse(res, "Couldn't update that post");
        toast.error(failure.message);
        if (failure.kind !== "other") setError(failure);
      } else if (status === "skipped") {
        toast.success("Skipped — it won't come back in future searches");
      }
    } catch {
      toast.error("Couldn't reach the server");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadCandidatesRef.current();
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

  // What the queue renders: the persisted rows normally, or the raw scrape
  // results when persisting them failed. The keyword filter runs locally, over
  // questions we already hold, so narrowing down costs nothing.
  const queueCards = useMemo<QueueCard[]>(() => {
    const base =
      saveError && unsavedPosts.length > 0
        ? unsavedPosts.map(cardFromPost)
        : candidates.map(cardFromCandidate);
    const q = queueQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c) =>
      `${c.title} ${c.body ?? ""} ${c.subreddit ?? ""}`.toLowerCase().includes(q),
    );
  }, [candidates, unsavedPosts, saveError, queueQuery]);

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
        genuinely useful — every <span className="font-medium">Draft reply</span> asks you for the
        style first, and the mention level controls whether Wrenchlane comes up at all.
      </div>

      <ApiErrorBanner failure={error} onRetry={reload} className="mt-4" />

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
              {foundSoFar > 0 && ` · ${foundSoFar} found so far`}
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
              The first search can take a couple of minutes while the scraper warms up — results are
              saved to the queue below as each subreddit finishes.
            </p>
          </div>
        )}
      </section>

      {/* The queue — every question we've found, kept across reloads */}
      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Inbox className="h-4 w-4 text-orange-600" /> Questions to answer
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {counts ? `${counts.new} open` : "Loading…"}
              {lastFoundAt ? ` · last found ${timeAgoIso(lastFoundAt)}` : ""} · kept between visits,
              so you don&apos;t have to search again
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUEUE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setQueueFilter(f)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  queueFilter === f
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {QUEUE_FILTER_LABEL[f]}
                {counts && <span className="ml-1 opacity-60">{counts[f]}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Narrowing the queue is free — no Reddit call, no Apify credits. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 min-w-[200px]">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={queueQuery}
              onChange={(e) => setQueueQuery(e.target.value)}
              placeholder="Filter what we've already found (no new search)…"
              className="w-full text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <select
            value={queueSort}
            onChange={(e) => setQueueSort(e.target.value as CandidateSort)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-600 outline-none"
          >
            {CANDIDATE_SORTS.map((s) => (
              <option key={s} value={s}>
                {QUEUE_SORT_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            value={queueDays}
            onChange={(e) => setQueueDays(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-600 outline-none"
            title="How old a question can be and still show"
          >
            {QUEUE_WINDOWS.map((w) => (
              <option key={w.days} value={w.days}>
                {w.label}
              </option>
            ))}
          </select>
        </div>

        {saveError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              These results couldn&apos;t be saved to the queue ({saveError}), so they&apos;ll be
              gone on reload. Draft anything you need now.
            </span>
          </div>
        )}

        {queueCards.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {queueCards.map((card) => (
              <QueueCardView
                key={card.key}
                card={card}
                busy={card.id ? savingIds.has(card.id) : false}
                drafting={draftingKey === card.key}
                onRequestDraft={requestDraft}
                onSetStatus={setCandidateStatus}
              />
            ))}
          </div>
        ) : (
          !discovering && (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
              {queueQuery.trim()
                ? "No saved questions match that filter."
                : searched && !discoverError
                  ? "That search came back empty. Try different keywords."
                  : counts && counts.all > 0
                    ? "Nothing here in this window. Try a longer window, or another tab."
                    : "Nothing found yet. Hit Find posts above, and everything we find stays here."}
            </p>
          )
        )}
      </section>

      {/* Paste a URL */}
      <PastePanel
        onRequestDraft={requestDraft}
        draftingKey={draftingKey}
        drafted={draftedKey === PASTE_KEY}
        onDismissDrafted={() => setDraftedKey(null)}
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

      {/* Per-post draft options — one modal, opened by whichever Draft reply was clicked */}
      <DraftOptionsModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmDraft}
        initial={lastOptions}
        postTitle={pending?.title}
      />
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

// --- One question in the queue ---------------------------------------------
//
// Answered and skipped questions stay on screen rather than vanishing: seeing
// what's already been dealt with is the point of persisting the queue, and a
// skip you didn't mean has to be undoable.
function QueueCardView({
  card,
  busy,
  drafting,
  onRequestDraft,
  onSetStatus,
}: {
  card: QueueCard;
  busy: boolean;
  drafting: boolean;
  onRequestDraft: (source: ReplySource, key: string) => void;
  onSetStatus: (id: string, status: "new" | "skipped") => void;
}) {
  const skipped = card.status === "skipped";
  const answered = card.status === "answered";

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        skipped
          ? "border-slate-200 bg-slate-50/70 opacity-60 hover:opacity-100"
          : "border-slate-200 hover:border-orange-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
          r/{card.subreddit ?? "unknown"}
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowUpToLine className="h-3 w-3" />
          {card.score ?? 0}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {card.num_comments ?? 0}
        </span>
        <span>{timeAgoMs(card.postedAtMs)}</span>
        {card.url && (
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-slate-800"
          >
            <ExternalLink className="h-3 w-3" /> open
          </a>
        )}
        {answered && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">
            <CheckCircle2 className="h-3 w-3" /> answered
          </span>
        )}
        {skipped && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600">
            <EyeOff className="h-3 w-3" /> skipped
          </span>
        )}
      </div>

      <p className="mt-1.5 text-sm font-medium text-slate-800">{card.title}</p>
      {card.body && (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-500">{card.body}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {answered ? (
          <span className="text-xs text-slate-400">Reply drafted — see the board below.</span>
        ) : skipped ? (
          <button
            onClick={() => card.id && onSetStatus(card.id, "new")}
            disabled={busy || !card.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Put back
          </button>
        ) : (
          <>
            <button
              onClick={() =>
                onRequestDraft(
                  {
                    url: card.url,
                    subreddit: card.subreddit,
                    title: card.title,
                    body: card.body,
                    author: card.author,
                    score: card.score,
                    num_comments: card.num_comments,
                  },
                  card.key,
                )
              }
              disabled={drafting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
            >
              {drafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Draft reply
            </button>
            {/* No row to update for an unsaved result, so there's nothing to skip. */}
            {card.id && (
              <button
                onClick={() => onSetStatus(card.id!, "skipped")}
                disabled={busy}
                title="Hide this one and keep it out of future searches"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                Skip
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Paste-a-URL panel (always-works path) ---------------------------------

function PastePanel({
  onRequestDraft,
  draftingKey,
  drafted,
  onDismissDrafted,
}: {
  // Opens the shared per-post draft-options modal; the generate call fires from
  // the parent once the style is confirmed.
  onRequestDraft: (source: ReplySource, key: string) => void;
  draftingKey: string | null;
  // Whether this panel's last draft landed. Owned by the parent because the
  // generate call happens there, after the options modal is confirmed.
  drafted: boolean;
  onDismissDrafted: () => void;
}) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<ApiFailure | null>(null);
  const [manual, setManual] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subreddit, setSubreddit] = useState("");

  // Wipe the panel back to empty. Without this a pasted post sticks around
  // after drafting, and the next paste looks like it edited the last one.
  function clearAll() {
    setUrl("");
    setTitle("");
    setBody("");
    setSubreddit("");
    setManual(false);
    setFetchError(null);
    onDismissDrafted();
  }

  async function loadUrl() {
    if (!url.trim()) return;
    setFetching(true);
    setFetchError(null);
    onDismissDrafted();
    try {
      const res = await fetch("/api/forums/replies/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) {
        const failure = await failureFromResponse(res, "Could not load that post");
        setFetchError(failure);
        // Typing the post in by hand only helps if the request failed for a
        // post-specific reason — it won't get you past a lapsed session.
        setManual(failure.kind === "other");
        return;
      }
      const data = await res.json();
      const p = data.post as RedditPost;
      setTitle(p.title);
      setBody(p.body);
      setSubreddit(p.subreddit);
      setManual(true);
    } catch (e) {
      setFetchError(
        describeApiFailure(0, e instanceof Error ? e.message : null, "Could not load that post"),
      );
      setManual(true);
    } finally {
      setFetching(false);
    }
  }

  const key = PASTE_KEY;
  const canDraft = title.trim().length > 0;
  const hasContent =
    url.trim().length > 0 ||
    title.trim().length > 0 ||
    body.trim().length > 0 ||
    subreddit.trim().length > 0;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Link2 className="h-4 w-4 text-orange-600" /> Or paste a Reddit post
        </h2>
        {hasContent && (
          <button
            onClick={clearAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
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

      {fetchError?.kind === "other" && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" /> {fetchError.message} — paste the title and body
          below.
        </div>
      )}
      {fetchError && fetchError.kind !== "other" && (
        <ApiErrorBanner failure={fetchError} className="mt-2" />
      )}

      {manual && (
        <div className="mt-3 space-y-2">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              onDismissDrafted();
            }}
            placeholder="Post title / the question"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-400"
          />
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              onDismissDrafted();
            }}
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
                onRequestDraft(
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
              {drafted ? "Draft another reply" : "Draft reply"}
            </button>
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <Trash2 className="h-4 w-4" /> Clear
            </button>
          </div>

          {drafted && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
              <Check className="h-3.5 w-3.5" /> Reply drafted and added below.
              <button
                onClick={clearAll}
                className="font-semibold underline underline-offset-2 hover:no-underline"
              >
                Clear this post
              </button>
              to paste another.
            </div>
          )}
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
  // Regenerate re-asks for the style too (the page no longer has a standing
  // options panel), seeded from what this reply was drafted with.
  const [showRegen, setShowRegen] = useState(false);
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

      {/* Open the original thread in the chosen account's Chrome profile to reply */}
      {!posted && reply.source_url && (
        <div className="mt-3">
          <OpenInProfile
            accounts={accounts}
            targetUrl={reply.source_url}
            body={reply.generated_body ?? ""}
            prefix="Reply as"
          />
        </div>
      )}

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
              onClick={() => setShowRegen(true)}
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

      {/* Regenerate with a fresh style choice for this one reply */}
      <DraftOptionsModal
        open={showRegen}
        onClose={() => setShowRegen(false)}
        onConfirm={(options) => {
          setShowRegen(false);
          void patch({ regenerate: true, options });
        }}
        initial={normalizeOptions({
          mentionLevel: reply.mention_level,
          ...(reply.generation_options ?? {}),
        })}
        postTitle={reply.source_title}
        confirmLabel="Regenerate"
      />
    </div>
  );
}
