"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Share2,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  ArrowUpToLine,
  MessageSquare,
  Send,
  RefreshCw,
  MessagesSquare,
  CircleSlash,
  RotateCcw,
  Pencil,
  User,
} from "lucide-react";
import {
  DEFAULT_TOPIC,
  TOPICS,
  TIER_META,
  type DistributionRec,
  type DistributionTier,
} from "@/lib/forums/distribution";
import type { RedditAccount } from "@/lib/forums/accounts";
import { TeamComments } from "./team-comments";
import { ContributorsPanel } from "./contributors-panel";

const TIER_ORDER: DistributionTier[] = ["best_fit", "trade", "ai_angle"];

export function DistributionClient() {
  const topic = TOPICS[DEFAULT_TOPIC];
  const [recs, setRecs] = useState<DistributionRec[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/forums/distribution?topic=${DEFAULT_TOPIC}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        if (!cancelled) setRecs(data.recs ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Roster for the "posted by" picker — best-effort, never blocks the board.
    (async () => {
      try {
        const res = await fetch("/api/forums/accounts");
        const data = await res.json();
        if (res.ok && !cancelled) setAccounts(data.accounts ?? []);
      } catch {
        // ignore — the picker just won't have options
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patchRec(updated: DistributionRec) {
    setRecs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function refreshAll() {
    setRefreshingAll(true);
    try {
      const res = await fetch(`/api/forums/distribution/refresh?topic=${DEFAULT_TOPIC}`, {
        method: "POST",
      });
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
            Where to post <span className="font-medium text-slate-700">“{topic.title}”</span> —
            track what you&apos;ve posted and how it&apos;s doing.
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
        <span className="border-b-2 border-orange-500 px-3 py-2 text-sm font-medium text-orange-700">
          Distribution
        </span>
        <Link
          href="/forums/answers"
          className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          Answer posts
        </Link>
      </div>

      {/* What this is */}
      <div className="mt-5 rounded-lg border border-orange-100 bg-orange-50/60 px-4 py-3 text-sm text-orange-900">
        <span className="font-medium">The post:</span> {topic.summary} Below are the communities to
        post it in, ranked by how welcome a discussion post is. Mark each one as you post it (paste
        the URL) — that also pings <span className="font-medium">#forum-posts</span> in Slack with a
        ready-to-paste reply so the team can jump in from their own Reddit accounts. Then hit{" "}
        <span className="font-medium">Refresh traction</span> to auto-pull upvotes and comments — or
        type them in with the pencil (Reddit blocks automated reads unless API keys are configured).
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
        <div className="mt-8 space-y-10">
          {TIER_ORDER.map((tier) => {
            const group = recs.filter((r) => r.tier === tier);
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
                    <RecCard key={rec.id} rec={rec} accounts={accounts} onPatched={patchRec} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// "Owner · u/handle" (or just the owner when the handle isn't filled in yet).
function accountLabel(a: RedditAccount): string {
  return a.username ? `${a.owner_label} · u/${a.username}` : `${a.owner_label} (handle pending)`;
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

function RecCard({
  rec,
  accounts,
  onPatched,
}: {
  rec: DistributionRec;
  accounts: RedditAccount[];
  onPatched: (r: DistributionRec) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showPostedInput, setShowPostedInput] = useState(false);
  const [postedUrl, setPostedUrl] = useState(rec.posted_url ?? "");
  const [postedByAccountId, setPostedByAccountId] = useState(rec.posted_by_account_id ?? "");
  const [editingTraction, setEditingTraction] = useState(false);
  const [manualScore, setManualScore] = useState(rec.score?.toString() ?? "");
  const [manualComments, setManualComments] = useState(rec.num_comments?.toString() ?? "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/forums/distribution/${rec.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onPatched(data.rec as DistributionRec);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function markPosted() {
    const ok = await patch({
      status: "posted",
      posted_url: postedUrl || null,
      posted_by_account_id: postedByAccountId || null,
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

  const posted = rec.status === "posted";
  const skipped = rec.status === "skipped";
  const postedByAccount = accounts.find((a) => a.id === rec.posted_by_account_id) ?? null;
  // The Reddit handle Reddit reports as the author (source of truth). Flag it
  // when it doesn't match the picked account's handle.
  const authorMismatch =
    !!rec.posted_by_username &&
    !!postedByAccount?.username &&
    rec.posted_by_username.toLowerCase() !== postedByAccount.username.toLowerCase();

  return (
    <div
      className={`flex flex-col rounded-xl border bg-white p-4 ${
        posted ? "border-green-200" : skipped ? "border-slate-200 opacity-70" : "border-slate-200"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <a
          href={rec.subreddit_url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-1.5"
        >
          <MessagesSquare className="h-4 w-4 text-orange-600 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-900 group-hover:text-orange-700">
            {rec.subreddit}
          </span>
          <ExternalLink className="h-3 w-3 text-slate-400" />
        </a>
        <StatusBadge status={rec.status} />
      </div>

      {/* Fit reason */}
      {rec.fit_reason && <p className="mt-2 text-xs text-slate-600">{rec.fit_reason}</p>}

      {/* Suggested title */}
      {rec.suggested_title && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Suggested title
            </span>
            <CopyButton text={rec.suggested_title} label="Copy" />
          </div>
          <p className="text-xs font-medium text-slate-800">{rec.suggested_title}</p>
        </div>
      )}

      {/* Suggested body */}
      {rec.suggested_body && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Body
            </span>
            <CopyButton text={rec.suggested_body} label="Copy" />
          </div>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-700">
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

      {/* Traction (posted only) */}
      {posted && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-green-100 bg-green-50/50 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-green-800">
            <ArrowUpToLine className="h-3.5 w-3.5" />
            {rec.score ?? "—"}
            <span className="font-normal text-green-700">upvotes</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-green-800">
            <MessageSquare className="h-3.5 w-3.5" />
            {rec.num_comments ?? "—"}
            <span className="font-normal text-green-700">comments</span>
          </span>
          {typeof rec.upvote_ratio === "number" && (
            <span className="text-green-700">{Math.round(rec.upvote_ratio * 100)}% upvoted</span>
          )}
          {rec.posted_url && (
            <a
              href={rec.posted_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-green-700 hover:text-green-900"
            >
              <ExternalLink className="h-3 w-3" /> view post
            </a>
          )}
          <button
            onClick={() => patch({ refresh: true })}
            disabled={busy}
            className="inline-flex items-center gap-1 text-green-700 hover:text-green-900 disabled:opacity-50"
            title="Auto-refresh from Reddit"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
          <button
            onClick={() => setEditingTraction((v) => !v)}
            className="inline-flex items-center gap-1 text-green-700 hover:text-green-900"
            title="Enter upvotes / comments manually"
          >
            <Pencil className="h-3 w-3" />
          </button>
          {rec.last_checked_at && (
            <span className="text-green-600/70">
              checked {new Date(rec.last_checked_at).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
      {posted && rec.traction_note && (
        <p className="mt-1 text-[11px] text-amber-700">{rec.traction_note}</p>
      )}
      {posted && (postedByAccount || rec.posted_by_username) && (
        <p className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <User className="h-3 w-3 text-slate-400" />
          <span className="font-medium text-slate-600">Posted by</span>{" "}
          {postedByAccount ? (
            <span>{accountLabel(postedByAccount)}</span>
          ) : (
            <span>u/{rec.posted_by_username}</span>
          )}
          {authorMismatch && (
            <span className="text-amber-700">
              — Reddit says u/{rec.posted_by_username}
            </span>
          )}
        </p>
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

      {/* Per-member team comments (posted only) */}
      {posted && (
        <TeamComments
          assignments={rec.assignments ?? []}
          source="distribution"
          sourceId={rec.id}
          slackNotifiedAt={rec.slack_notified_at}
          onRedraft={() => patch({ draft: true })}
          onSend={() => patch({ send_slack: true })}
          busy={busy}
        />
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {!posted ? (
          <button
            onClick={() => setShowPostedInput((v) => !v)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            <Send className="h-3.5 w-3.5" /> Mark posted
          </button>
        ) : (
          <button
            onClick={() => patch({ status: "recommended", posted_url: null })}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Unmark
          </button>
        )}
        {!posted &&
          (skipped ? (
            <button
              onClick={() => patch({ status: "recommended" })}
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
