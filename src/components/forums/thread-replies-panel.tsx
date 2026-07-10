"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CornerDownRight,
  Loader2,
  Sparkles,
  ArrowUpToLine,
  ExternalLink,
  User,
  Reply,
  Pencil,
  Copy,
  Check,
  RotateCcw,
  CircleSlash,
} from "lucide-react";
import type { ForumMentionLevel, ForumThreadReply } from "@/lib/forums/types";
import type { RedditAccount } from "@/lib/forums/accounts";

// "Reply to other people's comments" — reads the live Reddit thread, drafts a
// reply to each comment worth engaging, assigns it to a teammate, and tracks it.
// Source-agnostic: works for a topic-campaign post (source="distribution") or a
// diagnostic post (source="post"). The reply rows live in forum_thread_replies
// keyed on (source, source_id); the backend analyze + thread GET both branch on
// `source`, and the per-reply PATCH keys only on the reply id.
export function ThreadRepliesPanel({
  source,
  sourceId,
  postUrl,
  posted,
  accounts,
  initialReplies,
}: {
  source: "distribution" | "post";
  sourceId: string;
  postUrl: string | null;
  posted: boolean;
  accounts: RedditAccount[];
  // When provided (the campaign thread page already loads them), seed from these
  // and skip the fetch. When omitted (inline diagnostic card), fetch on mount.
  initialReplies?: ForumThreadReply[];
}) {
  const [replies, setReplies] = useState<ForumThreadReply[]>(initialReplies ?? []);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeNote, setAnalyzeNote] = useState<string | null>(null);

  const loadReplies = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/forums/thread?source=${source}&source_id=${encodeURIComponent(sourceId)}`,
      );
      const data = await res.json();
      if (res.ok) setReplies((data.replies ?? []) as ForumThreadReply[]);
    } catch {
      // leave empty; Analyze will populate
    }
  }, [source, sourceId]);

  useEffect(() => {
    if (initialReplies === undefined && posted) loadReplies();
    // Only on mount / when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, posted]);

  async function analyze() {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeNote(null);
    try {
      const res = await fetch(`/api/forums/thread/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, source_id: sourceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data.error ?? "Analysis failed");
        return;
      }
      setReplies((data.replies ?? []) as ForumThreadReply[]);
      if (data.note) setAnalyzeNote(data.note);
      else
        setAnalyzeNote(
          `Read ${data.analyzed ?? 0} comments and drafted ${(data.replies ?? []).length} replies.`,
        );
    } catch {
      setAnalyzeError("Analysis failed — try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  function onReplyPatched(updated: ForumThreadReply) {
    setReplies((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  const postedCount = replies.filter((r) => r.status === "posted").length;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <CornerDownRight className="h-4 w-4 text-indigo-500" />
            Reply to other people&apos;s comments
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Reads the live thread, picks the comments worth engaging, and drafts a reply for each
            one, assigned to the teammate it fits. Copy, paste it as a reply on Reddit from that
            person&apos;s account, then mark it posted.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={analyze}
            disabled={analyzing || !posted || !postUrl}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            title={!postUrl ? "Mark this posted with its URL first" : "Analyze the thread"}
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {replies.length > 0 ? "Re-analyze thread" : "Analyze thread"}
          </button>
          {analyzing && (
            <span className="text-[11px] text-slate-400">this can take a minute or two…</span>
          )}
        </div>
      </div>

      {postedCount > 0 && (
        <p className="mt-2 text-[11px] font-medium text-indigo-500">
          {postedCount}/{replies.length} replies posted
        </p>
      )}

      {analyzeError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {analyzeError}
        </div>
      )}
      {analyzeNote && !analyzeError && (
        <p className="mt-2 text-xs text-slate-500">{analyzeNote}</p>
      )}

      {!posted && (
        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
          Mark this <span className="font-medium">posted</span> (with its Reddit URL) before
          analyzing its thread.
        </div>
      )}

      {replies.length === 0
        ? posted && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">
                No replies drafted yet. Hit <span className="font-medium">Analyze thread</span> to
                pull the comments and draft replies.
              </p>
            </div>
          )
        : (
          <div className="mt-4 space-y-4">
            {replies.map((r) => (
              <ReplyCard key={r.id} reply={r} accounts={accounts} onPatched={onReplyPatched} />
            ))}
          </div>
        )}
    </section>
  );
}

