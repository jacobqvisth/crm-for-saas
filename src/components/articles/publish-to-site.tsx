"use client";

// "Put this on wrenchlane.com" for a blog article.
//
// Two actions rather than one, because the two have very different consequences:
//   Send to Webflow  creates the CMS item, staged, invisible to the public
//   Publish live     the same, then pushes that item onto wrenchlane.com
//
// Live publishing is behind a confirm, since it is a public, outward-facing
// change. Only blog articles in English are eligible; the API enforces the same
// rules, this just explains why the button is disabled.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CloudUpload, ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import type { ArticleFormat } from "@/lib/articles/types";

type Props = {
  articleId: string;
  format: ArticleFormat;
  language: string;
  publishedUrl: string | null;
  /** draft | approved | published. "approved" with a url means staged, not live. */
  status?: string;
  onPublished?: (url: string, live: boolean) => void;
  compact?: boolean;
};

export function PublishToSite({
  articleId,
  format,
  language,
  publishedUrl,
  status,
  onPublished,
  compact,
}: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"stage" | "live" | "resync" | null>(null);
  const [url, setUrl] = useState<string | null>(publishedUrl);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/articles/publish")
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d) => {
        if (!cancelled) setConfigured(Boolean(d.configured));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const eligible = format === "blog_article" && language === "en";

  async function send(mode: "stage" | "live" | "resync") {
    if (mode === "live") {
      const ok = window.confirm(
        "This publishes the article live on wrenchlane.com, where anyone can read it.\n\nHave you read it through? Check the claims list first if you have not.",
      );
      if (!ok) return;
    }
    setBusy(mode);
    try {
      const res = await fetch("/api/articles/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: articleId, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? `Publishing failed (${res.status})`, { duration: 8000 });
        return;
      }
      setUrl(data.url);
      onPublished?.(data.url, Boolean(data.live));
      toast.success(
        mode === "resync"
          ? "Re-synced to the site, including a fresh image"
          : data.live
            ? "Live on wrenchlane.com"
            : "Created in Webflow as a staged item, not public yet",
        { duration: 7000 },
      );
    } catch {
      toast.error("Publishing failed");
    } finally {
      setBusy(null);
    }
  }

  const isLive = status === "published";

  // Live: a link to it, plus a way to push changes to the existing item. Updating
  // in place is the only safe way to change a published article, because deleting
  // one keeps its slug reserved and orphans the live page.
  if (url && isLive) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          On the website
        </a>
        <button
          type="button"
          onClick={() => send("resync")}
          disabled={busy !== null}
          title="Update the live article in place: text, category, tags and a freshly drawn image. The URL does not change."
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy === "resync" ? "animate-spin" : ""}`} />
          Re-sync
        </button>
      </span>
    );
  }

  // Staged in Webflow but NOT public. Saying "On the website" here was wrong, and
  // there was no way to finish the job from this state.
  if (url && !isLive) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span
          title="The item exists in Webflow but is not on the public site yet"
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900"
        >
          <CloudUpload className="h-3.5 w-3.5" />
          In Webflow, not public
        </span>
        <button
          type="button"
          onClick={() => send("live")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
        >
          {busy === "live" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
          Publish it live
        </button>
      </span>
    );
  }

  if (!eligible) {
    const why =
      format === "blog_article"
        ? "Only English articles can go to the website for now."
        : "Only blog articles go to the website. This is a social post, so copy it and post it yourself.";
    return (
      <span className="text-xs text-slate-400" title={why}>
        {compact ? "Not for the website" : why}
      </span>
    );
  }

  // A greyed-out button with no explanation is a dead end. Say what is missing
  // and exactly how to fix it, since the fix is one command and the person
  // looking at this is the person who can run it.
  if (configured === false) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400"
          title="The server has no Webflow credentials, so it cannot reach the site"
        >
          <Globe className="h-3.5 w-3.5" />
          Website not connected
        </span>
        {!compact && (
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            {showHelp ? "Hide" : "How to connect"}
          </button>
        )}
        {showHelp && (
          <span className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            The server needs a Webflow API token before it can write to the site.
            <code className="mt-1.5 block rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-800">
              vercel env add WEBFLOW_API_TOKEN production
            </code>
            Paste the value from <code className="font-mono">~/wrenchlane-site/.env</code>, then
            redeploy. <code className="font-mono">WEBFLOW_SITE_ID</code> is already set.
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex gap-1.5">
      <button
        type="button"
        onClick={() => send("live")}
        disabled={busy !== null || configured === null}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
      >
        {busy === "live" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Globe className="h-3.5 w-3.5" />
        )}
        Publish to wrenchlane.com
      </button>
      <button
        type="button"
        onClick={() => send("stage")}
        disabled={busy !== null || configured === null}
        title="Create it in Webflow without making it public, so you can review it there first"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
      >
        {busy === "stage" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CloudUpload className="h-3.5 w-3.5" />
        )}
        Send as draft
      </button>
    </span>
  );
}
