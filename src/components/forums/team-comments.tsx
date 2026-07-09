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
  Search,
  ExternalLink,
  Pencil,
  RefreshCw,
} from "lucide-react";
import type { ForumCommentAssignment, ForumSource } from "@/lib/forums/types";

// Per-member Reddit comments for one forum item. Each active teammate gets their
// own distinct draft; this panel shows them, lets you copy each, and tracks who
// actually contributed — detected from the real Reddit thread ("Scan Reddit"),
// a ✅ reaction in the #forum-posts Slack thread, or a manual CRM mark.
export function TeamComments({
  assignments,
  source,
  sourceId,
  slackNotifiedAt,
  onRedraft,
  onSend,
  busy,
}: {
  assignments: ForumCommentAssignment[];
  source: ForumSource;
  sourceId: string;
  slackNotifiedAt: string | null;
  onRedraft: () => void; // step 1 — (re)generate drafts, no Slack
  onSend: () => void; // step 2 — post current drafts to Slack
  busy: boolean;
}) {
  // Local copy so mark-posted updates render instantly without a board refetch.
  // Re-syncs when the parent hands down a new array (e.g. after a resend redraft).
  const [items, setItems] = useState<ForumCommentAssignment[]>(assignments);
  useEffect(() => setItems(assignments), [assignments]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  // "Contributed" = the trustworthy signals only (Reddit-detected or Slack ✅).
  const contributed = items.filter(
    (a) => a.confirmed_via === "reddit_detected" || a.confirmed_via === "slack_reaction",
  ).length;

  function onItem(updated: ForumCommentAssignment) {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function scanReddit() {
    setScanning(true);
    setScanNote(null);
    try {
      const res = await fetch(`/api/forums/contributors/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, source_id: sourceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanNote(data.error ?? "Scan failed");
        return;
      }
      if (Array.isArray(data.assignments)) setItems(data.assignments as ForumCommentAssignment[]);
      const n = data.result?.matched?.length ?? 0;
      setScanNote(
        n > 0
          ? `Found ${n} of our account${n === 1 ? "" : "s"} in the thread.`
          : `Scanned ${data.result?.commentersFound ?? 0} comments — none matched a roster handle yet.`,
      );
    } catch {
      setScanNote("Scan failed");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
          <MessageSquare className="h-3 w-3" /> Team comments for Reddit
        </span>
        {items.length > 0 && (
          <span className="text-[10px] font-medium text-indigo-500">
            {contributed}/{items.length} contributed
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

      <div className="mt-2 border-t border-indigo-100/70 pt-2">
        {/* Two-step status: draft → send. */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <StepChip done={items.length > 0} label={items.length > 0 ? "Drafted" : "Not drafted"} />
          <span className="text-slate-300">→</span>
          <StepChip
            done={!!slackNotifiedAt}
            label={
              slackNotifiedAt
                ? `Sent to Slack ${new Date(slackNotifiedAt).toLocaleDateString()}`
                : "Not sent to Slack"
            }
          />
        </div>

        {/* Step buttons — draft/redraft is separate from send. */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {items.length === 0 ? (
            <button
              onClick={onRedraft}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              title="Generate a comment for each team member (no Slack)"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />}
              Draft team comments
            </button>
          ) : (
            <button
              onClick={onRedraft}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-2.5 py-1 font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              title="Regenerate every member's comment (no Slack)"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Redraft
            </button>
          )}
          <button
            onClick={onSend}
            disabled={busy || items.length === 0}
            className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            title="Post the current drafts to #forum-posts"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {slackNotifiedAt ? "Resend to Slack" : "Send to Slack"}
          </button>
          <button
            onClick={scanReddit}
            disabled={scanning}
            className="inline-flex items-center gap-1 text-indigo-700 hover:text-indigo-900 disabled:opacity-50"
            title="Read the Reddit thread and mark teammates whose account commented"
          >
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Scan Reddit for our comments
          </button>
        </div>
      </div>
      {scanNote && <p className="mt-1 text-[11px] text-slate-500">{scanNote}</p>}
    </div>
  );
}

function StepChip({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
        done ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {done ? <Check className="h-2.5 w-2.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
      {label}
    </span>
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
              {a.confirmed_via === "reddit_detected"
                ? "commented on Reddit"
                : a.confirmed_via === "slack_reaction"
                  ? "posted · via Slack ✅"
                  : "posted"}
            </span>
          )}
          {a.confirmed_via === "reddit_detected" && a.reddit_comment_url && (
            <a
              href={a.reddit_comment_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-slate-700"
              title={a.detected_author ? `u/${a.detected_author}` : "view comment"}
            >
              <ExternalLink className="h-2.5 w-2.5" /> comment
            </a>
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
