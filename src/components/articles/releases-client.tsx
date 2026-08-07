"use client";

// "Releases": find the release announcements in Gmail and republish them.
//
// Every WrenchLane release goes out as an email and is then written up as an
// article under Product Updates. That was a manual copy-paste job, screenshots
// included. This scans the mailbox, shows what it found, and imports one with a
// single click.
//
// Importing STAGES the item in Webflow rather than publishing it, so the last
// step stays a deliberate human action. That is the same PublishToSite control
// the Library uses, reused here so a release goes live by exactly the same
// route as everything else.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertCircle,
  CheckCircle2,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Mail,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { PublishToSite } from "./publish-to-site";

interface ReleaseCandidate {
  messageId: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  version: string | null;
  title: string;
  lead: string | null;
  sectionCount: number;
  imageCount: number;
  hasVideo: boolean;
  articleId: string | null;
  publishedUrl: string | null;
  status: string | null;
}

interface ScanResult {
  mailbox: string;
  query: string;
  configured: boolean;
  releases: ReleaseCandidate[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ReleasesClient() {
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/articles/releases");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Scan failed (${res.status})`);
        setResult(null);
        return;
      }
      setResult(data as ScanResult);
    } catch {
      setError("Could not reach the server");
    } finally {
      setScanning(false);
      setScanned(true);
    }
  }, []);

  // Scan once on open. Reading a mailbox is a few seconds, and arriving at an
  // empty page with a button to press is a worse first impression than a
  // spinner that resolves into the list.
  useEffect(() => {
    void scan();
  }, [scan]);

  async function importRelease(messageId: string) {
    setImporting(messageId);
    try {
      const res = await fetch("/api/articles/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? `Import failed (${res.status})`, { duration: 8000 });
        return;
      }
      const bits = [`${data.applied?.images ?? 0} screenshots`];
      if (data.applied?.video) bits.push("the demo video");
      if (data.applied?.hero) bits.push("a hero image");
      const langs = Object.keys(data.applied?.translations ?? {});
      if (langs.length) bits.push(`a ${langs.join(" and ")} translation`);
      toast.success(`Staged in Webflow with ${bits.join(", ")}. Not public yet.`, { duration: 8000 });
      if (data.applied?.failedImages?.length) {
        toast.error(`${data.applied.failedImages.length} image(s) could not be copied over`, {
          duration: 8000,
        });
      }
      // Worth surfacing loudly: the locale variant exists but still holds
      // English, and it cannot be translated later by any automatic route.
      if (data.applied?.translationErrors?.length) {
        toast.error(
          `Could not translate: ${data.applied.translationErrors.join(", ")}. The locale exists but still shows English.`,
          { duration: 10000 },
        );
      }
      await scan();
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Release announcements</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {result
              ? `Reading ${result.mailbox} for ${result.query}`
              : "Finds the release emails and turns one into an article, screenshots and all."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void scan()}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning" : "Scan for releases"}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Could not scan the mailbox</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {scanning && !result && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the mailbox
        </div>
      )}

      {result && result.releases.length === 0 && !scanning && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No release announcements found in {result.mailbox}. The scan looks for the Customer.io
          release campaign tag, so a mail sent outside that campaign will not show up here.
        </div>
      )}

      <div className="space-y-2">
        {result?.releases.map((r) => (
          <div
            key={r.messageId}
            className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {r.version && (
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-700">
                      {r.version}
                    </span>
                  )}
                  <h3 className="text-sm font-medium text-slate-900">{r.title}</h3>
                  {r.articleId && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      In the Library
                    </span>
                  )}
                </div>

                {r.lead && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.lead}</p>}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {formatDate(r.receivedAt)}
                  </span>
                  <span>{r.sectionCount} sections</span>
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    {r.imageCount}
                  </span>
                  {r.hasVideo && (
                    <span className="inline-flex items-center gap-1">
                      <FileVideo className="h-3 w-3" />
                      video
                    </span>
                  )}
                </div>
              </div>

              <div className="shrink-0">
                {r.articleId ? (
                  <PublishToSite
                    articleId={r.articleId}
                    format="blog_article"
                    language="en"
                    publishedUrl={r.publishedUrl}
                    status={r.status ?? undefined}
                    compact
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void importRelease(r.messageId)}
                    disabled={importing !== null || !result.configured}
                    title={
                      result.configured
                        ? "Build the article and create it in Webflow, staged and not public"
                        : "The server has no Webflow credentials"
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300"
                  >
                    {importing === r.messageId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Make article
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {scanned && result && result.releases.length > 0 && (
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          Importing creates the article in Webflow as a staged item under Product Updates, tagged
          release-notes. It is not on the public site until you press Publish it live. Note that a
          full site publish from the Webflow Designer also flushes staged items.
        </p>
      )}
    </div>
  );
}
