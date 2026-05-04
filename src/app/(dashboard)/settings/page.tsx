'use client';

import Link from 'next/link';
import { GitBranch, Mail, Sparkles, ShieldCheck, Users, User as UserIcon } from 'lucide-react';
import { TeamSettings } from '@/components/settings/team-settings';
import { SenderAccountsSummary } from '@/components/settings/sender-accounts-summary';

const settingsItems = [
  {
    title: 'Profile & Signature',
    description: 'Your name, title, and email signature applied to outgoing sequences',
    href: '/settings/profile',
    icon: UserIcon,
  },
  {
    title: 'Pipelines',
    description: 'Manage your sales pipelines, stages, and probabilities',
    href: '/settings/pipelines',
    icon: GitBranch,
  },
  {
    title: 'Email Integration',
    description: 'Connect your Gmail account for sending sequences',
    href: '/settings/email',
    icon: Mail,
  },
  {
    title: 'AI Lead Filter',
    description: 'Score Prospector results against your ICP before adding them to your CRM',
    href: '/settings/ai-filter',
    icon: Sparkles,
  },
  {
    title: 'Compliance & DNC',
    description: 'Manage suppression list, DNC imports, and GDPR compliance',
    href: '/settings/compliance',
    icon: ShieldCheck,
  },
];

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Settings</h1>
        <p className="text-sm text-slate-500">Manage workspace settings, team members, and integrations.</p>
      </div>

      {/* Team Members */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-slate-500" />
          <h2 className="text-base font-semibold text-slate-900">Team Members</h2>
        </div>
        <TeamSettings />
      </section>

      {/* Sender Accounts */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Sender Accounts</h2>
          </div>
          <Link
            href="/settings/email"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Email Integration →
          </Link>
        </div>
        <SenderAccountsSummary />
      </section>

      {/* Settings cards */}
      <section>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Configuration</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {settingsItems.map(item => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block p-5 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-indigo-50">
                    <Icon className="w-5 h-5 text-slate-500 group-hover:text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600">{item.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
