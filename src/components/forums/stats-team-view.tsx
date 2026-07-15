import {
  Send,
  MessageSquare,
  Reply,
  Users,
  ArrowUpToLine,
  Trophy,
  ShieldCheck,
} from "lucide-react";
import { KpiTile, EmptyNote, SectionTitle, HBar } from "./stats-ui";
import type { TeamStats, AccountActivity } from "@/lib/forums/stats-detail";

function AccountTable({ rows, idle }: { rows: AccountActivity[]; idle: number }) {
  if (rows.length === 0) {
    return <EmptyNote>No posting activity attributed to a team member yet.</EmptyNote>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 font-medium">Member</th>
            <th className="px-4 py-2.5 text-right font-medium">Posts</th>
            <th className="px-4 py-2.5 text-right font-medium">Answers</th>
            <th className="px-4 py-2.5 text-right font-medium">Comments</th>
            <th className="px-4 py-2.5 text-right font-medium">Thread replies</th>
            <th className="px-4 py-2.5 text-right font-medium">Upvotes earned</th>
            <th className="px-4 py-2.5 text-right font-medium">Last active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ownerLabel} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{r.ownerLabel}</span>
                  {r.username ? <span className="text-xs text-slate-400">u/{r.username}</span> : null}
                  {r.canMention ? (
                    <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                      can mention
                    </span>
                  ) : null}
                  {!r.active ? (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">inactive</span>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.posts}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.answers}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.comments}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.threadReplies}</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{r.upvotesEarned}</td>
              <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                {r.lastActivity ? r.lastActivity.slice(0, 10) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {idle > 0 ? (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          + {idle} more roster {idle === 1 ? "account" : "accounts"} with no tracked activity yet
        </div>
      ) : null}
    </div>
  );
}

function Leaderboard({ data }: { data: TeamStats }) {
  const max = Math.max(1, ...data.contributors.map((c) => c.total));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Trophy className="h-4 w-4 text-amber-500" /> Comment leaderboard
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Counts a member each time their Reddit handle is spotted on one of our threads, or they confirm
        via Slack ✅.
      </p>
      {data.contributors.length === 0 ? (
        <p className="text-sm text-slate-400">No confirmed comments detected yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.contributors.map((c, i) => (
            <HBar
              key={c.owner_label}
              rank={i + 1}
              label={c.owner_label}
              fillPct={(c.total / max) * 100}
              value={c.total}
              meta={`${c.reddit} reddit · ${c.slack} slack`}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfirmSources({ data }: { data: TeamStats }) {
  const s = data.confirmSources;
  const total = s.crm + s.slack_reaction + s.reddit_detected + s.other;
  const items: { label: string; value: number; className: string }[] = [
    { label: "Detected on Reddit", value: s.reddit_detected, className: "bg-green-50 text-green-700" },
    { label: "Confirmed via Slack ✅", value: s.slack_reaction, className: "bg-sky-50 text-sky-700" },
    { label: "Marked in CRM", value: s.crm, className: "bg-slate-100 text-slate-600" },
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <ShieldCheck className="h-4 w-4 text-slate-500" /> How we know a comment was made
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {total} comment assignment{total === 1 ? "" : "s"} logged. Reddit-detected and Slack-confirmed
        count toward the leaderboard; CRM marks are informational.
      </p>
      {total === 0 ? (
        <p className="text-sm text-slate-400">No comment assignments yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <span key={it.label} className={`rounded-full px-2.5 py-1 text-xs font-medium ${it.className}`}>
              {it.label}: {it.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamView({ data }: { data: TeamStats }) {
  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile icon={<Send className="h-4 w-4" />} label="Posts by us" value={data.postsByUs} />
        <KpiTile icon={<Send className="h-4 w-4" />} label="Answers by us" value={data.answersByUs} />
        <KpiTile
          icon={<MessageSquare className="h-4 w-4" />}
          label="Comments by us"
          value={data.commentsByUs}
          sub={`${data.threadRepliesByUs} thread replies`}
        />
        <KpiTile icon={<ArrowUpToLine className="h-4 w-4" />} label="Upvotes earned" value={data.upvotesEarned} />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          label="Accounts"
          value={data.activeAccounts}
          sub={`${data.totalAccounts} on the roster`}
        />
      </div>

      <SectionTitle hint="attributed by the account that posted">Activity by member</SectionTitle>
      <AccountTable rows={data.perAccount} idle={data.idleAccounts} />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Leaderboard data={data} />
        <ConfirmSources data={data} />
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <Reply className="h-3.5 w-3.5" />
        &ldquo;Comments by us&rdquo; combines confirmed comments on our own threads with replies we posted to
        other people&apos;s comments.
      </p>
    </>
  );
}
