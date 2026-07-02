'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { SlideOver } from '@/components/ui/slide-over';
import type { Company, CompanyRef } from './types';
import { INDUSTRIES, CATEGORIES } from './types';
import { PhoneInputControl } from '@/components/contacts/phone-field';
import { countryNameFromIso, isoFromCountryName } from '@/lib/geo/country';

type DraftCompany = Pick<
  Company,
  | 'name' | 'domain' | 'website' | 'phone'
  | 'industry' | 'category' | 'description'
  | 'employee_count' | 'annual_revenue' | 'revenue_range' | 'founded_year'
  | 'address' | 'postal_code' | 'city' | 'country' | 'country_code'
  | 'linkedin_url' | 'instagram_url' | 'facebook_url'
  | 'parent_company_id'
>;

interface EditDrawerProps {
  open: boolean;
  onClose: () => void;
  company: Company;
  allCompanies: CompanyRef[];
  customFields: Record<string, string>;
  onSave: (patch: Partial<Company>) => Promise<void>;
  onSaveCustomFields: (fields: Record<string, string>) => Promise<void>;
}

export function EditDrawer({
  open, onClose, company, allCompanies, customFields, onSave, onSaveCustomFields,
}: EditDrawerProps) {
  const [draft, setDraft] = useState<DraftCompany>(toDraft(company));
  const [fields, setFields] = useState<Record<string, string>>(customFields);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-sync when the drawer opens with possibly newer company data
  useEffect(() => {
    if (open) {
      setDraft(toDraft(company));
      setFields(customFields);
      setNewKey('');
      setNewValue('');
    }
  }, [open, company, customFields]);

  const set = <K extends keyof DraftCompany>(key: K, value: DraftCompany[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  // Keep country_code (ISO) + country (name) consistent when either changes.
  const syncCountry = (rawIso: string | null) => {
    const iso = rawIso?.trim().toUpperCase() || null;
    const name = iso ? countryNameFromIso(iso) : null;
    setDraft((d) => ({ ...d, country_code: iso, ...(name ? { country: name } : {}) }));
  };

  const handleSave = async () => {
    setSaving(true);
    const patch = diff(toDraft(company), draft);
    try {
      const tasks: Promise<unknown>[] = [];
      if (Object.keys(patch).length > 0) tasks.push(onSave(patch));
      if (!shallowEqual(fields, customFields)) tasks.push(onSaveCustomFields(fields));
      await Promise.all(tasks);
      toast.success('Saved');
      onClose();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAddField = () => {
    const k = newKey.trim();
    if (!k) return;
    setFields((f) => ({ ...f, [k]: newValue }));
    setNewKey('');
    setNewValue('');
  };

  return (
    <SlideOver open={open} onClose={onClose} title="Edit company">
      <div className="space-y-6">
        <Section title="Identity">
          <Row>
            <Field label="Name">
              <input type="text" value={draft.name || ''} onChange={(e) => set('name', e.target.value)} className={input} />
            </Field>
            <Field label="Domain">
              <input type="text" value={draft.domain || ''} onChange={(e) => set('domain', e.target.value || null)} className={input} placeholder="example.com" />
            </Field>
          </Row>
          <Row>
            <Field label="Phone">
              <PhoneInputControl
                value={draft.phone || null}
                defaultCountry={draft.country_code}
                onChange={(v) => set('phone', v)}
                onCountryChange={(iso) => syncCountry(iso)}
              />
            </Field>
            <Field label="Website">
              <input type="url" value={draft.website || ''} onChange={(e) => set('website', e.target.value || null)} className={input} placeholder="https://..." />
            </Field>
          </Row>
          <Row>
            <Field label="Industry">
              <select value={draft.industry || ''} onChange={(e) => set('industry', e.target.value || null)} className={input}>
                <option value="">No industry</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select value={draft.category || ''} onChange={(e) => set('category', e.target.value || null)} className={input}>
                <option value="">No category</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </Field>
          </Row>
        </Section>

        <Section title="About">
          <Field label="Description">
            <textarea
              value={draft.description || ''}
              onChange={(e) => set('description', e.target.value || null)}
              rows={4}
              className={`${input} resize-y`}
            />
          </Field>
          <Row>
            <Field label="Employees">
              <input type="number" value={draft.employee_count ?? ''} onChange={(e) => set('employee_count', e.target.value ? parseInt(e.target.value) : null)} className={input} />
            </Field>
            <Field label="Founded year">
              <input type="number" value={draft.founded_year ?? ''} onChange={(e) => set('founded_year', e.target.value ? parseInt(e.target.value) : null)} className={input} />
            </Field>
          </Row>
          <Row>
            <Field label="Annual revenue ($)">
              <input type="number" value={draft.annual_revenue ?? ''} onChange={(e) => set('annual_revenue', e.target.value ? parseFloat(e.target.value) : null)} className={input} />
            </Field>
            <Field label="Revenue range">
              <input type="text" value={draft.revenue_range || ''} onChange={(e) => set('revenue_range', e.target.value || null)} className={input} placeholder="$1M–$10M" />
            </Field>
          </Row>
        </Section>

        <Section title="Location">
          <Field label="Address">
            <input type="text" value={draft.address || ''} onChange={(e) => set('address', e.target.value || null)} className={input} />
          </Field>
          <Row>
            <Field label="Postal code">
              <input type="text" value={draft.postal_code || ''} onChange={(e) => set('postal_code', e.target.value || null)} className={input} />
            </Field>
            <Field label="City">
              <input type="text" value={draft.city || ''} onChange={(e) => set('city', e.target.value || null)} className={input} />
            </Field>
          </Row>
          <Row>
            <Field label="Country">
              <input
                type="text"
                value={draft.country || ''}
                onChange={(e) => set('country', e.target.value || null)}
                onBlur={(e) => { const iso = isoFromCountryName(e.target.value); if (iso) syncCountry(iso); }}
                className={input}
              />
            </Field>
            <Field label="Country code">
              <input
                type="text"
                value={draft.country_code || ''}
                onChange={(e) => syncCountry(e.target.value || null)}
                className={input}
                maxLength={2}
                placeholder="SE"
              />
            </Field>
          </Row>
        </Section>

        <Section title="Social">
          <Field label="LinkedIn">
            <input type="url" value={draft.linkedin_url || ''} onChange={(e) => set('linkedin_url', e.target.value || null)} className={input} placeholder="https://linkedin.com/company/..." />
          </Field>
          <Field label="Instagram">
            <input type="url" value={draft.instagram_url || ''} onChange={(e) => set('instagram_url', e.target.value || null)} className={input} placeholder="https://instagram.com/..." />
          </Field>
          <Field label="Facebook">
            <input type="url" value={draft.facebook_url || ''} onChange={(e) => set('facebook_url', e.target.value || null)} className={input} placeholder="https://facebook.com/..." />
          </Field>
        </Section>

        <Section title="Hierarchy">
          <Field label="Parent company">
            <select value={draft.parent_company_id || ''} onChange={(e) => set('parent_company_id', e.target.value || null)} className={input}>
              <option value="">No parent company</option>
              {allCompanies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </Section>

        {(company.google_place_id || company.rating != null) && (
          <Section title="Google Maps (read-only)">
            {company.google_place_id && (
              <div className="text-xs">
                <div className="text-slate-500 mb-1">Place ID</div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(company.google_place_id || '');
                    toast.success('Copied');
                  }}
                  className="inline-flex items-center gap-1 text-slate-700 font-mono hover:text-indigo-600"
                >
                  {company.google_place_id}
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            )}
            {company.rating != null && (
              <div className="text-xs">
                <div className="text-slate-500 mb-1">Rating</div>
                <div className="text-slate-700">
                  {company.rating}
                  {company.review_count != null && (
                    <span className="text-slate-400 ml-1">({company.review_count.toLocaleString()} reviews)</span>
                  )}
                </div>
              </div>
            )}
          </Section>
        )}

        <Section title="Custom fields">
          {Object.entries(fields).length === 0 && (
            <p className="text-xs text-slate-400 italic">No custom fields yet.</p>
          )}
          {Object.entries(fields).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-24 truncate" title={key}>{key}</span>
              <input
                type="text"
                value={value}
                onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                className="flex-1 text-sm px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                onClick={() => setFields((f) => {
                  const next = { ...f };
                  delete next[key];
                  return next;
                })}
                className="text-slate-400 hover:text-red-500"
                aria-label={`Remove ${key}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              placeholder="Key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="w-24 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddField(); }}
              className="flex-1 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={handleAddField}
              className="text-indigo-600 hover:text-indigo-700"
              aria-label="Add custom field"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </Section>
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-4 mt-6 px-4 py-3 bg-white border-t border-slate-200 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </SlideOver>
  );
}

const input = 'w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function toDraft(c: Company): DraftCompany {
  return {
    name: c.name,
    domain: c.domain,
    website: c.website,
    phone: c.phone,
    industry: c.industry,
    category: c.category,
    description: c.description,
    employee_count: c.employee_count,
    annual_revenue: c.annual_revenue,
    revenue_range: c.revenue_range,
    founded_year: c.founded_year,
    address: c.address,
    postal_code: c.postal_code,
    city: c.city,
    country: c.country,
    country_code: c.country_code,
    linkedin_url: c.linkedin_url,
    instagram_url: c.instagram_url,
    facebook_url: c.facebook_url,
    parent_company_id: c.parent_company_id,
  };
}

function diff(before: DraftCompany, after: DraftCompany): Partial<Company> {
  const patch: Record<string, unknown> = {};
  (Object.keys(after) as (keyof DraftCompany)[]).forEach((k) => {
    if (before[k] !== after[k]) patch[k] = after[k];
  });
  return patch as Partial<Company>;
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

