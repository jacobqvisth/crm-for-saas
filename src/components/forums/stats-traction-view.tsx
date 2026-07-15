import Link from "next/link";
import { ArrowUpToLine, MessageSquare, Trophy, ExternalLink } from "lucide-react";
import { KpiTile, EmptyNote, SectionTitle, VBars, pct, fmt } from "./stats-ui";
import { kindLabel, type TractionStats, type TractionItem } from "@/lib/forums/stats-detail";

const KIND_BADGE: Record<string, string> = {
  post: "bg-orange-50 text-orange-700",
  distribution: "bg-violet-50 text-violet-700",
  answer: "bg-sky-50 text-sky-700",
};

function TopCard({ top }: { top: TractionItem }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700">
        <Trophy className="h-4 w-4" /> Top performer
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE[top.kind]}`}>
          {kindLabel(top.kind)}
        </span>
        <span className="text-xs text-slate-500">r/{top.subreddit}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-base font-medium text-slate-900">{top.title}</p>
      <div className="mt-3 flex flex-wrap items-center gap-5 text-sm">
        <span className="flex items-center gap-1.5 font-semibold text-slate-900">
          <ArrowUpToLine className="h-4 w-4 text-slate-400" /> {fmt(top.upvotes ?? 0)} upvotes
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-slate-900">
          <MessageSquare className="h-4 w-4 text-slate-400" /> {fmt(top.comments ?? 0)} comments
        </span>
        {top.ratio != null ? (
          <span className="text-slate-500">{Math.round(top.ratio * 100)}% upvoted</span>
        ) : null}
        {top.url ? (
          <Link
            href={top.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700"
          >
            View <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Leaderboard({ items }: { items: TractionItem[] }) {
  const tracked = items.filter((i) => i.tracked).slice(0, 15);
  if (tracked.length === 0) {
    return (
      <EmptyNote>
        No traction data yet. Upvotes and comments fill in when someone runs the &ldquo;refresh
        traction&rdquo; action on a posted item.
      </EmptyNote>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 font-medium">#</th>
            <th className="px-4 py-2.5 font-medium">Content</th>
            <th className="px-4 py-2.5 font-medium">Subreddit</th>
            <th className="px-4 py-2.5 text-right font-medium">Upvotes</th>
            <th className="px-4 py-2.5 text-right font-medium">Comments</th>
            <th className="px-4 py-2.5 text-right font-medium">Ratio</th>
            <th className="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {tracked.map((i, idx) => (
            <tr key={i.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2.5 text-slate-400 tabular-nums">{idx + 1}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_BADGE[i.kind]}`}>
                    {kindLabel(i.kind)}
                  </span>
                  <span className="max-w-[280px] truncate font-medium text-slate-800" title={i.title}>
                    {i.title}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-slate-600">r/{i.subreddit}</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{fmt(i.upvotes ?? 0)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmt(i.comments ?? 0)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                {i.ratio == null ? "—" : `${Math.round(i.ratio * 100)}%`}
              </td>
              <td className="px-4 py-2.5 text-right">
                {i.url ? (
                  <Link href={i.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-orange-600">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubredditEngagement({ data }: { data: TractionStats["bySubreddit"] }) {
  const rows = data.filter((s) => s.tracked > 0);
  if (rows.length === 0) return <EmptyNote>No per-subreddit engagement to compare yet.</EmptyNote>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 font-medium">Subreddit</th>
            <th className="px-4 py-2.5 text-right font-medium">Posted</th>
            <th className="px-4 py-2.5 text-right font-medium">Avg upvotes</th>
            <th className="px-4 py-2.5 text-right font-medium">Avg comments</th>
            <th className="px-4 py-2.5 text-right font-medium">Avg ratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.subreddit} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2.5 font-medium text-slate-800">r/{s.subreddit}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                {s.tracked}
                {s.tracked < s.posted ? <span className="text-slate-400">/{s.posted}</span> : null}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                {s.avgUpvotes == null ? "—" : s.avgUpvotes.toFixed(1)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {s.avgComments == null ? "—" : s.avgComments.toFixed(1)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                {s.avgRatio == null ? "—" : `${Math.round(s.avgRatio * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MENTION_LABEL: Record<string, string> = {
  none: "No mention",
  subtle: "Subtle mention",
  explicit: "Explicit mention",
  unknown: "Unspecified",
};

function MentionEffect({ data }: { data: TractionStats["byMentionLevel"] }) {
  const rows = data.filter((m) => m.tracked > 0);
  if (rows.length === 0) {
    return (
      <EmptyNote>
        Not enough tracked posts to compare mention levels yet. Once a few posts in each style have
        traction, this shows whether naming Wrenchlane costs you upvotes.
      </EmptyNote>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rows.map((m) => (
        <div key={m.level} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {MENTION_LABEL[m.level] ?? m.level}
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-slate-900">
            {m.avgUpvotes == null ? "—" : m.avgUpvotes.toFixed(1)}
          </div>
          <div className="text-xs text-slate-500">avg upvotes · {m.tracked} tracked</div>
          {m.avgRatio != null ? (
            <div className="mt-1 text-xs text-slate-400">{Math.round(m.avgRatio * 100)}% avg upvoted</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function TractionView({ data }: { data: TractionStats }) {
  const coverage = `${data.trackedTotal} of ${data.postedTotal} posted items have traction data`;
  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile icon={<ArrowUpToLine className="h-4 w-4" />} label="Total upvotes" value={data.totalUpvotes} sub={coverage} />
        <KpiTile icon={<MessageSquare className="h-4 w-4" />} label="Total comments" value={data.totalComments} />
        <KpiTile
          icon={<Trophy className="h-4 w-4" />}
          label="Best post"
          value={data.top ? fmt(data.top.upvotes ?? 0) : "—"}
          sub={data.top ? `r/${data.top.subreddit}` : "no traction yet"}
        />
        <KpiTile
          icon={<ArrowUpToLine className="h-4 w-4" />}
          label="Avg upvotes"
          value={data.trackedTotal ? (data.totalUpvotes / data.trackedTotal).toFixed(1) : "—"}
          sub="per tracked item"
        />
      </div>

      {data.top ? <div className="mt-6">{<TopCard top={data.top} />}</div> : null}

      <SectionTitle hint={coverage}>Top content by upvotes</SectionTitle>
      <Leaderboard items={data.items} />

      <SectionTitle>Engagement earned per week</SectionTitle>
      {data.weekly.length === 0 ? (
        <EmptyNote>No dated traction yet — this charts upvotes and comments as posts accrue engagement.</EmptyNote>
      ) : (
        <VBars
          data={data.weekly.map((w) => ({ key: w.key, label: w.label, value: w.upvotes, value2: w.comments }))}
          legend={["Upvotes", "Comments"]}
        />
      )}

      <SectionTitle>Best subreddits by engagement</SectionTitle>
      <SubredditEngagement data={data.bySubreddit} />

      <SectionTitle hint="posts & answers only">Does mentioning Wrenchlane cost upvotes?</SectionTitle>
      <MentionEffect data={data.byMentionLevel} />
      <p className="mt-2 text-xs text-slate-400">
        Higher average upvotes for &ldquo;no mention&rdquo; posts would suggest the audience rewards pure
        help; comparable numbers mean explicit mentions are safe. Read with the tracked counts —
        {" "}
        {pct(data.trackedTotal, data.postedTotal)}% coverage so far.
      </p>
    </>
  );
}
