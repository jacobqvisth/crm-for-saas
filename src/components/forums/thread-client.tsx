"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  MessagesSquare,
  ExternalLink,
  ArrowUpToLine,
  MessageSquare,
  RefreshCw,
  Loader2,
  Sparkles,
  Copy,
  Check,
  CornerDownRight,
  Reply,
  CircleSlash,
  RotateCcw,
  Pencil,
  User,
  Send,
} from "lucide-react";
import type { DistributionRec } from "@/lib/forums/distribution";
import type {
  ForumCommentAssignment,
  ForumThreadReply,
  ForumMentionLevel,
} from "@/lib/forums/types";
import type { RedditAccount } from "@/lib/forums/accounts";
import { submitUrlWithTitle } from "@/lib/forums/wlpost";
import { OpenInProfile } from "./open-in-profile";
import { SubredditAccessBadge } from "./subreddit-access-badge";
import { TeamComments } from "./team-comments";

// The per-post thread workspace. One posted distribution rec gets its own page
// with room to (a) manage the per-member top-level comments and (b) reply to
// OTHER people's comments: "Analyze thread" reads the live Reddit comments,
// picks the ones worth a reply, and drafts each one, assigned to the teammate
// whose persona fits. Teammates copy-paste from here.
export function ThreadClient({ recId }: { recId: string }) {
  const [rec, setRec] = useState<DistributionRec | null>(null);
  const [replies, setReplies] = useState<ForumThreadReply[]>([]);
  const [assignments, setAssignments] = useState<ForumCommentAssignment[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Feedback for an action (save/send/refresh) so failures aren't silent.
  const [actionNote, setActionNote] = useState<string | null>(null);

  // Mark-posted + manual-traction editing. Moved here from the board so the
  // post's own page is where you manage everything about it.
  const [showPostedInput, setShowPostedInput] = useState(false);
  const [postedUrl, setPostedUrl] = useState("");
  const [postedByAccountId, setPostedByAccountId] = useState("");
  const [editingTraction, setEditingTraction] = useState(false);
  const [manualScore, setManualScore] = useState("");
  const [manualComments, setManualComments] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeNote, setAnalyzeNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/forums/thread?source=distribution&source_id=${recId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRec(data.rec as DistributionRec);
      setReplies((data.replies ?? []) as ForumThreadReply[]);
      setAssignments((data.assignments ?? []) as ForumCommentAssignment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [recId]);

  useEffect(() => {
    load();
    (async () => {
      try {
        const res = await fetch("/api/forums/accounts");
        const data = await res.json();
        if (res.ok) setAccounts(data.accounts ?? []);
      } catch {
        // ignore — reassign picker just won't have options
      }
    })();
  }, [load]);

  // Keep the mark-posted / traction inputs in sync with the loaded rec.
  useEffect(() => {
    if (!rec) return;
    setPostedUrl(rec.posted_url ?? "");
    setPostedByAccountId(rec.posted_by_account_id ?? "");
    setManualScore(rec.score?.toString() ?? "");
    setManualComments(rec.num_comments?.toString() ?? "");
    // Only re-seed when we switch to a different rec, not on every traction poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id]);

  // Patch the parent distribution rec (traction refresh, draft/send Slack,
  // mark posted, skip). Returns whether the save succeeded.
  async function patchRec(body: Record<string, unknown>) {
    setBusy(true);
    setActionNote(null);
    try {
      const res = await fetch(`/api/forums/distribution/${recId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRec(data.rec as DistributionRec);
        if (data.rec?.assignments) setAssignments(data.rec.assignments as ForumCommentAssignment[]);
        // The Slack send is best-effort server-side; surface why it didn't land.
        if (typeof data.slackReason === "string") setActionNote(data.slackReason);
        return true;
      }
      setActionNote(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
      return false;
    } catch {
      setActionNote("Network error — please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function markPosted() {
    // Save the URL + status first and return immediately — never block the save
    // on a Reddit traction fetch (it can take 30-200s via Apify or be blocked),
    // which made the Save button appear to hang. Pull traction afterwards in the
    // background so the numbers still fill in on their own.
    const ok = await patchRec({
      status: "posted",
      posted_url: postedUrl || null,
      posted_by_account_id: postedByAccountId || null,
    });
    if (ok) {
      setShowPostedInput(false);
      if (postedUrl) void patchRec({ refresh: true });
    }
  }

  async function saveManualTraction() {
    const ok = await patchRec({
      score: manualScore === "" ? null : Number(manualScore),
      num_comments: manualComments === "" ? null : Number(manualComments),
    });
    if (ok) setEditingTraction(false);
  }

  async function analyze() {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeNote(null);
    try {
      const res = await fetch(`/api/forums/thread/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "distribution", source_id: recId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data.error ?? "Analysis failed");
        return;
      }
      setReplies((data.replies ?? []) as ForumThreadReply[]);
      if (data.note) setAnalyzeNote(data.note);
      else setAnalyzeNote(`Read ${data.analyzed ?? 0} comments and drafted ${(data.replies ?? []).length} replies.`);
    } catch {
      setAnalyzeError("Analysis failed — try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  function onReplyPatched(updated: ForumThreadReply) {
    setReplies((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 justify-center py-24 text-slate-500 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
      </div>
    );
  }
  if (error || !rec) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <BackLink />
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? "Not found"}
        </div>
      </div>
    );
  }

  const posted = rec.status === "posted";
  const skipped = rec.status === "skipped";
  const postedCount = replies.filter((r) => r.status === "posted").length;
  const postedByAccount = accounts.find((a) => a.id === rec.posted_by_account_id) ?? null;
  // The Reddit handle Reddit reports as the author — flag it when it doesn't
  // match the picked account's handle.
  const authorMismatch =
    !!rec.posted_by_username &&
    !!postedByAccount?.username &&
    rec.posted_by_username.toLowerCase() !== postedByAccount.username.toLowerCase();

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <BackLink />

      {/* Post header — everything about this recommendation */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={rec.subreddit_url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5"
            >
              <MessagesSquare className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-semibold text-slate-900 group-hover:text-orange-700">
                {rec.subreddit}
              </span>
              <ExternalLink className="h-3 w-3 text-slate-400" />
            </a>
            <SubredditAccessBadge subreddit={rec.subreddit} />
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
              posted ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {rec.status}
          </span>
        </div>

        {/* Why this community fits */}
        {rec.fit_reason && <p className="mt-2 text-xs text-slate-600">{rec.fit_reason}</p>}

        {/* The post to paste — title + body, both copyable */}
        {rec.suggested_title && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Suggested title
              </span>
              <CopyButton text={rec.suggested_title} label="Copy" />
            </div>
            <h1 className="text-base font-semibold text-slate-900">{rec.suggested_title}</h1>
          </div>
        )}
        {rec.suggested_body && (
          <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Body
              </span>
              <CopyButton text={rec.suggested_body} label="Copy" />
            </div>
            <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">
              {rec.suggested_body}
            </p>
            {rec.suggested_title && (
              <div className="mt-2 flex justify-end">
                <CopyButton
                  text={`${rec.suggested_title}\n\n${rec.suggested_body}`}
                  label="Copy title + body"
                  prominent
                />
              </div>
            )}
          </div>
        )}

        {/* Open the prefilled submit page in the chosen account's Chrome profile */}
        {!posted && (
          <div className="mt-3">
            <OpenInProfile
              accounts={accounts}
              targetUrl={submitUrlWithTitle(
                `${(rec.subreddit_url ?? "").replace(/\/+$/, "")}/submit`,
                rec.suggested_title,
              )}
              body={rec.suggested_body ?? ""}
              prefix="Open submit page as"
            />
          </div>
        )}

        {/* Angle + rules */}
        <div className="mt-2 space-y-1">
          {rec.recommended_angle && (
            <p className="text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">Angle:</span> {rec.recommended_angle}
            </p>
          )}
          {rec.rules_note && (
            <p className="text-[11px] text-amber-700">
              <span className="font-medium">Rules:</span> {rec.rules_note}
            </p>
          )}
        </div>

        {/* Live traction (posted only) */}
        {posted && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-slate-700">
              <ArrowUpToLine className="h-3.5 w-3.5 text-slate-400" />
              {rec.score ?? "—"} <span className="font-normal text-slate-500">upvotes</span>
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700">
              <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
              {rec.num_comments ?? "—"} <span className="font-normal text-slate-500">comments</span>
            </span>
            {typeof rec.upvote_ratio === "number" && (
              <span className="text-slate-500">{Math.round(rec.upvote_ratio * 100)}% upvoted</span>
            )}
            {rec.posted_url && (
              <a
                href={rec.posted_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-orange-700 hover:text-orange-900"
              >
                <ExternalLink className="h-3 w-3" /> view thread on Reddit
              </a>
            )}
            {rec.posted_url && (
              <button
                onClick={() => patchRec({ refresh: true })}
                disabled={busy}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 disabled:opacity-50"
                title="Refresh upvotes + comments from Reddit"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                refresh
              </button>
            )}
            <button
              onClick={() => setEditingTraction((v) => !v)}
              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
              title="Enter upvotes / comments manually"
            >
              <Pencil className="h-3 w-3" /> edit
            </button>
            {rec.last_checked_at && (
              <span className="text-slate-400">
                checked {new Date(rec.last_checked_at).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
        {posted && rec.traction_note && (
          <p className="mt-1 text-[11px] text-amber-700">{rec.traction_note}</p>
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
        {posted && (postedByAccount || rec.posted_by_username) && (
          <p className="mt-2 inline-flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
            <User className="h-3 w-3 text-slate-400" />
            <span className="font-medium text-slate-600">Posted by</span>{" "}
            {postedByAccount ? (
              <span>{accountLabel(postedByAccount)}</span>
            ) : (
              <span>u/{rec.posted_by_username}</span>
            )}
            {authorMismatch && (
              <span className="text-amber-700">— Reddit says u/{rec.posted_by_username}</span>
            )}
          </p>
        )}

        {/* Post lifecycle actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {!posted ? (
            <button
              onClick={() => setShowPostedInput((v) => !v)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" /> Mark posted
            </button>
          ) : (
            <button
              onClick={() => patchRec({ status: "recommended", posted_url: null })}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Unmark
            </button>
          )}
          {!posted &&
            (skipped ? (
              <button
                onClick={() => patchRec({ status: "recommended" })}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
            ) : (
              <button
                onClick={() => patchRec({ status: "skipped" })}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60"
              >
                <CircleSlash className="h-3.5 w-3.5" /> Skip
              </button>
            ))}
        </div>

        {showPostedInput && !posted && (
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
            <div className="flex gap-2">
              <input
                value={postedUrl}
                onChange={(e) => setPostedUrl(e.target.value)}
                placeholder="Paste the Reddit post URL"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
              <button
                onClick={markPosted}
                disabled={busy}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {actionNote && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {actionNote}
        </div>
      )}

      {/* Reply to the post itself (per-member top-level comments) */}
      {posted && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-800">Comments on the post</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            One drafted comment per teammate to post from their own account, under the post itself.
          </p>
          <TeamComments
            assignments={assignments}
            source="distribution"
            sourceId={rec.id}
            slackNotifiedAt={rec.slack_notified_at}
            onRedraft={() => patchRec({ draft: true })}
            onSend={() => patchRec({ send_slack: true })}
            busy={busy}
          />
        </section>
      )}

      {/* Reply to other people's comments */}
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
              disabled={analyzing || !posted || !rec.posted_url}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              title={!rec.posted_url ? "Mark this posted with its URL first" : "Analyze the thread"}
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
            Hit <span className="font-medium">Mark posted</span> above (with its Reddit URL) before
            analyzing its thread.
          </div>
        )}

        {replies.length === 0 ? (
          posted && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">
                No replies drafted yet. Hit <span className="font-medium">Analyze thread</span> to
                pull the comments and draft replies.
              </p>
            </div>
          )
        ) : (
          <div className="mt-4 space-y-4">
            {replies.map((r) => (
              <ReplyCard key={r.id} reply={r} accounts={accounts} onPatched={onReplyPatched} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/forums?view=topics"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
    >
      <ArrowLeft className="h-4 w-4" /> Back to campaigns
    </Link>
  );
}

// "Owner · u/handle" (or just the owner when the handle isn't filled in yet).
function accountLabel(a: RedditAccount): string {
  return a.username ? `${a.owner_label} · u/${a.username}` : `${a.owner_label} (handle pending)`;
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
