import type { Contact } from './types';

export type OutreachStatus =
  | 'not_contacted'
  | 'contacted'
  | 'engaged'
  | 'qualified'
  | 'unqualified'
  | 'churned'
  | 'customer';

const CUSTOMER_LEAD_STATUSES: ReadonlySet<string> = new Set(['customer']);
const CHURNED_LEAD_STATUSES: ReadonlySet<string> = new Set(['churned']);
const QUALIFIED_LEAD_STATUSES: ReadonlySet<string> = new Set(['qualified']);
const ENGAGED_LEAD_STATUSES: ReadonlySet<string> = new Set(['engaged']);
const CONTACTED_LEAD_STATUSES: ReadonlySet<string> = new Set(['contacted']);
const UNQUALIFIED_LEAD_STATUSES: ReadonlySet<string> = new Set(['unqualified']);

/**
 * Aggregate per-contact lead_status into a single company-level outreach signal.
 * Priority: customer > churned > qualified > engaged > contacted > unqualified > not_contacted.
 * "Not contacted" applies when there are no contacts or all are 'new'.
 */
export function deriveOutreachStatus(contacts: Pick<Contact, 'lead_status'>[]): OutreachStatus {
  if (contacts.length === 0) return 'not_contacted';
  const leadStatuses = new Set(contacts.map((c) => c.lead_status ?? 'new'));
  if ([...leadStatuses].some((s) => CUSTOMER_LEAD_STATUSES.has(s))) return 'customer';
  if ([...leadStatuses].some((s) => CHURNED_LEAD_STATUSES.has(s))) return 'churned';
  if ([...leadStatuses].some((s) => QUALIFIED_LEAD_STATUSES.has(s))) return 'qualified';
  if ([...leadStatuses].some((s) => ENGAGED_LEAD_STATUSES.has(s))) return 'engaged';
  if ([...leadStatuses].some((s) => CONTACTED_LEAD_STATUSES.has(s))) return 'contacted';
  if ([...leadStatuses].some((s) => UNQUALIFIED_LEAD_STATUSES.has(s))) return 'unqualified';
  return 'not_contacted';
}

export const OUTREACH_LABEL: Record<OutreachStatus, string> = {
  not_contacted: 'Not contacted',
  contacted:     'Contacted',
  engaged:       'Engaged',
  qualified:     'Qualified',
  unqualified:   'Unqualified',
  churned:       'Churned',
  customer:      'Customer',
};

export const OUTREACH_COLOR: Record<OutreachStatus, string> = {
  not_contacted: 'bg-slate-100 text-slate-600',
  contacted:     'bg-yellow-100 text-yellow-700',
  engaged:       'bg-purple-100 text-purple-700',
  qualified:     'bg-violet-100 text-violet-700',
  unqualified:   'bg-slate-100 text-slate-500',
  churned:       'bg-red-100 text-red-700',
  customer:      'bg-emerald-100 text-emerald-700',
};
