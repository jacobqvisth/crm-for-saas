"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  MessagesSquare,
  ExternalLink,
  ArrowUpToLine,
  MessageSquare,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  CircleSlash,
  RotateCcw,
  Pencil,
  User,
  Send,
  Trash2,
} from "lucide-react";
import type { DistributionRec } from "@/lib/forums/distribution";
import type {
  ForumCommentAssignment,
  ForumThreadReply,
} from "@/lib/forums/types";
import type { RedditAccount } from "@/lib/forums/accounts";
import {
  DEFAULT_GENERATION_OPTIONS,
  type ForumGenerationOptions,
} from "@/lib/forums/generation-options";
import { submitUrlWithTitle } from "@/lib/forums/wlpost";
import { OpenInProfile } from "./open-in-profile";
import { SubredditAccessBadge } from "./subreddit-access-badge";
import { ThreadRepliesPanel } from "./thread-replies-panel";
import { GenerationOptions } from "./generation-options";
import { TeamComments } from "./team-comments";

// The per-post thread workspace. One posted distribution rec gets its own page
// with room to (a) manage the per-member top-level comments and (b) reply to
// OTHER people's comments: "Analyze thread" reads the live Reddit comments,
// picks the ones worth a reply, and drafts each one, assigned to the teammate
// whose persona fits. Teammates copy-paste from here.
export function ThreadClient({ recId }: { recId: string }) {
  const router = useRouter();
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
  // Edit the post's own title/body (parity with the diagnostic card).
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");


  // Shared draft options for both this page's generators: the per-member
  // comments on the post AND the drafted replies to other people's comments.
  const [options, setOptions] = useState<ForumGenerationOptions>(DEFAULT_GENERATION_OPTIONS);

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
    setDraftTitle(rec.suggested_title ?? "");
    setDraftBody(rec.suggested_body ?? "");
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

  async function saveEdit() {
    const ok = await patchRec({ suggested_title: draftTitle, suggested_body: draftBody });
    if (ok) setEditing(false);
  }

  async function removeRec() {
    if (!confirm("Delete this post? This can't be undone.")) return;
    setBusy(true);
    setActionNote(null);
    try {
      const res = await fetch(`/api/forums/distribution/${recId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/forums?view=all");
        return;
      }
      setActionNote(`Delete failed (${res.status})`);
    } catch {
      setActionNote("Network error — please try again.");
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

        {/* The post to paste — title + body, editable + copyable */}
        {editing ? (
          <div className="mt-3 space-y-2">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={8}
              placeholder="Body"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
                  setDraftTitle(rec.suggested_title ?? "");
                  setDraftBody(rec.suggested_body ?? "");
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
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
          </>
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
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
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
          <button
            onClick={removeRec}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
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
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Draft options</h2>
          <p className="mb-3 text-xs text-slate-500">
            Applies to both the per-member comments and the drafted replies to other people&apos;s
            comments below. Mention level on thread replies is still auto-picked per comment and
            capped by each account&apos;s persona.
          </p>
          <GenerationOptions value={options} onChange={setOptions} />
        </section>
      )}

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
            onRedraft={() => patchRec({ draft: true, options })}
            onSend={() => patchRec({ send_slack: true })}
            busy={busy}
          />
        </section>
      )}

      <ThreadRepliesPanel
        source="distribution"
        sourceId={rec.id}
        postUrl={rec.posted_url}
        posted={posted}
        accounts={accounts}
        initialReplies={replies}
        options={options}
      />
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
