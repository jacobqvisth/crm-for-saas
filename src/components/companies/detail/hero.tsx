'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Plus, MoreHorizontal, ExternalLink, Pencil, Trash2,
} from 'lucide-react';
import type { Company } from './types';

interface HeroProps {
  company: Company;
  onUpdate: (field: keyof Company, value: string | null) => void;
  onAddContact: () => void;
  onAddDeal: () => void;
  onLogActivity: () => void;
  onDelete: () => void;
}

export function CompanyHero({
  company, onUpdate, onAddContact, onAddDeal, onLogActivity, onDelete,
}: HeroProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const faviconUrl = company.domain
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(company.domain)}&sz=64`
    : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
      <div className="mb-3">
        <Link href="/companies" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Companies
        </Link>
      </div>

      <div className="flex items-start gap-4">
        {faviconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external favicon, no Next/Image optimization needed
          <img
            src={faviconUrl}
            alt=""
            className="w-12 h-12 rounded-lg border border-slate-200 bg-white flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-lg font-semibold flex-shrink-0">
            {company.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <InlineEditable
            value={company.name}
            onSave={(v) => v.trim() && onUpdate('name', v.trim())}
            className="text-xl font-bold text-slate-900 leading-tight"
            inputClassName="text-xl font-bold"
            ariaLabel="Company name"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-slate-500">
            {company.website ? (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700"
              >
                <ExternalLink className="w-3 h-3" />
                {company.domain || company.website.replace(/^https?:\/\//, '')}
              </a>
            ) : company.domain ? (
              <span>{company.domain}</span>
            ) : null}
            {company.phone && <span>·</span>}
            {company.phone && (
              <InlineEditable
                value={company.phone}
                onSave={(v) => onUpdate('phone', v.trim() || null)}
                className="text-slate-500"
                inputClassName="text-sm"
                ariaLabel="Phone"
              />
            )}
          </div>
          <Badges company={company} />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onLogActivity}
            className="hidden md:inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Pencil className="w-3.5 h-3.5" />
            Log activity
          </button>
          <button
            onClick={onAddDeal}
            className="hidden md:inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Deal
          </button>
          <button
            onClick={onAddContact}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Contact
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center justify-center w-8 h-8 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg border border-slate-200 shadow-lg z-20 py-1">
                  <button
                    onClick={() => { setMenuOpen(false); onDelete(); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete company
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Badges({ company }: { company: Company }) {
  const badges: Array<{ key: string; label: string; cls: string }> = [];

  if (company.lifecycle_stage) {
    const stage = company.lifecycle_stage;
    const cls =
      stage === 'paying'       ? 'bg-emerald-100 text-emerald-700' :
      stage === 'trial'        ? 'bg-amber-100 text-amber-700' :
      stage === 'churned'      ? 'bg-red-100 text-red-700' :
      stage === 'reactivation' ? 'bg-purple-100 text-purple-700' :
                                 'bg-slate-100 text-slate-700';
    badges.push({ key: 'lifecycle', label: stage, cls });
  }
  if (company.customer_status && company.customer_status !== company.lifecycle_stage) {
    badges.push({ key: 'cstatus', label: company.customer_status, cls: 'bg-slate-100 text-slate-700' });
  }
  if (company.category) {
    badges.push({ key: 'cat', label: company.category, cls: 'bg-cyan-100 text-cyan-700' });
  }
  if (company.industry) {
    badges.push({ key: 'ind', label: company.industry, cls: 'bg-indigo-100 text-indigo-700' });
  }

  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {badges.map((b) => (
        <span
          key={b.key}
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${b.cls}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

function InlineEditable({
  value, onSave, className, inputClassName, ariaLabel,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value); setEditing(true); }}
        className={`cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1 ${className || ''}`}
        aria-label={ariaLabel}
      >
        {value}
      </span>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onSave(draft); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { onSave(draft); setEditing(false); }
        if (e.key === 'Escape') { setEditing(false); }
      }}
      className={`bg-white border border-indigo-300 rounded px-1 -mx-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputClassName || className || ''}`}
      aria-label={ariaLabel}
    />
  );
}
