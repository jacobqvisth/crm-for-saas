"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { REPLY_SUBREDDITS, type ForumReply, type ReplySource } from "@/lib/forums/replies";
import type { ForumMentionLevel } from "@/lib/forums/types";
import type { RedditPost } from "@/lib/forums/reddit";

const MENTION_LABEL: Record<ForumMentionLevel, string> = {
  none: "No mention",
  subtle: "Subtle mention",
  explicit: "Explicit mention",
};

const STATUS_FILTERS = ["all", "draft", "posted", "archived"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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

  // Which source is currently being drafted (keyed by a stable id).
  const [draftingKey, setDraftingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forums/replies");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        if (!cancelled) setReplies(data.replies ?? []);
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
      if (data.error) setDiscoverError(data.error);
      setPosts(data.posts ?? []);
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : "Failed to search");
    } finally {
      setDiscovering(false);
    }
  }

  // Draft a reply from any source; prepend the new reply to the board.
  async function draftReply(source: ReplySource, key: string) {
    setDraftingKey(key);
    try {
      const res = await fetch("/api/forums/replies/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, mentionLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to draft reply");
        return;
      }
      setReplies((prev) => [data.reply as ForumReply, ...prev]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft reply");
    } finally {
      setDraftingKey(null);
    }
  }

  const filtered = replies.filter((r) => statusFilter === "all" || r.status === statusFilter);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Answer posts</h1>
          <p className="mt-1 text-sm text-slate-500">
            Find real questions people are asking and draft a genuinely helpful reply to post.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-1 border-b border-slate-200">
        <Link
          href="/forums"
          className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          Post generator
        </Link>
        <Link
          href="/forums/distribution"
          className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          Distribution
        </Link>
        <span className="border-b-2 border-orange-500 px-3 py-2 text-sm font-medium text-orange-700">
          Answer posts
        </span>
        <Link
          href="/forums/gaps"
          className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          Gap log
        </Link>
      </div>

      {/* How this works */}
      <div className="mt-4 rounded-lg border border-orange-100 bg-orange-50/60 px-4 py-3 text-sm text-orange-900">
        <span className="font-medium">How this works:</span> find an open question below (or paste a
        Reddit post URL), and I&apos;ll draft a helpful reply grounded in the actual problem. Copy it,
        post it as a comment yourself, and mark where you replied. Keep replies genuinely useful —
        the mention level controls whether Wrenchlane comes up at all.
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
              Reddit API isn&apos;t connected, so live search is off. Add{" "}
              <code className="rounded bg-amber-100 px-1">REDDIT_CLIENT_ID</code> and{" "}
              <code className="rounded bg-amber-100 px-1">REDDIT_CLIENT_SECRET</code> (a
              &quot;script&quot; app at reddit.com/prefs/apps) to enable it. You can still paste a
              post URL below to draft a reply.
            </span>
          </div>
        )}
        {discoverError && redditConfigured !== false && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> {discoverError}
          </div>
        )}

        {/* Results */}
        {posts.length > 0 && (
          <div className="mt-4 space-y-2">
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
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Your drafted replies</h2>
          <div className="flex gap-1">
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
              <ReplyCard
                key={r.id}
                reply={r}
                onChange={(u) => setReplies((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
                onRemoved={() => setReplies((prev) => prev.filter((x) => x.id !== r.id))}
              />
            ))}
          </div>
        )}
      </section>
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
  onChange,
  onRemoved,
}: {
  reply: ForumReply;
  onChange: (r: ForumReply) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.generated_body ?? "");
  const [showPosted, setShowPosted] = useState(false);
  const [postedUrl, setPostedUrl] = useState(reply.posted_url ?? "");

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
    const ok = await patch({ status: "posted", posted_url: postedUrl || null });
    if (ok) setShowPosted(false);
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

      {/* Mark-posted URL input */}
      {showPosted && reply.status !== "posted" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
      )}
    </div>
  );
}
