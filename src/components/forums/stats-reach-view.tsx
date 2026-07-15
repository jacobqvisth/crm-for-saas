import { Globe, Link2, MessageSquare, Radio, Hash, Users, Sparkles } from "lucide-react";
import { KpiTile, EmptyNote, SectionTitle, VBars, fmt } from "./stats-ui";
import { WrenchlaneExposureList } from "./wrenchlane-exposure-list";
import type { ReachStats } from "@/lib/forums/stats-detail";

const SENTIMENT_META: { key: keyof ReachStats["bySentiment"]; label: string; className: string }[] = [
  { key: "positive", label: "Positive", className: "bg-green-50 text-green-700" },
  { key: "neutral", label: "Neutral", className: "bg-slate-100 text-slate-600" },
  { key: "negative", label: "Negative", className: "bg-red-50 text-red-700" },
  { key: "competitor", label: "Competitor", className: "bg-amber-50 text-amber-700" },
  { key: "unknown", label: "Unclassified", className: "bg-slate-50 text-slate-400" },
];

function Sentiment({ data }: { data: ReachStats }) {
  const total = data.totalMentions;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Sparkles className="h-4 w-4 text-slate-500" /> Sentiment of mentions
      </div>
      {total === 0 ? (
        <p className="text-sm text-slate-400">No mentions classified yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {SENTIMENT_META.map((s) => (
            <span key={s.key} className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>
              {s.label}: {data.bySentiment[s.key]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Communities({ data }: { data: ReachStats }) {
  const rows = data.bySubreddit.slice(0, 10);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Hash className="h-4 w-4 text-slate-500" /> Communities mentioning us
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No mention communities yet.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((s) => (
            <li key={s.subreddit} className="flex items-center justify-between">
              <span className="text-slate-700">r/{s.subreddit}</span>
              <span className="font-semibold tabular-nums text-slate-900">{s.mentions}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReachView({ data }: { data: ReachStats }) {
  return (
    <>
      {/* Reach proxy — always available from our own posted footprint */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          icon={<Globe className="h-4 w-4" />}
          label="Estimated reach"
          value={data.estimatedReach}
          sub="upvotes + comments on our threads & mentions"
        />
        <KpiTile icon={<Radio className="h-4 w-4" />} label="Threads posted in" value={data.threadsPostedIn} />
        <KpiTile icon={<Hash className="h-4 w-4" />} label="Subreddits touched" value={data.subredditsTouched} />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          label="Total mentions"
          value={data.tracked ? data.totalMentions : "—"}
          sub={data.tracked ? `${data.aboutUs} confirmed about us` : "tracking warming up"}
        />
      </div>

      {!data.tracked ? (
        <div className="mt-6">
          <EmptyNote>
            Brand-mention tracking is warming up. The daily scan populates links and plaintext mentions of
            Wrenchlane across Reddit; reach above is computed from our own posted footprint in the meantime.
          </EmptyNote>
        </div>
      ) : null}

      <SectionTitle hint={`${fmt(data.ourFootprintEngagement)} ours · ${fmt(data.mentionEngagement)} on mentions`}>
        Where the reach comes from
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile icon={<Link2 className="h-4 w-4" />} label="Our links" value={data.us.links} />
        <KpiTile icon={<MessageSquare className="h-4 w-4" />} label="Our mentions" value={data.us.mentions} />
        <KpiTile icon={<Link2 className="h-4 w-4" />} label="Others' links" value={data.thirdParty.links} />
        <KpiTile icon={<MessageSquare className="h-4 w-4" />} label="Others' mentions" value={data.thirdParty.mentions} />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Sentiment data={data} />
        <Communities data={data} />
      </div>

      {data.weekly.length > 0 ? (
        <>
          <SectionTitle>Mentions over time</SectionTitle>
          <VBars data={data.weekly.map((w) => ({ key: w.key, label: w.label, value: w.count }))} />
        </>
      ) : null}

      <SectionTitle>People talking about us</SectionTitle>
      {data.thirdPartyRecent.length === 0 ? (
        <EmptyNote>
          No organic mentions detected yet. When someone links or names Wrenchlane on Reddit unprompted, it
          shows up here for you to confirm or dismiss.
        </EmptyNote>
      ) : (
        <WrenchlaneExposureList items={data.thirdPartyRecent} />
      )}
    </>
  );
}
