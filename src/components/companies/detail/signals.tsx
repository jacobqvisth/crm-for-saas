'use client';

import { Star, TrendingUp, Heart, Activity as ActivityIcon, Calendar, Users } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import type { Company, Contact } from './types';

interface SignalsProps {
  company: Company;
  contacts: Contact[];
}

type Signal = {
  key: string;
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: 'default' | 'warn' | 'good' | 'danger';
};

export function CompanySignals({ company, contacts }: SignalsProps) {
  const signals: Signal[] = [];

  if (company.rating != null) {
    signals.push({
      key: 'rating',
      label: 'Rating',
      icon: <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />,
      value: (
        <span>
          {company.rating}
          {company.review_count != null && (
            <span className="text-slate-400 font-normal ml-1">({company.review_count.toLocaleString()})</span>
          )}
        </span>
      ),
    });
  }

  if (company.mrr_cents != null) {
    signals.push({
      key: 'mrr',
      label: 'MRR',
      icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />,
      value: (company.mrr_cents / 100).toLocaleString(undefined, {
        style: 'currency',
        currency: company.currency || 'EUR',
        maximumFractionDigits: 0,
      }),
      tone: 'good',
    });
  } else if (company.arr_cents != null) {
    signals.push({
      key: 'arr',
      label: 'ARR',
      icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />,
      value: (company.arr_cents / 100).toLocaleString(undefined, {
        style: 'currency',
        currency: company.currency || 'EUR',
        maximumFractionDigits: 0,
      }),
      tone: 'good',
    });
  }

  if (company.health_score != null) {
    const tone: Signal['tone'] =
      company.health_score >= 70 ? 'good' :
      company.health_score >= 40 ? 'warn'  :
                                   'danger';
    signals.push({
      key: 'health',
      label: 'Health',
      icon: <Heart className={`w-3.5 h-3.5 ${
        tone === 'good'   ? 'text-emerald-500' :
        tone === 'warn'   ? 'text-amber-500' :
                            'text-red-500'
      }`} />,
      value: `${company.health_score}/100`,
      tone,
    });
  }

  if (company.last_active_at) {
    signals.push({
      key: 'last-active',
      label: 'Last active',
      icon: <ActivityIcon className="w-3.5 h-3.5 text-slate-400" />,
      value: formatDistanceToNow(new Date(company.last_active_at), { addSuffix: true }),
    });
  }

  if (company.trial_ends_at) {
    signals.push({
      key: 'trial-ends',
      label: 'Trial ends',
      icon: <Calendar className="w-3.5 h-3.5 text-amber-500" />,
      value: format(new Date(company.trial_ends_at), 'MMM d, yyyy'),
      tone: 'warn',
    });
  }

  const last30d = contacts.reduce((s, c) => s + (c.diagnostics_last_30d ?? 0), 0);
  if (last30d > 0) {
    signals.push({
      key: 'diag-30d',
      label: 'Diagnostics 30d',
      icon: <ActivityIcon className="w-3.5 h-3.5 text-indigo-500" />,
      value: last30d.toLocaleString(),
    });
  }

  if (contacts.length > 0) {
    signals.push({
      key: 'contacts',
      label: 'Contacts',
      icon: <Users className="w-3.5 h-3.5 text-slate-400" />,
      value: contacts.length.toString(),
    });
  }

  if (signals.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-3 mb-4">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {signals.map((s) => (
          <div key={s.key} className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">
              {s.icon}
              <span>{s.label}</span>
            </div>
            <div className="text-sm font-semibold text-slate-900">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
