import {
  ArrowUpToLine,
  MessageSquare,
  Users,
  Send,
  Trophy,
  Link2,
  FlaskConical,
} from "lucide-react";
import { WrenchlaneExposureList } from "./wrenchlane-exposure-list";
import { OUTCOME_META, VERDICT_META, type FailureOutcome, type GapVerdict } from "@/lib/forums/gaps";
import type { ForumStats, StatusCount } from "@/lib/forums/stats";

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function KpiTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <div className="flex items-center gap-2 text-slate-500">
        <span className="text-slate-400">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

const CONTENT_ROWS: { key: keyof Pick<ForumStats, "posts" | "distribution" | "answers" | "threadReplies">; label: string }[] = [
  { key: "posts", label: "Generated posts" },
  { key: "distribution", label: "Distribution placements" },
  { key: "answers", label: "Answer posts" },
  { key: "threadReplies", label: "Thread replies" },
];

function FunnelTable({ stats }: { stats: ForumStats }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 font-medium">Content type</th>
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
            <th className="px-4 py-2.5 text-right font-medium">Drafted</th>
            <th className="px-4 py-2.5 text-right font-medium">Posted</th>
            <th className="px-4 py-2.5 text-right font-medium">Archived</th>
            <th className="px-4 py-2.5 text-right font-medium">Posted %</th>
          </tr>
        </thead>
        <tbody>
          {CONTENT_ROWS.map(({ key, label }) => {
            const c = stats[key] as StatusCount;
            return (
              <tr key={key} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{c.total}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{c.drafted}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{c.posted}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{c.archived}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{pct(c.posted, c.total)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ stats }: { stats: ForumStats }) {
  const max = Math.max(1, ...stats.timeline.map((t) => t.posts));
  if (stats.timeline.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
        No posts marked as posted yet — the weekly cadence shows up here once you start shipping.
      </p>
    );
  }
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-4">
      {stats.timeline.map((t) => (
        <div key={t.week} className="flex min-w-[28px] flex-1 flex-col items-center gap-1">
          <span className="text-xs tabular-nums text-slate-500">{t.posts}</span>
          <div
            className="w-full rounded-t bg-orange-400"
            style={{ height: `${Math.max(6, (t.posts / max) * 110)}px` }}
            title={`Week of ${t.week}: ${t.posts} posted`}
          />
          <span className="whitespace-nowrap text-[10px] text-slate-400">{t.week.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function SubredditTable({ stats }: { stats: ForumStats }) {
  if (stats.bySubreddit.length === 0) {
    return <p className="text-sm text-slate-400">No placements yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 font-medium">Subreddit</th>
            <th className="px-4 py-2.5 text-right font-medium">Placements</th>
            <th className="px-4 py-2.5 text-right font-medium">Posted</th>
            <th className="px-4 py-2.5 text-right font-medium">Upvotes</th>
            <th className="px-4 py-2.5 text-right font-medium">Comments</th>
            <th className="px-4 py-2.5 text-right font-medium">Avg ratio</th>
          </tr>
        </thead>
        <tbody>
          {stats.bySubreddit.map((s) => (
            <tr key={s.subreddit} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2.5 font-medium text-slate-800">r/{s.subreddit.replace(/^r\//i, "")}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{s.placements}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{s.posted}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{s.upvotes}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{s.comments}</td>
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

function Contributors({ stats }: { stats: ForumStats }) {
  const max = Math.max(1, ...stats.contributors.map((c) => c.total));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Trophy className="h-4 w-4 text-amber-500" /> Team contributions
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {stats.contributorCoverage.withComment}/{stats.contributorCoverage.totalPosted} posted items have a
        detected team comment. Counts a member each time their Reddit handle is spotted on one of our
        threads, or they confirm via Slack ✅.
      </p>
      {stats.contributors.length === 0 ? (
        <p className="text-sm text-slate-400">No contributions detected yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {stats.contributors.map((c, i) => (
            <li key={c.owner_label} className="flex items-center gap-3">
              <span className="w-4 text-right text-xs text-slate-400">{i + 1}</span>
              <span className="w-28 shrink-0 truncate text-sm text-slate-700">{c.owner_label}</span>
              <div className="relative h-4 flex-1 rounded bg-slate-100">
                <div
                  className="h-4 rounded bg-amber-400"
                  style={{ width: `${(c.total / max) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-sm font-semibold tabular-nums text-slate-800">{c.total}</span>
              <span className="w-24 text-right text-[11px] text-slate-400">
                {c.reddit} reddit · {c.slack} slack
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span>
          <strong className="text-slate-700">{stats.roster.active}</strong> active accounts
        </span>
        <span>
          <strong className="text-slate-700">{stats.roster.canMention}</strong> can mention Wrenchlane
        </span>
        <span>
          <strong className="text-slate-700">{stats.roster.turnsWrenches}</strong> turn wrenches
        </span>
      </div>
    </div>
  );
}

function GapRollup({ stats }: { stats: ForumStats }) {
  const reviewed =
    stats.gaps.byVerdict.would_have_caught +
    stats.gaps.byVerdict.would_have_missed +
    stats.gaps.byVerdict.unsure;
  const outcomes: FailureOutcome[] = ["failure", "partial", "success", "unknown"];
  const verdicts: GapVerdict[] = ["would_have_caught", "would_have_missed", "unsure", "not_reviewed"];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <FlaskConical className="h-4 w-4 text-slate-500" /> Gap log — AI-failure R&amp;D
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {stats.gaps.total} stories logged. &quot;Would we have done better?&quot; hit-rate:{" "}
        <strong className="text-slate-700">
          {reviewed > 0 ? `${pct(stats.gaps.byVerdict.would_have_caught, reviewed)}%` : "—"}
        </strong>{" "}
        of {reviewed} reviewed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Outcome</div>
          <div className="flex flex-wrap gap-1.5">
            {outcomes.map((o) => (
              <span key={o} className={`rounded-full px-2.5 py-1 text-xs font-medium ${OUTCOME_META[o].badgeClass}`}>
                {OUTCOME_META[o].label}: {stats.gaps.byOutcome[o]}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Our verdict</div>
          <div className="flex flex-wrap gap-1.5">
            {verdicts.map((v) => (
              <span key={v} className={`rounded-full px-2.5 py-1 text-xs font-medium ${VERDICT_META[v].badgeClass}`}>
                {VERDICT_META[v].label}: {stats.gaps.byVerdict[v]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// The default "Overview" body. Header, Forums tab bar and the stats sub-nav are
// provided by StatsShell; this renders just the overview sections.
export function OverviewBody({ stats }: { stats: ForumStats }) {
  return (
    <>
      {/* Headline KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          icon={<Send className="h-4 w-4" />}
          label="Posts"
          value={stats.posts.posted + stats.distribution.posted}
          sub={`${stats.posts.total + stats.distribution.total} generated`}
        />
        <KpiTile
          icon={<Send className="h-4 w-4" />}
          label="Answers"
          value={stats.answers.posted}
          sub={`${stats.answers.total} drafted`}
        />
        <KpiTile
          icon={<ArrowUpToLine className="h-4 w-4" />}
          label="Upvotes"
          value={stats.traction.upvotes}
          sub={`${stats.traction.tracked} tracked items`}
        />
        <KpiTile
          icon={<MessageSquare className="h-4 w-4" />}
          label="Comments"
          value={stats.traction.comments}
        />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          label="Contributors"
          value={stats.contributors.length}
          sub={`${stats.roster.active} accounts`}
        />
        <KpiTile
          icon={<FlaskConical className="h-4 w-4" />}
          label="Gap stories"
          value={stats.gaps.total}
        />
      </div>

      {/* Content funnel */}
      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-800">Content funnel</h2>
      <FunnelTable stats={stats} />

      {/* Timeline */}
      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-800">Posted per week</h2>
      <Timeline stats={stats} />

      {/* By subreddit */}
      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-800">By subreddit</h2>
      <SubredditTable stats={stats} />

      {/* Contributions + gap log */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Contributors stats={stats} />
        <GapRollup stats={stats} />
      </div>

      {/* Wrenchlane exposure */}
      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-800">Wrenchlane exposure</h2>
      <WrenchlaneExposureCard stats={stats} />
    </>
  );
}

function WrenchlaneExposureCard({ stats }: { stats: ForumStats }) {
  const w = stats.wrenchlane;

  if (!w.tracked) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div>
          <p className="font-medium text-slate-700">Brand tracking is being switched on.</p>
          <p className="mt-0.5 text-slate-500">
            Once the <code className="rounded bg-slate-200 px-1">reddit_mentions</code> table is live and
            backfilled, this shows how many times we posted a Wrenchlane link, plus links and plaintext
            mentions of Wrenchlane by other Reddit users (with sentiment). Third-party detection arrives
            with the scan job (next phase).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile icon={<Link2 className="h-4 w-4" />} label="Our links" value={w.us.links} />
        <KpiTile icon={<MessageSquare className="h-4 w-4" />} label="Our mentions" value={w.us.mentions} />
        <KpiTile icon={<Link2 className="h-4 w-4" />} label="Others' links" value={w.thirdParty.links} />
        <KpiTile icon={<MessageSquare className="h-4 w-4" />} label="Others' mentions" value={w.thirdParty.mentions} />
      </div>
      <WrenchlaneExposureList items={w.recent} />
    </div>
  );
}
