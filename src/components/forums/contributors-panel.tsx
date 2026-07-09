"use client";

import { useEffect, useState } from "react";
import { Trophy, ChevronDown, ChevronRight, Loader2, MessagesSquare } from "lucide-react";

type ContributorTotal = {
  owner_label: string;
  total: number;
  reddit: number;
  slack: number;
};

// Aggregate "who's pulling weight" leaderboard across every posted forum item.
// Counts the two trustworthy signals only: a Reddit-detected comment or a
// Slack ✅ confirmation.
export function ContributorsPanel() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ContributorTotal[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/forums/contributors");
      const data = await res.json();
      if (res.ok) setRows((data.leaderboard ?? []) as ContributorTotal[]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded]);

  const max = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;
  const totalContribs = rows.reduce((n, r) => n + r.total, 0);

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
        <Trophy className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium text-slate-800">Team contributions</span>
        <span className="text-xs text-slate-400">
          {loaded ? `${totalContribs} across all posts` : "who's commented on our posts"}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4">
          <p className="mb-3 text-xs text-slate-500">
            Counts a member each time their Reddit account is detected commenting on one of our
            posts, or they ✅ their comment in{" "}
            <span className="font-medium">#forum-posts</span>. Use{" "}
            <span className="font-medium">Scan Reddit for our comments</span> on a posted card to
            refresh detection.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">
              No confirmed contributions yet. Post something, then scan the thread or have the team
              ✅ their comments.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={r.owner_label} className="flex items-center gap-3">
                  <span className="w-4 text-right text-xs font-semibold text-slate-400">{i + 1}</span>
                  <span className="w-20 flex-shrink-0 truncate text-sm font-medium text-slate-800">
                    {r.owner_label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${Math.round((r.total / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-sm font-semibold text-slate-900">
                    {r.total}
                  </span>
                  <span className="flex w-24 items-center justify-end gap-2 text-[10px] text-slate-400">
                    {r.reddit > 0 && (
                      <span className="inline-flex items-center gap-0.5" title="detected on Reddit">
                        <MessagesSquare className="h-3 w-3 text-orange-500" />
                        {r.reddit}
                      </span>
                    )}
                    {r.slack > 0 && <span title="confirmed via Slack ✅">✅ {r.slack}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
