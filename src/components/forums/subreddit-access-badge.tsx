"use client";

import { useEffect, useState } from "react";
import { Lock, Globe, Loader2, HelpCircle } from "lucide-react";

// Shows whether a subreddit is open to post in or members-only (private /
// approved-only), so you know before firing up a submit page. Reads the cached
// verdict (cheap); if the sub has never been checked it offers a "Check access"
// button that runs the live Apify scrape and caches the result.
//
// Access data comes from /api/forums/subreddit-access. See the Apify community
// probe in reddit-apify.ts for how "open" vs "members_only" is decided.

type Access = "open" | "members_only" | "unknown";

// Session-level cache + in-flight de-dupe so a list of badges (or the same sub
// repeated) doesn't fire a request each.
const cache = new Map<string, Access>();
const inflight = new Map<string, Promise<Access>>();

function readCached(sub: string): Promise<Access> {
  if (cache.has(sub)) return Promise.resolve(cache.get(sub)!);
  const existing = inflight.get(sub);
  if (existing) return existing;
  const p = fetch(`/api/forums/subreddit-access?subs=${encodeURIComponent(sub)}`)
    .then((r) => r.json())
    .then((d) => {
      const a = (d?.access?.[sub]?.access as Access) ?? "unknown";
      cache.set(sub, a);
      return a;
    })
    .catch(() => "unknown" as Access)
    .finally(() => inflight.delete(sub));
  inflight.set(sub, p);
  return p;
}

export function SubredditAccessBadge({
  subreddit,
  readOnly = false,
}: {
  subreddit: string;
  // In read-only contexts (e.g. inside a card that is itself a link) we can't
  // render the interactive "Check access" button, so an unchecked sub shows a
  // muted hint instead. It still displays a cached open/members-only verdict.
  readOnly?: boolean;
}) {
  const sub = subreddit.replace(/^\/?r\//i, "").trim().toLowerCase();
  const [access, setAccess] = useState<Access | null>(null); // null while loading cache
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!sub) {
      setAccess("unknown");
      return;
    }
    readCached(sub).then((a) => {
      if (alive) setAccess(a);
    });
    return () => {
      alive = false;
    };
  }, [sub]);

  async function check() {
    if (!sub) return;
    setChecking(true);
    try {
      const r = await fetch(`/api/forums/subreddit-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub }),
      });
      const d = await r.json();
      const a = (d?.access as Access) ?? "unknown";
      cache.set(sub, a);
      setAccess(a);
    } catch {
      // leave as-is
    } finally {
      setChecking(false);
    }
  }

  if (access === null) {
    return (
      <span className="inline-flex items-center text-[11px] text-slate-300">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  if (access === "open") {
    return (
      <span
        title="Open — anyone can post here (a few subs still gate posting; the submit page is the final word)"
        className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
      >
        <Globe className="h-3 w-3" /> Open
      </span>
    );
  }
  if (access === "members_only") {
    return (
      <span
        title="Members only — private or approved-posters-only. You'll need to request to join before you can post."
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
      >
        <Lock className="h-3 w-3" /> Members only
      </span>
    );
  }
  if (readOnly) {
    return (
      <span
        title="Not checked yet — open this post to check whether it's open or members-only"
        className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400"
      >
        <HelpCircle className="h-3 w-3" /> Access?
      </span>
    );
  }
  return (
    <button
      onClick={check}
      disabled={checking}
      title="Check whether this subreddit is open to post in or members-only"
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-200 disabled:opacity-60"
    >
      {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <HelpCircle className="h-3 w-3" />}
      {checking ? "Checking…" : "Check access"}
    </button>
  );
}
