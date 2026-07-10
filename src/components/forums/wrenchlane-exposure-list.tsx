"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Check, X, Loader2 } from "lucide-react";

const SENTIMENT_CLASS: Record<string, string> = {
  positive: "bg-green-50 text-green-700",
  negative: "bg-red-50 text-red-700",
  neutral: "bg-slate-100 text-slate-600",
  competitor: "bg-amber-50 text-amber-700",
};

export interface ExposureItem {
  id: string;
  audience: string;
  kind: string;
  subreddit: string | null;
  author: string | null;
  source_url: string;
  matched_domain: string | null;
  sentiment: string | null;
  ai_summary: string | null;
  status: string;
  first_seen_at: string;
}

// The recent-mentions list with confirm/dismiss actions on third-party items
// awaiting review (status='new'). Confirming keeps it and stops showing the
// buttons; dismissing removes it from the list (and marks it dismissed so it
// no longer counts on the Stats page). Our own mentions have no review actions.
export function WrenchlaneExposureList({ items }: { items: ExposureItem[] }) {
  const [rows, setRows] = useState<ExposureItem[]>(items);
  const [busy, setBusy] = useState<string | null>(null);

  async function review(id: string, status: "confirmed" | "dismissed") {
    setBusy(id);
    try {
      const res = await fetch(`/api/forums/mentions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed");
      if (status === "dismissed") {
        setRows((r) => r.filter((m) => m.id !== id));
        toast.success("Dismissed");
      } else {
        setRows((r) => r.map((m) => (m.id === id ? { ...m, status: "confirmed" } : m)));
        toast.success("Confirmed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">No Wrenchlane footprint detected on Reddit yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {rows.map((m) => {
        const needsReview = m.audience === "third_party" && m.status === "new";
        return (
          <li key={m.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  m.audience === "us" ? "bg-orange-50 text-orange-700" : "bg-sky-50 text-sky-700"
                }`}
              >
                {m.audience === "us" ? "Us" : "Third party"}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {m.kind === "link" ? "Link" : "Mention"}
              </span>
              {m.sentiment ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    SENTIMENT_CLASS[m.sentiment] ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  {m.sentiment}
                </span>
              ) : null}
              {m.status === "confirmed" ? (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  Confirmed
                </span>
              ) : null}
              <span className="text-slate-500">
                {m.subreddit ? `r/${m.subreddit.replace(/^r\//i, "")}` : "—"}
              </span>
              {m.author ? <span className="text-slate-400">u/{m.author}</span> : null}

              <div className="ml-auto flex items-center gap-2">
                {needsReview ? (
                  <>
                    <button
                      type="button"
                      onClick={() => review(m.id, "confirmed")}
                      disabled={busy === m.id}
                      className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                    >
                      {busy === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => review(m.id, "dismissed")}
                      disabled={busy === m.id}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </button>
                  </>
                ) : null}
                <Link
                  href={m.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-slate-500 hover:text-orange-600"
                >
                  {m.matched_domain ?? "view thread"}
                </Link>
              </div>
            </div>
            {m.ai_summary ? <p className="mt-1 text-xs text-slate-500">{m.ai_summary}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
