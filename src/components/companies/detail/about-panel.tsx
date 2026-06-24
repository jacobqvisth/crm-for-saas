'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import {
  ExternalLink, Pencil, MapPin, Building2, Linkedin, Instagram, Facebook, Trash2, CreditCard, Copy, ShieldOff,
  Globe, Sparkles, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ArrayChipsField } from '@/components/ui/array-chips-field';
import { EditableTextarea } from '@/components/ui/editable-textarea';
import type { Company, CompanyRef } from './types';

interface AboutPanelProps {
  company: Company;
  parentCompany: CompanyRef | undefined;
  childCompanies: CompanyRef[];
  onEditDetails: () => void;
  onDelete: () => void;
  onUpdateTags: (tags: string[]) => void;
  onUpdateNotes: (notes: string | null) => void;
  onUpdateFollowupFlags: (patch: { skip_auto_followup?: boolean; do_not_contact?: boolean }) => Promise<void>;
  onFindWebsite: () => void;
  findingWebsite: boolean;
}

export function AboutPanel({
  company, parentCompany, childCompanies, onEditDetails, onDelete, onUpdateTags, onUpdateNotes, onUpdateFollowupFlags,
  onFindWebsite, findingWebsite,
}: AboutPanelProps) {
  const tags = (company.tags as string[] | null) || [];

  const locationLine = [company.address, [company.postal_code, company.city].filter(Boolean).join(' '), company.country]
    .filter(Boolean)
    .join(', ');

  const socialLinks = [
    { url: company.linkedin_url, icon: Linkedin, label: 'LinkedIn' },
    { url: company.instagram_url, icon: Instagram, label: 'Instagram' },
    { url: company.facebook_url, icon: Facebook, label: 'Facebook' },
  ].filter((s): s is { url: string; icon: typeof Linkedin; label: string } => Boolean(s.url));

  const firmographic: Array<{ label: string; value: React.ReactNode }> = [];
  if (company.org_number) firmographic.push({ label: 'Org-nr', value: <span className="font-mono text-xs">{company.org_number}</span> });
  if (company.cfar_number) firmographic.push({ label: 'CFAR-nr', value: <span className="font-mono text-xs">{company.cfar_number}</span> });
  if (company.employee_size_band) firmographic.push({ label: 'Size band', value: `${company.employee_size_band} employees` });
  else if (company.employee_count) firmographic.push({ label: 'Employees', value: company.employee_count.toLocaleString() });
  if (company.county) firmographic.push({ label: 'County / Län', value: company.county });
  if (company.annual_revenue != null) firmographic.push({ label: 'Annual revenue', value: `$${company.annual_revenue.toLocaleString()}` });
  if (company.revenue_range) firmographic.push({ label: 'Revenue range', value: company.revenue_range });
  if (company.founded_year) firmographic.push({ label: 'Founded', value: company.founded_year.toString() });
  if (company.description) firmographic.push({ label: 'Description', value: <span className="whitespace-pre-wrap">{company.description}</span> });

  const hasComplianceFlag = company.is_sole_proprietor || company.marketing_opt_out || company.nix_blocked;

  return (
    <div className="space-y-4">
      {/* Details card */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Details</h3>
          <button
            onClick={onEditDetails}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        </div>

        {/* Website — priority field, always shown */}
        <div className="mb-3 pb-3 border-b border-slate-100">
          <div className="text-[11px] text-slate-500 mb-0.5">Website</div>
          {company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 max-w-full"
            >
              <Globe className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{company.website.replace(/^https?:\/\//, '')}</span>
            </a>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onEditDetails}
                className="text-sm text-slate-400 hover:text-slate-600"
              >
                — add
              </button>
              <button
                onClick={onFindWebsite}
                disabled={findingWebsite}
                title="Find the website automatically from the company name and location"
                className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 text-slate-600 disabled:opacity-50"
              >
                {findingWebsite ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {findingWebsite ? 'Finding…' : 'Find'}
              </button>
            </div>
          )}
        </div>

        {firmographic.length > 0 ? (
          <dl className="space-y-2">
            {firmographic.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-[11px] text-slate-500">{label}</dt>
                <dd className="text-sm text-slate-900 mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <button
            onClick={onEditDetails}
            className="text-xs text-slate-400 hover:text-slate-600 italic"
          >
            No details yet — click to add
          </button>
        )}
      </div>

      {/* Customer & Subscription — if on lifecycle */}
      {company.lifecycle_stage && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">Customer</h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            {company.plan && (
              <div className="col-span-2">
                <dt className="text-slate-500">Plan</dt>
                <dd className="text-slate-900 mt-0.5 font-mono break-all">{company.plan}</dd>
              </div>
            )}
            {company.plan_billing_cycle && (
              <div>
                <dt className="text-slate-500">Billing</dt>
                <dd className="text-slate-900 mt-0.5">{company.plan_billing_cycle}</dd>
              </div>
            )}
            {company.payment_status && (
              <div>
                <dt className="text-slate-500">Payment</dt>
                <dd className="text-slate-900 mt-0.5">{company.payment_status}</dd>
              </div>
            )}
            {company.activated_at && (
              <div>
                <dt className="text-slate-500">Activated</dt>
                <dd className="text-slate-900 mt-0.5">{format(new Date(company.activated_at), 'MMM d, yyyy')}</dd>
              </div>
            )}
            {company.churned_at && (
              <div>
                <dt className="text-red-600">Churned</dt>
                <dd className="text-red-600 mt-0.5">{format(new Date(company.churned_at), 'MMM d, yyyy')}</dd>
              </div>
            )}
          </dl>
          {company.churn_reason && (
            <p className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-600 italic">
              &ldquo;{company.churn_reason}&rdquo;
            </p>
          )}
          {(company.stripe_customer_id || company.stripe_subscription_id) && (
            <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
              {company.stripe_customer_id && (
                <StripeIdRow label="Stripe customer" value={company.stripe_customer_id} />
              )}
              {company.stripe_subscription_id && (
                <StripeIdRow label="Subscription" value={company.stripe_subscription_id} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Account profile — wl_workshop_id */}
      {company.wl_workshop_id && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">Account</h3>
          </div>
          <div className="text-[10px] text-slate-400 font-mono break-all mb-2">{company.wl_workshop_id}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            {company.acquisition_source && (
              <div>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-slate-900 mt-0.5 capitalize">{company.acquisition_source}</dd>
              </div>
            )}
            {company.member_count != null && (
              <div>
                <dt className="text-slate-500">Members</dt>
                <dd className="text-slate-900 mt-0.5">{company.member_count}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Location */}
      {locationLine && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Location</h3>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{locationLine}</p>
        </div>
      )}

      {/* Compliance flags (from SCB registry) */}
      {hasComplianceFlag && (
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldOff className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">Compliance</h3>
          </div>
          <div className="space-y-1.5 text-xs">
            {company.is_sole_proprietor && (
              <div className="flex items-start gap-2 text-amber-900">
                <span className="mt-0.5">⚠</span>
                <span><strong>Sole proprietor (fysisk person)</strong> — email is personal data under GDPR. Use legitimate-interest balancing, not generic B2B blasts.</span>
              </div>
            )}
            {company.marketing_opt_out && (
              <div className="flex items-start gap-2 text-rose-900">
                <span className="mt-0.5">⛔</span>
                <span><strong>Marketing opt-out (reklam-spärr)</strong> — must skip from any email send.</span>
              </div>
            )}
            {company.nix_blocked && (
              <div className="flex items-start gap-2 text-rose-900">
                <span className="mt-0.5">📵</span>
                <span><strong>NIX / telefonspärr</strong> — must skip from any phone outreach.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hierarchy */}
      {(parentCompany || childCompanies.length > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Hierarchy</h3>
          {parentCompany && (
            <div className="mb-2">
              <div className="text-[11px] text-slate-500 mb-0.5">Parent</div>
              <Link
                href={`/companies/${parentCompany.id}`}
                className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
              >
                <ExternalLink className="w-3 h-3" />
                {parentCompany.name}
              </Link>
            </div>
          )}
          {childCompanies.length > 0 && (
            <div>
              <div className="text-[11px] text-slate-500 mb-0.5">
                Children ({childCompanies.length})
              </div>
              <div className="space-y-0.5">
                {childCompanies.map((c) => (
                  <Link
                    key={c.id}
                    href={`/companies/${c.id}`}
                    className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
                  >
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{c.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Social links */}
      {socialLinks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Social</h3>
          <div className="space-y-1">
            {socialLinks.map(({ url, icon: Icon, label }) => (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                <ExternalLink className="w-3 h-3 ml-auto" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Tags & Notes */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <ArrayChipsField
          label="Tags"
          values={tags}
          variant="tag"
          onAdd={(v) => onUpdateTags([...tags, v])}
          onRemove={(i) => {
            const arr = [...tags];
            arr.splice(i, 1);
            onUpdateTags(arr);
          }}
          placeholder="Add tag..."
        />
        <EditableTextarea
          label="Notes"
          value={company.notes || ''}
          onSave={(v) => onUpdateNotes(v || null)}
          placeholder="Click to add notes..."
        />
      </div>

      {/* Outreach controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ShieldOff className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">Outreach controls</h3>
        </div>
        <ToggleRow
          label="Skip auto follow-up"
          helper="Field-route visits won't auto-enroll this company in a sequence."
          value={company.skip_auto_followup ?? false}
          onChange={(v) => onUpdateFollowupFlags({ skip_auto_followup: v })}
        />
        <ToggleRow
          label="Do not contact"
          helper="Set automatically on a 'not interested' visit. Suppresses sequences and outbound."
          value={company.do_not_contact ?? false}
          onChange={(v) => onUpdateFollowupFlags({ do_not_contact: v })}
        />
        {company.do_not_route && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <ShieldOff className="w-3.5 h-3.5 text-rose-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 text-[11px] text-rose-900">
              <p className="font-medium">Do not route</p>
              <p className="mt-0.5 text-rose-700">
                Field routes will skip this company.
                {company.do_not_route_reason && (
                  <> Reason: <span className="font-mono">{company.do_not_route_reason}</span>.</>
                )}
                {company.do_not_route_at && (
                  <> Set {new Date(company.do_not_route_at).toLocaleDateString()}.</>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Delete company
      </button>
    </div>
  );
}

function ToggleRow({
  label, helper, value, onChange,
}: {
  label: string;
  helper: string;
  value: boolean;
  onChange: (v: boolean) => Promise<void>;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-900">{label}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{helper}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await onChange(!value);
          } catch {
            toast.error('Failed to update');
          }
        }}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
          value ? 'bg-indigo-600' : 'bg-slate-200'
        }`}
        aria-pressed={value}
        aria-label={label}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

function StripeIdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-slate-500">{label}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          toast.success('Copied');
        }}
        className="inline-flex items-center gap-1 text-slate-700 font-mono hover:text-indigo-600 max-w-[160px]"
        title={value}
      >
        <span className="truncate">{value}</span>
        <Copy className="w-2.5 h-2.5 flex-shrink-0" />
      </button>
    </div>
  );
}
