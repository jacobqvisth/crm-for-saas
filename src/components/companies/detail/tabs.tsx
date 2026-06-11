'use client';

import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { Activity as ActivityIcon } from 'lucide-react';
import { LeadStatusBadge } from '@/components/ui/badge';
import { StatusesTab } from './statuses-tab';
import type { OutreachStatus } from './status';
import type {
  Activity, Company, Contact, Subscription, UsageEvent, TabId,
} from './types';

type TabSpec = { id: TabId; label: string; count?: number; show: boolean };

interface TabsProps {
  activeTab: TabId;
  onChangeTab: (id: TabId) => void;
  company: Company;
  outreachStatus: OutreachStatus;
  contacts: Contact[];
  activities: Activity[];
  subscriptions: Subscription[];
  usageEvents: UsageEvent[];
}

export function CompanyTabs({
  activeTab, onChangeTab, company, outreachStatus,
  contacts, activities, subscriptions, usageEvents,
}: TabsProps) {
  const tabs: TabSpec[] = [
    { id: 'activity',      label: 'Activity',      count: activities.length || undefined,    show: true },
    { id: 'contacts',      label: 'Contacts',      count: contacts.length,                   show: true },
    { id: 'statuses',      label: 'Statuses',      show: true },
    { id: 'subscriptions', label: 'Subscriptions', count: subscriptions.length,              show: subscriptions.length > 0 },
    { id: 'usage',         label: 'App usage',     count: usageEvents.length,                show: usageEvents.length > 0 },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            onClick={() => onChangeTab(t.id)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap ${
              activeTab === t.id
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}{t.count != null ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      <div className="p-4">
        {activeTab === 'activity' && <ActivityTab activities={activities} />}
        {activeTab === 'contacts' && <ContactsTab contacts={contacts} />}
        {activeTab === 'statuses' && <StatusesTab company={company} outreachStatus={outreachStatus} />}
        {activeTab === 'subscriptions' && <SubscriptionsTab subscriptions={subscriptions} />}
        {activeTab === 'usage' && <UsageTab usageEvents={usageEvents} contacts={contacts} />}
      </div>
    </div>
  );
}

function ActivityTab({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No activity yet</p>;
  }
  return (
    <div className="space-y-0">
      {activities.map((a) => {
        const meta = (a.metadata ?? {}) as Record<string, unknown>;
        const senderName = typeof meta.sender_name === 'string' ? meta.sender_name : null;
        const senderEmail = typeof meta.sender_email === 'string' ? meta.sender_email : null;
        const who = senderName || senderEmail;
        return (
          <div key={a.id} className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">
                {a.subject || a.type.replace(/_/g, ' ')}
              </p>
              {a.type === 'email_sent' && who && (
                <p className="text-xs text-slate-500 mt-0.5">Sent by {who}</p>
              )}
              {a.body && <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{a.body}</p>}
              {a.created_at && (
                <p className="text-xs text-slate-400 mt-1">
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContactsTab({ contacts }: { contacts: Contact[] }) {
  if (contacts.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No contacts at this company</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left px-3 py-2 font-medium text-slate-600">Name</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600">Email</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600">Lead status</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600">Created</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2">
                <Link href={`/contacts/${c.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                  {[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}
                </Link>
              </td>
              <td className="px-3 py-2 text-slate-600">{c.email}</td>
              <td className="px-3 py-2"><LeadStatusBadge status={c.lead_status ?? 'new'} /></td>
              <td className="px-3 py-2 text-slate-500">
                {c.created_at ? format(new Date(c.created_at), 'MMM d, yyyy') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionsTab({ subscriptions }: { subscriptions: Subscription[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left px-3 py-2 font-medium text-slate-600">Plan</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600">MRR</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600">Period</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600">Stripe ID</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((s) => (
            <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2 font-medium text-slate-900 font-mono text-xs">{s.plan ?? '—'}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                  s.status === 'active'   ? 'bg-emerald-100 text-emerald-700' :
                  s.status === 'trialing' ? 'bg-amber-100 text-amber-700' :
                  s.status === 'canceled' ? 'bg-red-100 text-red-700' :
                                            'bg-slate-100 text-slate-700'
                }`}>{s.status ?? '—'}</span>
              </td>
              <td className="px-3 py-2 text-slate-700">
                {s.mrr_cents != null
                  ? (s.mrr_cents / 100).toLocaleString(undefined, { style: 'currency', currency: s.currency || 'EUR' })
                  : '—'}
              </td>
              <td className="px-3 py-2 text-slate-500 text-xs">
                {s.current_period_start && s.current_period_end
                  ? `${format(new Date(s.current_period_start), 'MMM d')} → ${format(new Date(s.current_period_end), 'MMM d, yyyy')}`
                  : s.trial_end
                    ? `trial until ${format(new Date(s.trial_end), 'MMM d, yyyy')}`
                    : '—'}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-slate-500 truncate max-w-[160px]">{s.stripe_subscription_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageTab({ usageEvents, contacts }: { usageEvents: UsageEvent[]; contacts: Contact[] }) {
  const totalDiagnostics = contacts.reduce((s, c) => s + (c.diagnostics_total ?? 0), 0);
  const last30dDiagnostics = contacts.reduce((s, c) => s + (c.diagnostics_last_30d ?? 0), 0);
  const lastActiveDates = contacts
    .map((c) => (c.last_active_at ? new Date(c.last_active_at).getTime() : 0))
    .filter((t) => t > 0);
  const mostRecentActive = lastActiveDates.length ? new Date(Math.max(...lastActiveDates)) : null;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <KPICard value={totalDiagnostics.toLocaleString()} label="Total diagnostics" />
        <KPICard value={last30dDiagnostics.toLocaleString()} label="Last 30 days" />
        <KPICard
          value={mostRecentActive ? formatDistanceToNow(mostRecentActive, { addSuffix: true }) : 'never'}
          label="Last team activity"
          small
        />
      </div>

      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Recent events</h4>
      {usageEvents.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">No usage events yet</p>
      ) : (
        <div className="space-y-1">
          {usageEvents.slice(0, 20).map((ev) => (
            <div key={ev.id} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
              <ActivityIcon className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 capitalize">
                  {ev.event_type.replace(/_/g, ' ')}
                </div>
                {ev.metadata && Object.keys(ev.metadata as object).length > 0 && (
                  <div className="text-[11px] text-slate-500 font-mono truncate">
                    {JSON.stringify(ev.metadata)}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-slate-400 whitespace-nowrap">
                {formatDistanceToNow(new Date(ev.event_at), { addSuffix: true })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KPICard({ value, label, small }: { value: string; label: string; small?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-md p-3">
      <div className={`${small ? 'text-sm' : 'text-2xl'} font-semibold text-slate-900 leading-none ${small ? 'leading-tight' : ''}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}
