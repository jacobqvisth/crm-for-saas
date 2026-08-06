"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  ClipboardList,
  Wrench,
  ScanSearch,
  Car,
  X,
} from "lucide-react";
import type {
  DtcCodeDetail,
  DtcCodeSummary,
  DtcSection,
  DtcVehicle,
} from "@/lib/dtc-lookup/types";

/** Section headings that deserve their own visual treatment. */
const TONE: Record<string, { ring: string; chip: string; icon?: React.ElementType }> = {
  WARNING: {
    ring: "border-amber-300 bg-amber-50",
    chip: "bg-amber-200 text-amber-900",
    icon: AlertTriangle,
  },
  "Possible cause": {
    ring: "border-rose-200 bg-rose-50/70",
    chip: "bg-rose-100 text-rose-800",
    icon: ScanSearch,
  },
  "Possible causes": { ring: "border-rose-200 bg-rose-50/70", chip: "bg-rose-100 text-rose-800" },
  "Possible cause and remedy": {
    ring: "border-rose-200 bg-rose-50/70",
    chip: "bg-rose-100 text-rose-800",
  },
  "Possible cause for the entry of this event code": {
    ring: "border-rose-200 bg-rose-50/70",
    chip: "bg-rose-100 text-rose-800",
  },
  "Possible measures": {
    ring: "border-emerald-200 bg-emerald-50/70",
    chip: "bg-emerald-100 text-emerald-800",
    icon: Wrench,
  },
  "Affected functions": {
    ring: "border-sky-200 bg-sky-50/70",
    chip: "bg-sky-100 text-sky-800",
  },
  "Specified value": {
    ring: "border-violet-200 bg-violet-50/70",
    chip: "bg-violet-100 text-violet-800",
  },
};

function toneFor(heading: string | null) {
  if (!heading) return null;
  if (TONE[heading]) return TONE[heading];
  if (heading.startsWith("Test")) {
    return { ring: "border-slate-200 bg-slate-50", chip: "bg-slate-200 text-slate-700" };
  }
  return { ring: "border-gray-200 bg-white", chip: "bg-gray-100 text-gray-700" };
}

