"use client";

import { useEffect, useState } from "react";
import {
  MessageSquare,
  Copy,
  Check,
  Loader2,
  Send,
  RotateCcw,
  CircleSlash,
} from "lucide-react";
import type { ForumCommentAssignment } from "@/lib/forums/types";

// Per-member Reddit comments for one forum item. Each active teammate gets their
// own distinct draft; this panel shows them, lets you copy each, and tracks who
// has posted — either marked here in the CRM or via a ✅ reaction in the
// #forum-posts Slack thread (see /api/slack/events).
export function TeamComments({
  assignments,
  slackNotifiedAt,
  onResend,
  resendBusy,
}: {
  assignments: ForumCommentAssignment[];
  slackNotifiedAt: string | null;
  onResend: () => void;
  resendBusy: boolean;
}) {
  // Local copy so mark-posted updates render instantly without a board refetch.
  // Re-syncs when the parent hands down a new array (e.g. after a resend redraft).
  const [items, setItems] = useState<ForumCommentAssignment[]>(assignments);
  useEffect(() => setItems(assignments), [assignments]);

  const postedCount = items.filter((a) => a.status === "posted").length;

  function onItem(updated: ForumCommentAssignment) {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
          <MessageSquare className="h-3 w-3" /> Team comments for Reddit
        </span>
        {items.length > 0 && (
          <span className="text-[10px] font-medium text-indigo-500">
            {postedCount}/{items.length} posted
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-500">
          No per-member comments yet — they&apos;re drafted when this is marked posted.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <MemberRow key={a.id} a={a} onPatched={onItem} />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 border-t border-indigo-100/70 pt-2 text-[11px]">
        <button
          onClick={onResend}
          disabled={resendBusy}
          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          title="Redraft everyone's comment and re-post the #forum-posts thread"
        >
          {resendBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {slackNotifiedAt ? "Redraft + resend to Slack" : "Send to #forum-posts"}
        </button>
        {slackNotifiedAt && (
          <span className="text-indigo-500/70">
            sent {new Date(slackNotifiedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  a,
  onPatched,
}: {
  a: ForumCommentAssignment;
  onPatched: (a: ForumCommentAssignment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const posted = a.status === "posted";
  const skipped = a.status === "skipped";

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/comment-assignments/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.assignment) onPatched(data.assignment as ForumCommentAssignment);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!a.comment) return;
    try {
      await navigator.clipboard.writeText(a.comment);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={`rounded-lg border bg-white px-2.5 py-2 ${
        posted ? "border-green-200" : skipped ? "border-slate-200 opacity-70" : "border-slate-200"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-800">{a.owner_label}</span>
          {posted && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
              <Check className="h-2.5 w-2.5" />
              posted
              {a.confirmed_via === "slack_reaction" && " · via Slack ✅"}
            </span>
          )}
          {skipped && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
              skipped
            </span>
          )}
        </div>
        {a.comment && (
          <button
            onClick={copy}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {a.comment ? (
        <p className="whitespace-pre-wrap text-xs text-slate-700">{a.comment}</p>
      ) : (
        <p className="text-xs text-slate-400">No draft yet.</p>
      )}

      <div className="mt-1.5 flex items-center gap-2">
        {!posted ? (
          <button
            onClick={() => patch({ status: "posted" })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {a.owner_label} posted this
          </button>
        ) : (
          <button
            onClick={() => patch({ status: "suggested" })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            <RotateCcw className="h-3 w-3" /> Unmark
          </button>
        )}
        {!posted && !skipped && (
          <button
            onClick={() => patch({ status: "skipped" })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-100 disabled:opacity-60"
          >
            <CircleSlash className="h-3 w-3" /> Skip
          </button>
        )}
        {skipped && (
          <button
            onClick={() => patch({ status: "suggested" })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-60"
          >
            <RotateCcw className="h-3 w-3" /> Restore
          </button>
        )}
      </div>
    </div>
  );
}
