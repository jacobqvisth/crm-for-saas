"use client";

import { useState } from "react";
import {
  Check,
  Lock,
  Tag,
  AlertTriangle,
  Target,
  Wrench,
  BarChart3,
  HelpCircle,
  Database,
  ChevronDown,
} from "lucide-react";
import {
  CURRENT,
  MRR_ANCHOR,
  OPEN_QUESTIONS,
  OPTIONS,
  QUERIES,
  SIGNALS,
  SIGNALS_AS_OF,
  type PlanDraft,
  type PricingOption,
} from "@/lib/pricing-options/options";

const ALL: PricingOption[] = [CURRENT, ...OPTIONS];

const toneStyle: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50",
  bad: "border-rose-200 bg-rose-50",
  flat: "border-slate-200 bg-white",
};

const toneValue: Record<string, string> = {
  good: "text-emerald-700",
  bad: "text-rose-700",
  flat: "text-slate-900",
};

const effortStyle: Record<string, string> = {
  Low: "bg-emerald-100 text-emerald-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-rose-100 text-rose-700",
};

export function PricingOptionsClient() {
  const [activeId, setActiveId] = useState<string>(OPTIONS[0].id);
  const [showQueries, setShowQueries] = useState(false);

  const active = ALL.find((o) => o.id === activeId) ?? OPTIONS[0];

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-8">
      {/* Header */}
      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900">Pricing options</h1>
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
            Drafts, not live pricing
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600 max-w-3xl">
          A place to argue about the shape of the plans before touching Stripe. Nothing on this page
          is wired to billing and nothing here changes what app.wrenchlane.com/en/pricing shows.
          Every number in the signals below is real, pulled from prod on {SIGNALS_AS_OF} with
          internal-test accounts excluded.
        </p>
      </header>

      {/* Signals */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            What the funnel actually does
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SIGNALS.map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 ${toneStyle[s.tone]}`}>
              <p className="text-xs font-medium text-slate-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${toneValue[s.tone]}`}>{s.value}</p>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">{s.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-xs font-medium text-slate-500">Revenue anchor</span>
          <span className="text-lg font-bold text-slate-900">
            ~SEK {MRR_ANCHOR.mrrSek.toLocaleString("sv-SE")} / month
          </span>
          <span className="text-sm text-slate-600">
            ARPA ~SEK {MRR_ANCHOR.arpaSek.toLocaleString("sv-SE")}
          </span>
          <span className="text-xs text-slate-500 flex-1 min-w-[280px]">{MRR_ANCHOR.note}</span>
        </div>
      </section>

      {/* Option tabs */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Tag className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            Six drafts
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL.map((o) => {
            const isActive = o.id === activeId;
            const isCurrent = o.id === "current";
            return (
              <button
                key={o.id}
                onClick={() => setActiveId(o.id)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-left ${
                  isActive
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : isCurrent
                    ? "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`inline-block w-6 text-xs font-bold ${
                    isActive ? "text-indigo-200" : "text-slate-400"
                  }`}
                >
                  {o.key}
                </span>
                {o.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Active option */}
      <OptionDetail option={active} />

      {/* Compare matrix */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            Side by side
          </h2>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 font-semibold text-slate-700 w-[160px]">
                  Option
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Free tier</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Trial</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Revenue shape</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Entry price</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-700">Build</th>
              </tr>
            </thead>
            <tbody>
              {ALL.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => setActiveId(o.id)}
                  className={`border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${
                    o.id === activeId ? "bg-indigo-50/60" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className="text-xs font-bold text-slate-400 mr-2">{o.key}</span>
                    <span className="font-medium text-slate-900">{o.name}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.freeTierLabel}</td>
                  <td className="px-4 py-3 text-slate-600">{o.trial}</td>
                  <td className="px-4 py-3 text-slate-600">{o.revenueShape}</td>
                  <td className="px-4 py-3 text-slate-600">{entryPrice(o)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        effortStyle[o.buildEffort]
                      }`}
                    >
                      {o.buildEffort}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Open questions */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <HelpCircle className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            Answer these before picking
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {OPEN_QUESTIONS.map((q) => (
            <div key={q.question} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-medium text-slate-900 text-sm">{q.question}</p>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{q.why}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Queries */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <button
          onClick={() => setShowQueries((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left"
        >
          <Database className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-900">
            SQL behind these numbers
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 ml-auto transition-transform ${
              showQueries ? "rotate-180" : ""
            }`}
          />
        </button>
        {showQueries && (
          <pre className="px-4 pb-4 text-xs text-slate-600 overflow-x-auto whitespace-pre">
            {QUERIES}
          </pre>
        )}
      </section>
    </div>
  );
}

function OptionDetail({ option }: { option: PricingOption }) {
  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3 flex-wrap">
          <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-bold">
            {option.key}
          </span>
          <h2 className="text-xl font-bold text-slate-900">{option.name}</h2>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
            {option.revenueShape}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              effortStyle[option.buildEffort]
            }`}
          >
            {option.buildEffort} build
          </span>
        </div>
        <p className="mt-3 text-slate-700 leading-relaxed max-w-4xl">{option.thesis}</p>
        <p className="mt-3 text-sm text-slate-500">
          <span className="font-medium text-slate-700">Trial: </span>
          {option.trial}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          <span className="font-medium text-slate-700">Best if: </span>
          {option.bestIf}
        </p>
      </div>

      {/* Plan card mockups */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          How the pricing page would look
        </p>
        <div
          className={`grid gap-4 sm:grid-cols-2 ${
            option.plans.length >= 4
              ? "xl:grid-cols-4"
              : option.plans.length === 3
              ? "lg:grid-cols-3"
              : "lg:grid-cols-2 max-w-2xl"
          }`}
        >
          {option.plans.map((p) => (
            <PlanCard key={p.name} plan={p} />
          ))}
        </div>
        {option.footnote && (
          <p className="mt-3 text-sm text-slate-600 leading-relaxed max-w-4xl">
            {option.footnote}
          </p>
        )}
      </div>

      {/* Analysis panels */}
      <div className="grid gap-4 lg:grid-cols-2">
        {option.changes.length > 0 && (
          <Panel
            title="What changes from today"
            icon={<Wrench className="w-4 h-4 text-slate-500" />}
            items={option.changes}
          />
        )}
        <Panel
          title="What the numbers say"
          icon={<BarChart3 className="w-4 h-4 text-indigo-500" />}
          items={option.evidence}
          accent="border-indigo-200 bg-indigo-50/40"
        />
        <Panel
          title="Where this could hurt"
          icon={<AlertTriangle className="w-4 h-4 text-rose-500" />}
          items={option.risks}
          accent="border-rose-200 bg-rose-50/40"
        />
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">The bet</h3>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{option.bet}</p>
        </div>
      </div>
    </section>
  );
}

function Panel({
  title,
  icon,
  items,
  accent = "border-slate-200 bg-white",
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  accent?: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it} className="text-sm text-slate-700 leading-relaxed flex gap-2">
            <span className="text-slate-300 mt-1.5 flex-shrink-0">&bull;</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanDraft }) {
  return (
    <div
      className={`relative rounded-xl border bg-white p-5 flex flex-col ${
        plan.highlight ? "border-indigo-400 ring-1 ring-indigo-200" : "border-slate-200"
      }`}
    >
      {plan.badge && (
        <span
          className={`absolute -top-2.5 right-4 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
            plan.highlight ? "bg-indigo-600 text-white" : "bg-amber-100 text-amber-800"
          }`}
        >
          {plan.badge}
        </span>
      )}
      <h4 className="font-bold text-slate-900">{plan.name}</h4>
      <p className="text-xs text-slate-500 mt-0.5 min-h-[32px]">{plan.tagline}</p>

      <div className="mt-3">
        <span className="text-2xl font-bold text-slate-900">{plan.price}</span>
        {plan.period && <span className="text-sm text-slate-500 ml-1">{plan.period}</span>}
      </div>
      {plan.priceNote && (
        <p className="text-[11px] text-emerald-700 font-medium mt-1">{plan.priceNote}</p>
      )}

      <ul className="mt-4 space-y-2 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2 text-xs text-slate-700">
            <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
        {plan.locked?.map((f) => (
          <li key={f} className="flex gap-2 text-xs text-slate-400">
            <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div
        className={`mt-4 text-center text-xs font-semibold py-2 rounded-lg ${
          plan.highlight ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
        }`}
      >
        {plan.cta}
      </div>
      {plan.trialNote && (
        <p className="mt-2 text-[11px] text-slate-500 text-center leading-snug">
          {plan.trialNote}
        </p>
      )}
    </div>
  );
}

function entryPrice(o: PricingOption): string {
  const paid = o.plans.filter(
    (p) => p.price !== "SEK 0" && p.price.toLowerCase() !== "free"
  );
  if (paid.length === 0) return "n/a";
  const first = paid[0];
  return `${first.price}${first.period ? " " + first.period : ""}`;
}
