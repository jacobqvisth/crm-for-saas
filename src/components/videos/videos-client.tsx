"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Youtube,
  Star,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Sparkles,
  Film,
} from "lucide-react";
import { TOP_CHANNELS } from "@/lib/videos/channels";
import type { DiagnosticVideo } from "@/lib/videos/types";

export function VideosClient() {
  const [videos, setVideos] = useState<DiagnosticVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markedOnly, setMarkedOnly] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/videos");
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load");
        const data = await res.json();
        if (!cancelled) setVideos(data.videos ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markedCount = useMemo(() => videos.filter((v) => v.marked).length, [videos]);
  const shown = markedOnly ? videos.filter((v) => v.marked) : videos;

  async function toggleMark(video: DiagnosticVideo) {
    const next = !video.marked;
    setSavingId(video.id);
    // Optimistic
    setVideos((prev) =>
      prev.map((v) => (v.id === video.id ? { ...v, marked: next } : v))
    );
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marked: next }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      // Revert on failure
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, marked: !next } : v))
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600">
          <Youtube className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Videos</h1>
          <p className="text-sm text-slate-500">
            YouTube videos that diagnose a specific DTC fault code — our targets
            for AI-generated marketing clips.
          </p>
        </div>
      </div>

      {/* Workflow note */}
      <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        <span className="font-medium">How this works:</span> browse the videos
        below and{" "}
        <span className="inline-flex items-center gap-1 font-medium">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" /> mark
        </span>{" "}
        the ones you want to work with. For each marked video I&apos;ll write a
        summary and a ready-to-paste{" "}
        <span className="font-medium">Google Veo 3</span> prompt that recreates
        the problem with a DIY car owner solving it using the Wrenchlane app.
        Every video here centers on one or more{" "}
        <span className="font-mono text-xs font-semibold text-red-700">P-codes</span>{" "}
        (shown as badges) — the fault the recreated clip will resolve.
      </div>

      {/* Top YouTubers */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Top YouTubers in car diagnosis
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {TOP_CHANNELS.map((c) => (
            <a
              key={c.handle}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-lg border border-slate-200 bg-white p-3 hover:border-red-300 hover:shadow-sm transition-colors"
            >
              <div className="flex items-center gap-2">
                <Youtube className="h-4 w-4 text-red-600 flex-shrink-0" />
                <span className="text-sm font-medium text-slate-800 group-hover:text-red-700 truncate">
                  {c.name}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 line-clamp-2">{c.blurb}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Videos */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            DTC-coded diagnosis videos{" "}
            <span className="ml-1 text-slate-400">
              ({markedCount} marked of {videos.length})
            </span>
          </h2>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={markedOnly}
              onChange={(e) => setMarkedOnly(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Marked only
          </label>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading videos…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {shown.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                saving={savingId === v.id}
                onToggle={() => toggleMark(v)}
              />
            ))}
            {shown.length === 0 && (
              <p className="text-sm text-slate-500 py-8">
                No marked videos yet. Mark a few above to get started.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function VideoCard({
  video,
  saving,
  onToggle,
}: {
  video: DiagnosticVideo;
  saving: boolean;
  onToggle: () => void;
}) {
  const thumb = `https://img.youtube.com/vi/${video.youtube_id}/hqdefault.jpg`;

  return (
    <div
      className={`flex flex-col rounded-xl border bg-white overflow-hidden transition-shadow ${
        video.marked
          ? "border-amber-300 ring-2 ring-amber-200"
          : "border-slate-200 hover:shadow-sm"
      }`}
    >
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-video bg-slate-100 group"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb}
          alt={video.title}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600/90 text-white opacity-0 group-hover:opacity-100 transition-opacity">
            <Youtube className="h-6 w-6" />
          </span>
        </span>
        {video.category && (
          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
            {video.category}
          </span>
        )}
      </a>

      <div className="flex flex-1 flex-col p-4">
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-slate-900 hover:text-red-700 line-clamp-2"
        >
          {video.title}
        </a>
        <p className="mt-0.5 text-xs text-slate-500">{video.channel}</p>
        {video.dtc_codes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {video.dtc_codes.map((code) => (
              <span
                key={code}
                className="rounded-md bg-red-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200"
              >
                {code}
              </span>
            ))}
          </div>
        )}
        {video.description && (
          <p className="mt-2 text-xs text-slate-600 line-clamp-2">
            {video.description}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onToggle}
            disabled={saving}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
              video.marked
                ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star
                className={`h-4 w-4 ${
                  video.marked ? "fill-amber-400 text-amber-500" : ""
                }`}
              />
            )}
            {video.marked ? "Marked" : "Mark"}
          </button>
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <ExternalLink className="h-4 w-4" /> Watch
          </a>
        </div>

        {/* Summary + Veo 3 prompt (phase 2). Shown once generated. */}
        {video.marked && (video.summary || video.veo3_prompt) && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            {video.summary && (
              <CopyBlock
                icon={<Film className="h-3.5 w-3.5" />}
                label="Summary"
                text={video.summary}
              />
            )}
            {video.veo3_prompt && (
              <CopyBlock
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Veo 3 prompt"
                text={video.veo3_prompt}
              />
            )}
          </div>
        )}

        {video.marked && !video.summary && !video.veo3_prompt && (
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Marked. Ask Claude to generate the summary + Veo 3 prompt for this one.
          </p>
        )}
      </div>
    </div>
  );
}

function CopyBlock({
  icon,
  label,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
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

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {icon} {label}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </button>
      </div>
      <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
        {text}
      </p>
    </div>
  );
}