/** The manual uses " - " as a bullet separator inside a run of text. */
function toBullets(text: string): string[] {
  const parts = text
    .split(/\s+-\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}

/** Highlight measurement specs like [11.0...14.5] V so they pop. */
function renderText(text: string) {
  const parts = text.split(/(\[[^\]]{1,40}\]\s*(?:V|ohms|A|Ω)?)/g);
  return parts.map((p, i) =>
    /^\[/.test(p) ? (
      <span
        key={i}
        className="mx-0.5 rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-violet-900"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function DtcLookupClient() {
  const [vehicle, setVehicle] = useState<DtcVehicle | null>(null);
  const [codes, setCodes] = useState<DtcCodeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DtcCodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deepHits, setDeepHits] = useState<DtcCodeSummary[] | null>(null);
  const [deepSearching, setDeepSearching] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dtc-lookup");
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load");
        const data = await res.json();
        if (cancelled) return;
        setVehicle(data.vehicle);
        setCodes(data.codes ?? []);
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

  // Instant local filter across code + description.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return codes;
    return codes.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        (c.summary ?? "").toLowerCase().includes(q) ||
        (c.chart ?? "").toLowerCase().includes(q)
    );
  }, [codes, query]);

  // When the local filter finds little, offer a full-text pass over the manual.
  useEffect(() => {
    setDeepHits(null);
    const q = query.trim();
    if (q.length < 3 || filtered.length > 4) return;
    const t = setTimeout(async () => {
      setDeepSearching(true);
      try {
        const res = await fetch(`/api/dtc-lookup?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          const known = new Set(filtered.map((c) => c.code));
          setDeepHits((data.codes ?? []).filter((c: DtcCodeSummary) => !known.has(c.code)));
        }
      } finally {
        setDeepSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, filtered]);

  const open = useCallback(async (code: string) => {
    setSelected(code);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/dtc-lookup?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      setDetail(data.detail ?? null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && selected) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading manual…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No vehicle manual has been imported yet. Run{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">
            scripts/import-dtc-manual.py
          </code>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* header ------------------------------------------------------------ */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">DTC Codes Lookup</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-white">
            <Car className="h-3.5 w-3.5" />
            {vehicle.year} {vehicle.make} {vehicle.model}
          </span>
          {vehicle.engine && (
            <span className="rounded-full bg-gray-100 px-3 py-1 font-mono text-xs text-gray-700">
              {vehicle.engine}
            </span>
          )}
          <span className="text-gray-400">·</span>
          <span>
            <strong className="text-gray-900">{codes.length}</strong> fault codes
          </span>
          <span className="text-gray-400">·</span>
          <span>
            {vehicle.page_count?.toLocaleString()} manual pages
          </span>
        </div>
      </div>

      {/* search ------------------------------------------------------------ */}
      <div className="sticky top-0 z-10 -mx-2 bg-white/90 px-2 pb-4 pt-1 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a fault code (EC55A, P179C42, 11AA00) or any words from the manual…"
            className="w-full rounded-xl border border-gray-300 bg-white py-3.5 pl-12 pr-24 text-[15px] shadow-sm outline-none transition focus:border-gray-900 focus:ring-4 focus:ring-gray-900/5"
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {query && (
              <button
                onClick={() => setQuery("")}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-500 sm:block">
              ⌘K
            </kbd>
          </div>
        </div>
        {query && (
          <div className="mt-2 text-xs text-gray-500">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
            {deepSearching && (
              <span className="ml-2 inline-flex items-center gap-1 text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" /> searching manual text…
              </span>
            )}
            {deepHits && deepHits.length > 0 && (
              <span className="ml-2">
                + {deepHits.length} found deeper in the manual text
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* results -------------------------------------------------------- */}
        <div className="max-h-[calc(100vh-260px)] space-y-1.5 overflow-y-auto pr-1">
          {filtered.length === 0 && (!deepHits || deepHits.length === 0) && (
            <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              No code matches “{query}”.
            </div>
          )}
          {[...filtered, ...(deepHits ?? [])].slice(0, 400).map((c) => {
            const active = selected === c.code;
            return (
              <button
                key={c.id}
                onClick={() => open(c.code)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  active
                    ? "border-gray-900 bg-gray-900 text-white shadow-sm"
                    : "border-gray-200 bg-white hover:border-gray-400 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{c.code}</span>
                  {c.chart && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                        active ? "bg-white/15 text-white/80" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {c.chart.replace(/ Charts?$/i, "")}
                    </span>
                  )}
                </div>
                {c.summary && (
                  <p
                    className={`mt-1 line-clamp-2 text-xs leading-relaxed ${
                      active ? "text-white/75" : "text-gray-600"
                    }`}
                  >
                    {c.summary}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* detail --------------------------------------------------------- */}
        <div className="min-w-0">
          {!selected && (
            <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 text-center text-gray-500">
              <ClipboardList className="mb-3 h-8 w-8 text-gray-300" />
              <p className="text-sm">Pick a fault code to see the full manual entry.</p>
              <p className="mt-1 text-xs text-gray-400">
                Causes, affected functions, test steps and figures.
              </p>
            </div>
          )}

          {selected && detailLoading && (
            <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading {selected}…
            </div>
          )}

          {selected && !detailLoading && detail && (
            <article className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <header className="border-b border-gray-100 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-mono text-2xl font-bold tracking-tight text-gray-900">
                    {detail.code}
                  </h2>
                  <button
                    onClick={() => copyCode(detail.code)}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
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
                  {detail.chart && (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                      {detail.chart}
                    </span>
                  )}
                  {detail.source_url && (
                    <a
                      href={detail.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
                    >
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {detail.summary && (
                  <p className="mt-3 text-[15px] font-medium leading-relaxed text-gray-900">
                    {detail.summary}
                  </p>
                )}
              </header>

              <div className="space-y-3 p-5">
                {detail.sections
                  .filter((s: DtcSection) => s.text || s.heading)
                  .map((s, i) => {
                    const tone = toneFor(s.heading);
                    const bullets = toBullets(s.text);
                    const Icon = tone && "icon" in tone ? tone.icon : undefined;
                    return (
                      <section
                        key={i}
                        className={`rounded-lg border p-4 ${tone?.ring ?? "border-gray-200 bg-white"}`}
                      >
                        {s.heading && (
                          <div className="mb-2 flex items-center gap-2">
                            {Icon && <Icon className="h-3.5 w-3.5" />}
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                                tone?.chip ?? "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {s.heading}
                            </span>
                          </div>
                        )}
                        {bullets.length > 0 ? (
                          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-800">
                            {bullets.map((b, j) => (
                              <li key={j}>{renderText(b)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm leading-relaxed text-gray-800">
                            {renderText(s.text)}
                          </p>
                        )}
                      </section>
                    );
                  })}

                {detail.figures.length > 0 && (
                  <section className="rounded-lg border border-gray-200 p-4">
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Figures ({detail.figures.length})
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {detail.figures.map((f) => (
                        <figure key={f.filename} className="overflow-hidden rounded-lg border border-gray-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/dtc-figures/${f.filename}`}
                            alt={f.caption ?? `Figure for ${detail.code}`}
                            loading="lazy"
                            className="w-full bg-white object-contain"
                          />
                          {f.caption && (
                            <figcaption className="border-t border-gray-100 bg-gray-50 p-2 text-[11px] leading-snug text-gray-600">
                              {f.caption}
                            </figcaption>
                          )}
                        </figure>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </article>
          )}

          {selected && !detailLoading && !detail && (
            <div className="rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
              Nothing found for {selected}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