const MENTION_META: Record<ForumMentionLevel, { label: string; cls: string }> = {
  none: { label: "pure help", cls: "bg-slate-100 text-slate-500" },
  subtle: { label: "subtle AI aside", cls: "bg-amber-50 text-amber-700" },
  explicit: { label: "may name Wrenchlane", cls: "bg-orange-100 text-orange-700" },
};

function ReplyCard({
  reply,
  accounts,
  onPatched,
}: {
  reply: ForumThreadReply;
  accounts: RedditAccount[];
  onPatched: (r: ForumThreadReply) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.reply_text ?? "");
  const posted = reply.status === "posted";
  const skipped = reply.status === "skipped";
  const mention = MENTION_META[reply.mention_level] ?? MENTION_META.none;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/thread/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.reply) {
        onPatched(data.reply as ForumThreadReply);
        return true;
      }
    } finally {
      setBusy(false);
    }
    return false;
  }

  async function copy() {
    if (!reply.reply_text) return;
    try {
      await navigator.clipboard.writeText(reply.reply_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function saveEdit() {
    const ok = await patch({ reply_text: draft });
    if (ok) setEditing(false);
  }

  async function reassign(ownerLabel: string) {
    const acct = accounts.find((a) => a.owner_label === ownerLabel);
    await patch({ assigned_owner_label: ownerLabel, account_id: acct?.id ?? null });
  }

  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        posted ? "border-green-200" : skipped ? "border-slate-200 opacity-70" : "border-slate-200"
      }`}
    >
      {/* The comment we're replying to */}
      <div className="rounded-lg border-l-2 border-slate-300 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-slate-700">
              u/{reply.comment_author ?? "unknown"}
            </span>
            {typeof reply.comment_score === "number" && (
              <span className="inline-flex items-center gap-0.5">
                <ArrowUpToLine className="h-3 w-3" />
                {reply.comment_score}
              </span>
            )}
          </span>
          {reply.reddit_comment_url && (
            <a
              href={reply.reddit_comment_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-slate-800"
            >
              <ExternalLink className="h-3 w-3" /> comment
            </a>
          )}
        </div>
        {reply.comment_excerpt && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{reply.comment_excerpt}</p>
        )}
      </div>

      {reply.why && (
        <p className="mt-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-600">Why reply:</span> {reply.why}
        </p>
      )}

      {/* Assignment + mention */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          <User className="h-3 w-3" /> {reply.assigned_owner_label ?? "unassigned"}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${mention.cls}`}>
          {mention.label}
        </span>
        {posted && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
            <Check className="h-2.5 w-2.5" /> posted
          </span>
        )}
        {!posted && accounts.length > 0 && (
          <select
            value={reply.assigned_owner_label ?? ""}
            onChange={(e) => reassign(e.target.value)}
            disabled={busy}
            className="ml-auto rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600"
            title="Reassign to a different teammate"
          >
            {accounts
              .filter((a) => a.active)
              .map((a) => a.owner_label)
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
          </select>
        )}
      </div>

      {/* The drafted reply */}
      {editing ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={saveEdit}
              disabled={busy}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </button>
            <button
              onClick={() => {
                setDraft(reply.reply_text ?? "");
                setEditing(false);
              }}
              className="rounded-md px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-white ring-1 ring-slate-100 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
              <Reply className="h-3 w-3" /> Suggested reply
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <button
                onClick={copy}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {reply.reply_text || <span className="text-slate-400">No draft.</span>}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {reply.reddit_comment_url && (
          <a
            href={reply.reddit_comment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open comment to reply
          </a>
        )}
        {!posted ? (
          <button
            onClick={() => patch({ status: "posted" })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Mark posted
          </button>
        ) : (
          <button
            onClick={() => patch({ status: "suggested" })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Unmark
          </button>
        )}
        {!posted &&
          (skipped ? (
            <button
              onClick={() => patch({ status: "suggested" })}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          ) : (
            <button
              onClick={() => patch({ status: "skipped" })}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60"
            >
              <CircleSlash className="h-3.5 w-3.5" /> Skip
            </button>
          ))}
      </div>
    </div>
  );
}
