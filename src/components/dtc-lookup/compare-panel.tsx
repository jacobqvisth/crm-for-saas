"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GitCompare,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCw,
} from "lucide-react";

interface WlCause {
  name?: string;
  confidence?: number;
}
interface WlResult {
  code: string;
  summary: string | null;
  causes: WlCause[] | null;
  raw: Record<string, unknown> | null;
  app_engine_code: string | null;
  captured_at: string;
}
interface Verdict {
  headline?: string;
  shared?: string[];
  only_lemon?: string[];
  only_wrenchlane?: string[];
  risk_notes?: string[];
}
interface Comparison {
  agreement: string | null;
  score: number | null;
  verdict: Verdict | null;
  model: string | null;
  created_at: string;
}

const AGREEMENT: Record<
  string,
  { label: string; cls: string; Icon: React.ElementType }
> = {
  strong: {
    label: "Agrees with the manual",
    cls: "border-emerald-300 bg-emerald-50 text-emerald-900",
    Icon: CheckCircle2,
  },
  partial: {
    label: "Partly agrees",
    cls: "border-amber-300 bg-amber-50 text-amber-900",
    Icon: AlertTriangle,
  },
  conflict: {
    label: "Conflicts with the manual",
    cls: "border-rose-300 bg-rose-50 text-rose-900",
    Icon: XCircle,
  },
  no_wrenchlane_data: {
    label: "Not captured yet",
    cls: "border-gray-300 bg-gray-50 text-gray-700",
    Icon: HelpCircle,
  },
};

function List({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
        {title}
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-800">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

export function ComparePanel({ code }: { code: string }) {
  const [wl, setWl] = useState<WlResult | null>(null);
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dtc-lookup/compare?code=${encodeURIComponent(code)}`);
      const d = await res.json();
      setWl(d.wrenchlane ?? null);
      setCmp(d.comparison ?? null);
    } catch {
      setError("Could not load the comparison.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(force = false) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/dtc-lookup/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, force }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      setWl(d.wrenchlane ?? null);
      setCmp(d.comparison ?? null);
      fetch("/api/dtc-lookup/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: code, code, kind: "compare" }),
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking Wrenchlane…
      </div>
    );
  }

  const a = cmp?.agreement ? AGREEMENT[cmp.agreement] ?? AGREEMENT.no_wrenchlane_data : null;

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GitCompare className="h-4 w-4 text-indigo-700" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-900">
          Wrenchlane comparison
        </span>
        {wl && (
          <span className="rounded bg-white px-2 py-0.5 text-[11px] text-gray-600">
            captured {new Date(wl.captured_at).toLocaleDateString()}
            {wl.app_engine_code ? ` · engine ${wl.app_engine_code}` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!cmp && (
            <button
              onClick={() => run(false)}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCompare className="h-3 w-3" />}
              {running ? "Comparing…" : "Compare with Wrenchlane"}
            </button>
          )}
          {cmp && (
            <button
              onClick={() => run(true)}
              disabled={running}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Re-run
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{error}</div>}

      {!wl && !cmp && (
        <p className="text-sm text-gray-600">
          No Wrenchlane diagnosis captured for <span className="font-mono">{code}</span> yet. Run{" "}
          <code className="rounded bg-white px-1 py-0.5 text-xs">
            node scripts/wrenchlane-capture.mjs --codes {code}
          </code>{" "}
          then compare.
        </p>
      )}

      {wl && (
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Wrenchlane says
            </div>
            <ul className="space-y-1 text-sm text-gray-800">
              {(wl.causes ?? []).map((c, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span>{c.name}</span>
                  {c.confidence != null && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
                      {c.confidence}%
                    </span>
                  )}
                </li>
              ))}
              {!wl.causes?.length && <li className="text-gray-500">No ranked causes returned.</li>}
            </ul>
            {wl.summary && (
              <p className="mt-2 border-t border-gray-100 pt-2 text-xs leading-relaxed text-gray-600">
                {wl.summary.slice(0, 320)}
              </p>
            )}
          </div>

          {a && (
            <div className={`rounded-md border p-3 ${a.cls}`}>
              <div className="mb-1.5 flex items-center gap-2">
                <a.Icon className="h-4 w-4" />
                <span className="text-sm font-semibold">{a.label}</span>
                {cmp?.score != null && (
                  <span className="ml-auto rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">
                    {cmp.score}/100
                  </span>
                )}
              </div>
              {cmp?.verdict?.headline && (
                <p className="text-sm leading-relaxed">{cmp.verdict.headline}</p>
              )}
            </div>
          )}
        </div>
      )}

      {cmp?.verdict && (
        <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
          <List title="Both agree" items={cmp.verdict.shared} tone="text-emerald-700" />
          <List
            title="Only in the factory manual"
            items={cmp.verdict.only_lemon}
            tone="text-sky-700"
          />
          <List
            title="Only Wrenchlane claims this"
            items={cmp.verdict.only_wrenchlane}
            tone="text-amber-700"
          />
          {!!cmp.verdict.risk_notes?.length && (
            <div className="rounded border border-rose-200 bg-rose-50 p-2.5">
              <List title="Watch out" items={cmp.verdict.risk_notes} tone="text-rose-700" />
            </div>
          )}
          {cmp.model && (
            <p className="border-t border-gray-100 pt-2 text-[11px] text-gray-400">
              Judged by {cmp.model} against the factory manual.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
