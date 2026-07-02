'use client';

import type { Company } from './types';
import { OUTREACH_LABEL, type OutreachStatus } from './status';

interface StatusesTabProps {
  company: Company;
  outreachStatus: OutreachStatus;
}

type Pill = { value: string; label: string; activeCls: string };
type Concept = {
  key: string;
  title: string;
  source: string;
  description?: string;
  values: Pill[];
  activeValues: string[];
  /** Optional override label when something is active but not in the canonical list (e.g. unknown Stripe status). */
  unknownActive?: string;
};

export function StatusesTab({ company, outreachStatus }: StatusesTabProps) {
  const concepts: Concept[] = buildConcepts(company, outreachStatus);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 mb-2">
        All status fields tracked on this company. The pills currently set on this record are highlighted; the rest are the other possible values for reference.
      </p>
      {concepts.map((c) => (
        <ConceptCard key={c.key} concept={c} />
      ))}
    </div>
  );
}

function ConceptCard({ concept }: { concept: Concept }) {
  const activeSet = new Set(concept.activeValues);
  const hasUnknownActive =
    concept.activeValues.length > 0 &&
    concept.unknownActive != null &&
    !concept.values.some((v) => activeSet.has(v.value));

  return (
    <div className="border border-slate-200 rounded-lg bg-white p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-slate-900">{concept.title}</h3>
        <code className="text-[10px] text-slate-400 font-mono truncate">{concept.source}</code>
      </div>
      {concept.description && (
        <p className="text-[11px] text-slate-500 mb-2">{concept.description}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {concept.values.map((v) => {
          const active = activeSet.has(v.value);
          return (
            <span
              key={v.value}
              className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                active ? v.activeCls : 'bg-slate-50 text-slate-400 border border-slate-200'
              }`}
            >
              {v.label}
            </span>
          );
        })}
        {hasUnknownActive && (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            {concept.unknownActive} <span className="ml-1 opacity-70">(custom)</span>
          </span>
        )}
        {concept.activeValues.length === 0 && (
          <span className="inline-flex items-center px-2 py-0.5 text-[11px] italic text-slate-400">
            not set
          </span>
        )}
      </div>
    </div>
  );
}

function buildConcepts(company: Company, outreachStatus: OutreachStatus): Concept[] {
  const concepts: Concept[] = [];

  // 1) Has app account
  concepts.push({
    key: 'app-account',
    title: 'Has app account',
    source: 'companies.wl_workshop_id',
    description: 'Whether this company has signed up in the Wrenchlane app.',
    values: [
      { value: 'yes', label: 'yes', activeCls: 'bg-violet-100 text-violet-700' },
      { value: 'no',  label: 'no',  activeCls: 'bg-slate-100 text-slate-700' },
    ],
    activeValues: [company.wl_workshop_id ? 'yes' : 'no'],
  });

  // 2) Lifecycle stage
  concepts.push({
    key: 'lifecycle',
    title: 'Lifecycle stage',
    source: 'companies.lifecycle_stage',
    description: 'Sales/CS funnel stage. Drives reporting + outreach gating.',
    values: [
      { value: 'lead',         label: 'lead',         activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'mql',          label: 'mql',          activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'sql',          label: 'sql',          activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'trial',        label: 'trial',        activeCls: 'bg-amber-100 text-amber-700' },
      { value: 'freemium',     label: 'freemium',     activeCls: 'bg-teal-100 text-teal-700' },
      { value: 'paying',       label: 'paying',       activeCls: 'bg-emerald-100 text-emerald-700' },
      { value: 'churned',      label: 'churned',      activeCls: 'bg-red-100 text-red-700' },
      { value: 'reactivation', label: 'reactivation', activeCls: 'bg-purple-100 text-purple-700' },
    ],
    activeValues: company.lifecycle_stage ? [company.lifecycle_stage] : [],
    unknownActive: company.lifecycle_stage || undefined,
  });

  // 3) Customer status (operational)
  concepts.push({
    key: 'customer-status',
    title: 'Customer status (operational)',
    source: 'companies.customer_status',
    description: 'Mirrors the Stripe subscription state. Updated when the webhook fires.',
    values: [
      { value: 'trialing', label: 'trialing', activeCls: 'bg-amber-100 text-amber-700' },
      { value: 'active',   label: 'active',   activeCls: 'bg-emerald-100 text-emerald-700' },
      { value: 'paused',   label: 'paused',   activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'inactive', label: 'inactive', activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'churned',  label: 'churned',  activeCls: 'bg-red-100 text-red-700' },
    ],
    activeValues: company.customer_status ? [company.customer_status] : [],
    unknownActive: company.customer_status || undefined,
  });

  // 4) Payment status (Stripe)
  concepts.push({
    key: 'payment-status',
    title: 'Payment status (Stripe)',
    source: 'companies.payment_status',
    description: 'Latest invoice payment state. Stripe webhook updates this.',
    values: [
      { value: 'paid',        label: 'paid',        activeCls: 'bg-emerald-100 text-emerald-700' },
      { value: 'past_due',    label: 'past due',    activeCls: 'bg-amber-100 text-amber-700' },
      { value: 'unpaid',      label: 'unpaid',      activeCls: 'bg-red-100 text-red-700' },
      { value: 'failed',      label: 'failed',      activeCls: 'bg-red-100 text-red-700' },
      { value: 'incomplete',  label: 'incomplete',  activeCls: 'bg-slate-100 text-slate-700' },
    ],
    activeValues: company.payment_status ? [company.payment_status] : [],
    unknownActive: company.payment_status || undefined,
  });

  // 5) Subscription status (Stripe)
  concepts.push({
    key: 'subscription-status',
    title: 'Subscription status (Stripe)',
    source: 'companies.subscription_status',
    description: 'Raw Stripe subscription state. Open enum — list shows the most common values.',
    values: [
      { value: 'active',              label: 'active',              activeCls: 'bg-emerald-100 text-emerald-700' },
      { value: 'trialing',            label: 'trialing',            activeCls: 'bg-amber-100 text-amber-700' },
      { value: 'past_due',            label: 'past due',            activeCls: 'bg-amber-100 text-amber-700' },
      { value: 'canceled',            label: 'canceled',            activeCls: 'bg-red-100 text-red-700' },
      { value: 'unpaid',              label: 'unpaid',              activeCls: 'bg-red-100 text-red-700' },
      { value: 'incomplete',          label: 'incomplete',          activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'incomplete_expired',  label: 'incomplete expired',  activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'paused',              label: 'paused',              activeCls: 'bg-slate-100 text-slate-700' },
    ],
    activeValues: company.subscription_status ? [company.subscription_status] : [],
    unknownActive: company.subscription_status || undefined,
  });

  // 6) Outreach status (derived from contacts)
  concepts.push({
    key: 'outreach',
    title: 'Outreach status (derived from contacts)',
    source: 'contacts.lead_status (aggregated)',
    description:
      "Highest-priority status across this company's contacts. Customer wins overall; otherwise: churned > qualified > engaged > contacted > unqualified > not contacted.",
    values: [
      { value: 'not_contacted', label: OUTREACH_LABEL.not_contacted, activeCls: 'bg-slate-100 text-slate-700' },
      { value: 'contacted',     label: OUTREACH_LABEL.contacted,     activeCls: 'bg-yellow-100 text-yellow-700' },
      { value: 'engaged',       label: OUTREACH_LABEL.engaged,       activeCls: 'bg-purple-100 text-purple-700' },
      { value: 'qualified',     label: OUTREACH_LABEL.qualified,     activeCls: 'bg-violet-100 text-violet-700' },
      { value: 'customer',      label: OUTREACH_LABEL.customer,      activeCls: 'bg-emerald-100 text-emerald-700' },
      { value: 'unqualified',   label: OUTREACH_LABEL.unqualified,   activeCls: 'bg-slate-100 text-slate-500' },
      { value: 'churned',       label: OUTREACH_LABEL.churned,       activeCls: 'bg-red-100 text-red-700' },
    ],
    activeValues: [outreachStatus],
  });

  return concepts;
}
