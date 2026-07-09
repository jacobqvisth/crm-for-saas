"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MessagesSquare,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Sparkles,
  Car,
  AlertTriangle,
  X,
  RefreshCw,
  Trash2,
  Pencil,
  Send,
  ArrowUpToLine,
  MessageSquare,
} from "lucide-react";
import { FORUM_TARGETS, getForumTarget } from "@/lib/forums/targets";
import { AccountsPanel } from "./accounts-panel";
import { TeamComments } from "./team-comments";
import type { RedditAccount } from "@/lib/forums/accounts";
import type {
  ForumMentionLevel,
  ForumPost,
  ForumPostType,
  ForumScenario,
} from "@/lib/forums/types";

const POST_TYPE_LABEL: Record<ForumPostType, string> = {
  help_question: "Help question",
  solved_story: "Solved-it story",
  helpful_answer: "Helpful answer",
};

const MENTION_LABEL: Record<ForumMentionLevel, string> = {
  none: "No mention",
  subtle: "Subtle mention",
  explicit: "Explicit mention",
};

const STATUS_FILTERS = ["all", "drafted", "posted", "archived"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function ForumsClient() {
  const [scenarios, setScenarios] = useState<ForumScenario[]>([]);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generateFor, setGenerateFor] = useState<ForumScenario | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshingAll, setRefreshingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sRes, pRes, aRes] = await Promise.all([
          fetch("/api/forums/scenarios"),
          fetch("/api/forums"),
          fetch("/api/forums/accounts"),
        ]);
        if (!sRes.ok) throw new Error((await sRes.json()).error ?? "Failed to load scenarios");
        if (!pRes.ok) throw new Error((await pRes.json()).error ?? "Failed to load posts");
        const sData = await sRes.json();
        const pData = await pRes.json();
        const aData = aRes.ok ? await aRes.json() : { accounts: [] };
        if (!cancelled) {
          setScenarios(sData.scenarios ?? []);
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

  const shownPosts = useMemo(
    () => (statusFilter === "all" ? posts : posts.filter((p) => p.status === statusFilter)),
    [posts, statusFilter],
  );

  function onGenerated(post: ForumPost) {
    setPosts((prev) => [post, ...prev]);
    setGenerateFor(null);
  }

  function patchPost(updated: ForumPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function removePost(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }

  const postedCount = useMemo(
    () => posts.filter((p) => p.status === "posted").length,
    [posts],
  );

  async function refreshAllTraction() {
    setRefreshingAll(true);
    try {
      const res = await fetch("/api/forums/refresh", { method: "POST" });
      const data = await res.json();
      if (res.ok) setPosts(data.posts ?? []);
    } finally {
      setRefreshingAll(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          <MessagesSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Forums</h1>
          <p className="text-sm text-slate-500">
            Turn real diagnostic scenarios into ready-to-paste forum posts.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-1 border-b border-slate-200">
        <span className="border-b-2 border-orange-500 px-3 py-2 text-sm font-medium text-orange-700">
          Post generator
        </span>
        <Link
          href="/forums/distribution"
          className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          Distribution
        </Link>
        <Link
          href="/forums/answers"
          className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          Answer posts
        </Link>
      </div>

      {/* Workflow note */}
      <div className="mt-4 rounded-lg border border-orange-100 bg-orange-50/60 px-4 py-3 text-sm text-orange-900">
        <span className="font-medium">How this works:</span> pick a real car
        problem from the scenarios below, choose a forum and an angle, and
        I&apos;ll write a post that reads like a real owner wrote it — grounded in
        the actual symptoms, codes and likely causes. Then copy it and paste it
        into Reddit yourself, and mark where you posted it.
      </div>

      {/* Forum targets */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Target forums (English Reddit)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {FORUM_TARGETS.map((t) => (
            <a
              key={t.key}
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-lg border border-slate-200 bg-white p-3 hover:border-orange-300 hover:shadow-sm transition-colors"
            >
              <div className="flex items-center gap-2">
                <MessagesSquare className="h-4 w-4 text-orange-600 flex-shrink-0" />
                <span className="text-sm font-medium text-slate-800 group-hover:text-orange-700 truncate">
                  {t.name}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 line-clamp-2">{t.blurb}</p>
            </a>
          ))}
        </div>
      </section>

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading scenarios…
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Reddit account roster */}
          <AccountsPanel accounts={accounts} onChange={setAccounts} />

          {/* Generated posts */}
          <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Generated posts{" "}
                <span className="ml-1 text-slate-400">({posts.length})</span>
              </h2>
              <div className="flex items-center gap-1">
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                      statusFilter === s
                        ? "bg-slate-800 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={refreshAllTraction}
                  disabled={refreshingAll || postedCount === 0}
                  title={
                    postedCount === 0
                      ? "Mark a post as posted first"
                      : "Pull live upvotes + comments from Reddit"
                  }
                  className="ml-2 inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  {refreshingAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Refresh traction
                </button>
              </div>
            </div>

            {shownPosts.length === 0 ? (
              <p className="text-sm text-slate-500 py-6">
                {posts.length === 0
                  ? "No posts yet. Pick a scenario below and generate your first one."
                  : "No posts with this status."}
              </p>
            ) : (
              <div className="space-y-4">
                {shownPosts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    accounts={accounts}
                    onPatched={patchPost}
                    onRemoved={() => removePost(p.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Scenario browser */}
          <section className="mt-12">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">
              Real diagnostic scenarios{" "}
              <span className="ml-1 text-slate-400">({scenarios.length})</span>
            </h2>
            {scenarios.length === 0 ? (
              <p className="text-sm text-slate-500 py-6">
                No diagnostic scenarios available yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {scenarios.map((s) => (
                  <ScenarioCard
                    key={s.diagnosticId}
                    scenario={s}
                    onCreate={() => setGenerateFor(s)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {generateFor && (
        <GenerateModal
          scenario={generateFor}
          onClose={() => setGenerateFor(null)}
          onGenerated={onGenerated}
        />
      )}
    </div>
  );
}

function carLabel(s: ForumScenario): string {
  const parts = [s.carYear, s.carMake, s.carModel].filter(Boolean);
  return parts.length ? parts.join(" ") : "Unknown vehicle";
}

function ScenarioCard({
  scenario,
  onCreate,
}: {
  scenario: ForumScenario;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2">
        <Car className="h-4 w-4 text-slate-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-900">{carLabel(scenario)}</span>
      </div>

      {scenario.description && (
        <p className="mt-2 text-xs text-slate-600 line-clamp-3">{scenario.description}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {scenario.dtcs.slice(0, 4).map((code) => (
          <span
            key={code}
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
          >
            {code}
          </span>
        ))}
        {scenario.symptoms.slice(0, 3).map((sym) => (
          <span
            key={sym}
            className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700"
          >
            {sym}
          </span>
        ))}
      </div>

      {scenario.topCauseName && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          <span className="font-medium text-slate-700">Likely:</span>{" "}
          {scenario.topCauseName}
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100">
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 transition-colors"
        >
          <Sparkles className="h-4 w-4" /> Create post
        </button>
      </div>
    </div>
  );
}

function GenerateModal({
  scenario,
  onClose,
  onGenerated,
}: {
  scenario: ForumScenario;
  onClose: () => void;
  onGenerated: (post: ForumPost) => void;
}) {
  const [forumTarget, setForumTarget] = useState(FORUM_TARGETS[0].key);
  const [postType, setPostType] = useState<ForumPostType>("help_question");
  const [mentionLevel, setMentionLevel] = useState<ForumMentionLevel>("none");
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const target = getForumTarget(forumTarget);

  async function generate() {
    setGenerating(true);
    setErr(null);
    try {
      const res = await fetch("/api/forums/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, forumTarget, postType, mentionLevel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      onGenerated(data.post as ForumPost);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Create forum post</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-medium text-slate-800">{carLabel(scenario)}</span>
            {scenario.topCauseName && <> · likely {scenario.topCauseName}</>}
          </div>

          <Field label="Forum">
            <select
              value={forumTarget}
              onChange={(e) => setForumTarget(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-orange-500"
            >
              {FORUM_TARGETS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
            {target && <p className="mt-1 text-[11px] text-slate-400">{target.rulesNote}</p>}
          </Field>

          <Field label="Angle">
            <select
              value={postType}
              onChange={(e) => setPostType(e.target.value as ForumPostType)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-orange-500"
            >
              {(Object.keys(POST_TYPE_LABEL) as ForumPostType[]).map((k) => (
                <option key={k} value={k}>
                  {POST_TYPE_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Wrenchlane mention">
            <select
              value={mentionLevel}
              onChange={(e) => setMentionLevel(e.target.value as ForumMentionLevel)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-orange-500"
            >
              {(Object.keys(MENTION_LABEL) as ForumMentionLevel[]).map((k) => (
                <option key={k} value={k}>
                  {MENTION_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>

          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Writing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function PostCard({
  post,
  accounts,
  onPatched,
  onRemoved,
}: {
  post: ForumPost;
  accounts: RedditAccount[];
  onPatched: (p: ForumPost) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(post.generated_title ?? "");
  const [draftBody, setDraftBody] = useState(post.generated_body ?? "");
  const [showPostedInput, setShowPostedInput] = useState(false);
  const [postedUrl, setPostedUrl] = useState(post.posted_url ?? "");
  const [editingTraction, setEditingTraction] = useState(false);
  const [manualScore, setManualScore] = useState(post.score?.toString() ?? "");
  const [manualComments, setManualComments] = useState(post.num_comments?.toString() ?? "");

  const target = getForumTarget(post.forum_target);
  const subreddit = post.forum_target.split(":")[1] ?? "";
  const submitUrl = subreddit
    ? `https://www.reddit.com/r/${subreddit}/submit`
    : (target?.url ?? "https://www.reddit.com");
  const assigned = accounts.find((a) => a.id === post.assigned_account_id) ?? null;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onPatched(data.post as ForumPost);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const ok = await patch({ generated_title: draftTitle, generated_body: draftBody });
    if (ok) setEditing(false);
  }

  async function regenerate() {
    await patch({ regenerate: true });
  }

  async function markPosted() {
    const ok = await patch({
      status: "posted",
      posted_url: postedUrl || null,
      refresh: Boolean(postedUrl),
    });
    if (ok) setShowPostedInput(false);
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
      const res = await fetch(`/api/forums/${post.id}`, { method: "DELETE" });
      if (res.ok) onRemoved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 font-medium text-orange-700">
          {target?.name ?? post.forum_target}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
          {POST_TYPE_LABEL[post.post_type]}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
          {MENTION_LABEL[post.mention_level]}
        </span>
        <StatusBadge status={post.status} />
        {assigned && (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700">
            {assigned.owner_label}
            {assigned.username ? ` · u/${assigned.username}` : ""}
          </span>
        )}
        {post.posted_url && (
          <a
            href={post.posted_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
          >
            <ExternalLink className="h-3 w-3" /> view
          </a>
        )}
      </div>

      {/* Traction (posted only) */}
      {post.status === "posted" && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-green-100 bg-green-50/50 px-3 py-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium text-green-800">
            <ArrowUpToLine className="h-3.5 w-3.5" />
            {post.score ?? "—"}
            <span className="font-normal text-green-700">upvotes</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-green-800">
            <MessageSquare className="h-3.5 w-3.5" />
            {post.num_comments ?? "—"}
            <span className="font-normal text-green-700">comments</span>
          </span>
          {typeof post.upvote_ratio === "number" && (
            <span className="text-green-700">{Math.round(post.upvote_ratio * 100)}% upvoted</span>
          )}
          <button
            onClick={() => patch({ refresh: true })}
            disabled={busy}
            className="inline-flex items-center gap-1 text-green-700 hover:text-green-900 disabled:opacity-50"
            title="Auto-refresh from Reddit"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={() => setEditingTraction((v) => !v)}
            className="inline-flex items-center gap-1 text-green-700 hover:text-green-900"
            title="Enter upvotes / comments manually"
          >
            <Pencil className="h-3 w-3" />
          </button>
          {post.last_checked_at && (
            <span className="text-green-600/70">
              checked {new Date(post.last_checked_at).toLocaleDateString()}
            </span>
          )}
          {post.traction_note && (
            <span className="text-amber-700">{post.traction_note}</span>
          )}
        </div>
      )}

      {post.status === "posted" && editingTraction && (
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
              placeholder="comments"
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

      {/* Body */}
      {editing ? (
        <div className="mt-3 space-y-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
            placeholder="Title"
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Body"
          />
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              disabled={busy}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-60"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraftTitle(post.generated_title ?? "");
                setDraftBody(post.generated_body ?? "");
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {post.generated_title}
            </h3>
            <CopyButton text={post.generated_title ?? ""} label="Title" />
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="mb-1 flex justify-end">
              <CopyButton text={post.generated_body ?? ""} label="Body" />
            </div>
            <p className="whitespace-pre-wrap text-xs text-slate-700">
              {post.generated_body}
            </p>
          </div>
        </div>
      )}

      {/* Per-member team comments (posted only) */}
      {post.status === "posted" && !editing && (
        <TeamComments
          assignments={post.assignments ?? []}
          source="post"
          sourceId={post.id}
          slackNotifiedAt={post.slack_notified_at}
          onResend={() => patch({ resend_slack: true })}
          resendBusy={busy}
        />
      )}

      {/* Actions */}
      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <CopyButton
            text={`${post.generated_title ?? ""}\n\n${post.generated_body ?? ""}`}
            label="Copy all"
            prominent
          />
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            onClick={regenerate}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}{" "}
            Regenerate
          </button>
          {post.status !== "posted" && (
            <>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <span className="sr-only">Assign to</span>
                <select
                  value={post.assigned_account_id ?? ""}
                  onChange={(e) => patch({ assigned_account_id: e.target.value || null })}
                  disabled={busy}
                  title="Assign to a team member's Reddit account"
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                >
                  <option value="">Unassigned</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.owner_label}
                      {a.username ? ` (u/${a.username})` : " — no username"}
                    </option>
                  ))}
                </select>
              </label>
              <a
                href={submitUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the subreddit's submit page in a new tab, then paste"
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open submit page
              </a>
            </>
          )}
          {post.status !== "posted" ? (
            <button
              onClick={() => setShowPostedInput((v) => !v)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" /> Mark posted
            </button>
          ) : (
            <button
              onClick={() => patch({ status: "archived" })}
              disabled={busy}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60"
            >
              Archive
            </button>
          )}
          <button
            onClick={remove}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}

      {showPostedInput && !editing && (
        <div className="mt-2 flex gap-2">
          <input
            value={postedUrl}
            onChange={(e) => setPostedUrl(e.target.value)}
            placeholder="Paste the URL where you posted it (optional)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
          <button
            onClick={markPosted}
            disabled={busy}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    drafted: "bg-blue-50 text-blue-700",
    posted: "bg-green-50 text-green-700",
    archived: "bg-slate-100 text-slate-500",
    idea: "bg-amber-50 text-amber-700",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-medium capitalize ${
        styles[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

function CopyButton({
  text,
  label,
  prominent,
}: {
  text: string;
  label: string;
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  if (prominent) {
    return (
      <button
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : label}
      </button>
    );
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}
