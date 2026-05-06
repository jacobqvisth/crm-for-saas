'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Trash2, Plus, Loader2, X, ExternalLink, Star, Copy, BadgeCheck, MapPin,
  CreditCard, Wrench, Globe, Building2, AlertTriangle, Activity as ActivityIcon, Compass,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { LeadStatusBadge, DealStageBadge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { ArrayChipsField } from '@/components/ui/array-chips-field';
import { EditableTextarea } from '@/components/ui/editable-textarea';
import toast from 'react-hot-toast';
import type { Tables, Json } from '@/lib/database.types';

// Local extended types — global database.types.ts hasn't been regenerated since
// the 2026-05-05 / 06 schema changes (workshop CRM + discovered_shops extras).
// Adding the new columns here keeps the change self-contained.
type Company = Tables<'companies'> & {
  source?: string | null
  wl_workshop_id?: string | null
  lifecycle_stage?: string | null
  customer_status?: string | null
  plan?: string | null
  plan_billing_cycle?: string | null
  mrr_cents?: number | null
  arr_cents?: number | null
  currency?: string | null
  trial_ends_at?: string | null
  activated_at?: string | null
  churned_at?: string | null
  churn_reason?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  subscription_status?: string | null
  payment_status?: string | null
  acquisition_source?: string | null
  created_by_agent?: string | null
  account_owner_id?: string | null
  member_count?: number | null
  last_active_at?: string | null
  health_score?: number | null
}
type Contact = Tables<'contacts'> & {
  wl_user_id?: string | null
  app_username?: string | null
  app_role?: string | null
  last_login_at?: string | null
  last_active_at?: string | null
  login_count?: number | null
  credits_remaining?: number | null
  user_plan_type?: string | null
  user_subscription_status?: string | null
  user_stripe_customer_id?: string | null
  user_stripe_subscription_id?: string | null
  diagnostics_total?: number | null
  diagnostics_first_at?: string | null
  diagnostics_last_at?: string | null
  diagnostics_last_30d?: number | null
}
type Activity = Tables<'activities'>;
type Subscription = {
  id: string
  workspace_id: string
  company_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: string | null
  status: string | null
  current_period_start: string | null
  current_period_end: string | null
  trial_start: string | null
  trial_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  mrr_cents: number | null
  currency: string | null
  metadata: Json
  created_at: string
  updated_at: string
}
type UsageEvent = {
  id: string
  workspace_id: string
  company_id: string | null
  contact_id: string | null
  event_type: string
  event_at: string
  source: string | null
  metadata: Json
  external_id: string | null
  created_at: string
}
type DiscoveredShop = {
  id: string
  name: string
  google_place_id: string | null
  google_maps_url: string | null
  domain: string | null
  website: string | null
  primary_email: string | null
  phone: string | null
  city: string | null
  country_code: string | null
  rating: number | null
  review_count: number | null
  email_status: string | null
  email_valid: boolean | null
  permanently_closed: boolean | null
  temporarily_closed: boolean | null
  description: string | null
  additional_info: Json | null
  shop_type: string | null
  scraped_at: string | null
  source: string | null
  raw_data: Json | null
  crm_company_id: string | null
}

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing',
  'Retail', 'Real Estate', 'Media', 'Consulting', 'Legal', 'Other',
];

const CATEGORIES = [
  'auto repair', 'tire shop', 'bodywork', 'car wash', 'inspection', 'glass repair', 'other',
];

export function CompanyDetailClient({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<{ id: string; name: string; amount: number | null; stage: string; owner_id: string | null; expected_close_date: string | null }[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string }[]>([]);
  const [childCompanies, setChildCompanies] = useState<{ id: string; name: string }[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [discoveredShop, setDiscoveredShop] = useState<DiscoveredShop | null>(null);
  const [activeTab, setActiveTab] = useState<'contacts' | 'deals' | 'activity' | 'subscriptions' | 'usage'>('contacts');
  const [loading, setLoading] = useState(true);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  useEffect(() => {
    if (!workspaceId) return;

    async function load() {
      setLoading(true);

      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .eq('workspace_id', workspaceId!)
        .single();

      if (!companyData) {
        toast.error('Company not found');
        router.push('/companies');
        return;
      }
      setCompany(companyData);
      setCustomFields((companyData.custom_fields as Record<string, string>) || {});

      // Fetch all companies for parent dropdown (exclude self)
      const { data: companiesData } = await supabase
        .from('companies')
        .select('id, name')
        .eq('workspace_id', workspaceId!)
        .neq('id', companyId)
        .order('name');
      if (companiesData) setAllCompanies(companiesData);

      // Fetch child companies
      const { data: childData } = await supabase
        .from('companies')
        .select('id, name')
        .eq('workspace_id', workspaceId!)
        .eq('parent_company_id', companyId)
        .order('name');
      if (childData) setChildCompanies(childData);

      // Fetch contacts
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (contactsData) setContacts(contactsData);

      // Fetch deals
      const { data: dealsData } = await supabase
        .from('deals')
        .select('id, name, amount, stage, owner_id, expected_close_date')
        .eq('workspace_id', workspaceId!)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (dealsData) setDeals(dealsData);

      // Fetch activities for all contacts + company direct
      const contactIds = contactsData?.map(c => c.id) || [];
      let activitiesQuery = supabase
        .from('activities')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .order('created_at', { ascending: false })
        .limit(50);

      if (contactIds.length > 0) {
        activitiesQuery = activitiesQuery.or(`company_id.eq.${companyId},contact_id.in.(${contactIds.join(',')})`);
      } else {
        activitiesQuery = activitiesQuery.eq('company_id', companyId);
      }

      const { data: activitiesData } = await activitiesQuery;
      if (activitiesData) setActivities(activitiesData);

      // Subscriptions for this company
      const { data: subsData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (subsData) setSubscriptions(subsData);

      // Usage events (last 50) for this company
      const { data: usageData } = await supabase
        .from('usage_events')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .eq('company_id', companyId)
        .order('event_at', { ascending: false })
        .limit(50);
      if (usageData) setUsageEvents(usageData);

      // Linked discovered_shop (prospect-side data) — most recent if multiple
      const { data: shopData } = await supabase
        .from('discovered_shops')
        .select('*')
        .eq('crm_company_id', companyId)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (shopData) setDiscoveredShop(shopData);

      setLoading(false);
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, companyId]);

  const updateField = async (field: string, value: string | number | null) => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .update({ [field]: value } as Record<string, unknown>)
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to update');
    else {
      setCompany(prev => prev ? { ...prev, [field]: value } : null);
      toast.success('Updated');
    }
    setEditField(null);
  };

  const updateArrayField = async (field: string, newArray: string[]) => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .update({ [field]: newArray } as Record<string, unknown>)
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to update');
    else {
      setCompany(prev => prev ? { ...prev, [field]: newArray } : null);
      toast.success('Updated');
    }
  };

  const updateCustomFields = async (fields: Record<string, string>) => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .update({ custom_fields: fields as unknown as Json })
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to update');
    else {
      setCompany(prev => prev ? { ...prev, custom_fields: fields as unknown as Json } : null);
      setCustomFields(fields);
    }
  };

  const handleDelete = async () => {
    if (!company || !workspaceId) return;
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', company.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to delete');
    else {
      toast.success('Company deleted');
      router.push('/companies');
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!company) return null;

  const tags = (company.tags as string[] | null) || [];
  const parentCompany = allCompanies.find(c => c.id === company.parent_company_id);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link href="/companies" className="text-sm text-indigo-600 hover:text-indigo-700">
          &larr; Back to Companies
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Company Info */}
        <div className="w-full lg:w-[300px] flex-shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1">{company.name}</h2>
            {company.domain && (
              <p className="text-sm text-indigo-600 mb-4">{company.domain}</p>
            )}

            {/* Company Info */}
            <div className="space-y-3">
              <EditableField
                label="Name"
                value={company.name}
                isEditing={editField === 'name'}
                onEdit={() => { setEditField('name'); setEditValue(company.name); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('name', editValue)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Domain"
                value={company.domain || ''}
                isEditing={editField === 'domain'}
                onEdit={() => { setEditField('domain'); setEditValue(company.domain || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('domain', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Phone"
                value={company.phone || ''}
                isEditing={editField === 'phone'}
                onEdit={() => { setEditField('phone'); setEditValue(company.phone || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('phone', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              {/* Website */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Website</label>
                {editField === 'website' ? (
                  <input
                    type="url"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => updateField('website', editValue || null)}
                    onKeyDown={(e) => { if (e.key === 'Enter') updateField('website', editValue || null); if (e.key === 'Escape') setEditField(null); }}
                    autoFocus
                    placeholder="https://..."
                    className="w-full text-sm px-2 py-1.5 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : company.website ? (
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 truncate flex-1"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{company.website.replace(/^https?:\/\//, '')}</span>
                    </a>
                    <button
                      onClick={() => { setEditField('website'); setEditValue(company.website || ''); }}
                      className="ml-1 text-xs text-slate-400 hover:text-slate-600 flex-shrink-0"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <p
                    onClick={() => { setEditField('website'); setEditValue(''); }}
                    className="text-sm text-slate-400 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-slate-200"
                  >
                    —
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Industry</label>
                <select
                  value={company.industry || ''}
                  onChange={(e) => updateField('industry', e.target.value || null)}
                  className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">No industry</option>
                  {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                <select
                  value={company.category || ''}
                  onChange={(e) => updateField('category', e.target.value || null)}
                  className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">No category</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>
              <EditableTextarea
                label="Description"
                value={company.description || ''}
                onSave={(v) => updateField('description', v || null)}
                placeholder="Click to add description..."
                rows={3}
              />
              <EditableField
                label="Employee Count"
                value={company.employee_count?.toString() || ''}
                isEditing={editField === 'employee_count'}
                onEdit={() => { setEditField('employee_count'); setEditValue(company.employee_count?.toString() || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('employee_count', editValue ? parseInt(editValue) : null)}
                onCancel={() => setEditField(null)}
                type="number"
              />
              <EditableField
                label="Annual Revenue"
                value={company.annual_revenue ? `$${company.annual_revenue.toLocaleString()}` : ''}
                isEditing={editField === 'annual_revenue'}
                onEdit={() => { setEditField('annual_revenue'); setEditValue(company.annual_revenue?.toString() || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('annual_revenue', editValue ? parseFloat(editValue) : null)}
                onCancel={() => setEditField(null)}
                type="number"
              />
              <EditableField
                label="Revenue Range"
                value={company.revenue_range || ''}
                isEditing={editField === 'revenue_range'}
                onEdit={() => { setEditField('revenue_range'); setEditValue(company.revenue_range || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('revenue_range', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Founded Year"
                value={company.founded_year?.toString() || ''}
                isEditing={editField === 'founded_year'}
                onEdit={() => { setEditField('founded_year'); setEditValue(company.founded_year?.toString() || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('founded_year', editValue ? parseInt(editValue) : null)}
                onCancel={() => setEditField(null)}
                type="number"
              />
            </div>

            {/* Customer & Subscription — visible only when company is on lifecycle */}
            {company.lifecycle_stage && (
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-medium text-slate-700">Customer &amp; Subscription</h3>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(() => {
                    const stage = company.lifecycle_stage as string
                    const cls =
                      stage === 'paying'      ? 'bg-emerald-100 text-emerald-700' :
                      stage === 'trial'       ? 'bg-amber-100 text-amber-700' :
                      stage === 'churned'     ? 'bg-red-100 text-red-700' :
                      stage === 'reactivation'? 'bg-purple-100 text-purple-700' :
                                                'bg-slate-100 text-slate-700'
                    return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${cls}`}>{stage}</span>
                  })()}
                  {company.customer_status && (
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700">
                      {company.customer_status}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {company.plan && (
                    <div>
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
                  {company.mrr_cents != null && (
                    <div>
                      <dt className="text-slate-500">MRR</dt>
                      <dd className="text-slate-900 mt-0.5">{(company.mrr_cents / 100).toLocaleString(undefined,{style:'currency',currency:company.currency||'EUR'})}</dd>
                    </div>
                  )}
                  {company.arr_cents != null && (
                    <div>
                      <dt className="text-slate-500">ARR</dt>
                      <dd className="text-slate-900 mt-0.5">{(company.arr_cents / 100).toLocaleString(undefined,{style:'currency',currency:company.currency||'EUR'})}</dd>
                    </div>
                  )}
                  {company.payment_status && (
                    <div className="col-span-2">
                      <dt className="text-slate-500">Payment status</dt>
                      <dd className="text-slate-900 mt-0.5">{company.payment_status}</dd>
                    </div>
                  )}
                </dl>
                {(company.trial_ends_at || company.activated_at || company.churned_at) && (
                  <div className="text-xs space-y-1 pt-2 border-t border-slate-100">
                    {company.trial_ends_at && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Trial ends</span>
                        <span className="text-slate-900">{format(new Date(company.trial_ends_at), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {company.activated_at && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Activated</span>
                        <span className="text-slate-900">{format(new Date(company.activated_at), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {company.churned_at && (
                      <div className="flex justify-between">
                        <span className="text-red-600">Churned</span>
                        <span className="text-red-600">{format(new Date(company.churned_at), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {company.churn_reason && (
                      <div className="text-slate-700 italic mt-1">&ldquo;{company.churn_reason}&rdquo;</div>
                    )}
                  </div>
                )}
                {(company.stripe_customer_id || company.stripe_subscription_id) && (
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    {company.stripe_customer_id && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Stripe customer</span>
                        <span className="text-slate-900 font-mono truncate ml-2 max-w-[140px]">{company.stripe_customer_id}</span>
                      </div>
                    )}
                    {company.stripe_subscription_id && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Subscription</span>
                        <span className="text-slate-900 font-mono truncate ml-2 max-w-[140px]">{company.stripe_subscription_id}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Account Profile — visible when company has wl_workshop_id */}
            {company.wl_workshop_id && (
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-medium text-slate-700">Account Profile</h3>
                </div>
                <div className="text-[11px] text-slate-400 font-mono break-all">{company.wl_workshop_id}</div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {company.acquisition_source && (
                    <div>
                      <dt className="text-slate-500">Source</dt>
                      <dd className="text-slate-900 mt-0.5 capitalize">{company.acquisition_source}</dd>
                    </div>
                  )}
                  {company.created_by_agent && (
                    <div>
                      <dt className="text-slate-500">Created by</dt>
                      <dd className="text-slate-900 mt-0.5 truncate">{company.created_by_agent}</dd>
                    </div>
                  )}
                  {company.member_count != null && (
                    <div>
                      <dt className="text-slate-500">Members</dt>
                      <dd className="text-slate-900 mt-0.5">{company.member_count}</dd>
                    </div>
                  )}
                  {company.last_active_at && (
                    <div>
                      <dt className="text-slate-500">Last active</dt>
                      <dd className="text-slate-900 mt-0.5">{formatDistanceToNow(new Date(company.last_active_at), { addSuffix: true })}</dd>
                    </div>
                  )}
                  {company.health_score != null && (
                    <div>
                      <dt className="text-slate-500">Health</dt>
                      <dd className="text-slate-900 mt-0.5">{company.health_score}/100</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* Discovery Source — visible when a discovered_shops row links here */}
            {discoveredShop && (
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-cyan-600" />
                  <h3 className="text-sm font-medium text-slate-700">Discovery Source</h3>
                </div>
                {discoveredShop.google_maps_url && (
                  <a
                    href={discoveredShop.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 rounded-md border border-cyan-200"
                  >
                    <MapPin className="w-3.5 h-3.5" /> Open in Google Maps <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {discoveredShop.shop_type && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-cyan-100 text-cyan-700">
                      <Wrench className="w-3 h-3" /> {discoveredShop.shop_type}
                    </span>
                    {(discoveredShop.raw_data as Record<string, unknown> | null)?.['chain_tag'] != null && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                        chain · {String((discoveredShop.raw_data as Record<string, unknown>)['chain_tag'])}
                      </span>
                    )}
                    {discoveredShop.email_status && (
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                        discoveredShop.email_status === 'valid'     ? 'bg-emerald-100 text-emerald-700' :
                        discoveredShop.email_status === 'catch_all' ? 'bg-amber-100 text-amber-700' :
                                                                       'bg-slate-100 text-slate-600'
                      }`}>
                        email: {discoveredShop.email_status}
                      </span>
                    )}
                  </div>
                )}
                {discoveredShop.description && (
                  <p className="text-xs text-slate-600 leading-relaxed">{discoveredShop.description}</p>
                )}
                {discoveredShop.permanently_closed && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <AlertTriangle className="w-3.5 h-3.5" /> Permanently closed
                  </div>
                )}
                {discoveredShop.temporarily_closed && (
                  <div className="flex items-center gap-1 text-xs text-amber-600">
                    <AlertTriangle className="w-3.5 h-3.5" /> Temporarily closed
                  </div>
                )}
                {discoveredShop.rating != null && (
                  <div className="flex items-center gap-1 text-xs text-slate-700">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    {discoveredShop.rating} <span className="text-slate-400">({(discoveredShop.review_count ?? 0).toLocaleString()} reviews)</span>
                  </div>
                )}
                {discoveredShop.additional_info && Array.isArray(discoveredShop.additional_info) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Service details</summary>
                    <pre className="mt-2 p-2 bg-slate-50 rounded text-[10px] overflow-auto max-h-40">{JSON.stringify(discoveredShop.additional_info, null, 2)}</pre>
                  </details>
                )}
                <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">
                  scraped {discoveredShop.scraped_at ? formatDistanceToNow(new Date(discoveredShop.scraped_at), { addSuffix: true }) : 'recently'}
                  {discoveredShop.source && <> · source: {discoveredShop.source}</>}
                </div>
              </div>
            )}

            {/* Location */}
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <h3 className="text-sm font-medium text-slate-700">Location</h3>
              <EditableField
                label="Address"
                value={company.address || ''}
                isEditing={editField === 'address'}
                onEdit={() => { setEditField('address'); setEditValue(company.address || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('address', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Postal Code"
                value={company.postal_code || ''}
                isEditing={editField === 'postal_code'}
                onEdit={() => { setEditField('postal_code'); setEditValue(company.postal_code || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('postal_code', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="City"
                value={company.city || ''}
                isEditing={editField === 'city'}
                onEdit={() => { setEditField('city'); setEditValue(company.city || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('city', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Country"
                value={company.country || ''}
                isEditing={editField === 'country'}
                onEdit={() => { setEditField('country'); setEditValue(company.country || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('country', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Country Code"
                value={company.country_code || ''}
                isEditing={editField === 'country_code'}
                onEdit={() => { setEditField('country_code'); setEditValue(company.country_code || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('country_code', editValue || null)}
                onCancel={() => setEditField(null)}
              />
            </div>

            {/* Google Maps Data */}
            {(company.google_place_id || company.rating || company.review_count) && (
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                <h3 className="text-sm font-medium text-slate-700">Google Maps Data</h3>
                {company.google_place_id && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Place ID</label>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-slate-600 truncate flex-1 px-2 py-1.5">
                        {company.google_place_id}
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(company.google_place_id || '');
                          toast.success('Copied');
                        }}
                        className="flex-shrink-0 text-slate-400 hover:text-slate-600 p-1"
                        title="Copy Place ID"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
                {(company.rating || company.review_count) && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Rating</label>
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      {company.rating && (
                        <>
                          <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                          <span className="text-sm font-medium text-slate-800">{company.rating}</span>
                        </>
                      )}
                      {company.review_count && (
                        <span className="text-sm text-slate-500">({company.review_count.toLocaleString()} reviews)</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Parent Company */}
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <h3 className="text-sm font-medium text-slate-700">Parent Company</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Parent</label>
                <select
                  value={company.parent_company_id || ''}
                  onChange={(e) => updateField('parent_company_id', e.target.value || null)}
                  className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">No parent company</option>
                  {allCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {parentCompany && (
                  <Link
                    href={`/companies/${parentCompany.id}`}
                    className="inline-flex items-center gap-1 mt-1.5 text-xs text-indigo-600 hover:text-indigo-700 px-2"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View {parentCompany.name}
                  </Link>
                )}
              </div>
              {childCompanies.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Child Companies ({childCompanies.length})
                  </label>
                  <div className="space-y-1">
                    {childCompanies.map(child => (
                      <Link
                        key={child.id}
                        href={`/companies/${child.id}`}
                        className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 px-2 py-1"
                      >
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{child.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Social Links */}
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <h3 className="text-sm font-medium text-slate-700">Social Links</h3>
              <SocialLinkField
                label="LinkedIn"
                value={company.linkedin_url || ''}
                isEditing={editField === 'linkedin_url'}
                onEdit={() => { setEditField('linkedin_url'); setEditValue(company.linkedin_url || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('linkedin_url', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <SocialLinkField
                label="Instagram"
                value={company.instagram_url || ''}
                isEditing={editField === 'instagram_url'}
                onEdit={() => { setEditField('instagram_url'); setEditValue(company.instagram_url || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('instagram_url', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <SocialLinkField
                label="Facebook"
                value={company.facebook_url || ''}
                isEditing={editField === 'facebook_url'}
                onEdit={() => { setEditField('facebook_url'); setEditValue(company.facebook_url || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('facebook_url', editValue || null)}
                onCancel={() => setEditField(null)}
              />
            </div>

            {/* Tags & Notes */}
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <h3 className="text-sm font-medium text-slate-700">Tags &amp; Notes</h3>
              <ArrayChipsField
                label="Tags"
                values={tags}
                variant="tag"
                onAdd={(v) => updateArrayField('tags', [...tags, v])}
                onRemove={(i) => {
                  const arr = [...tags];
                  arr.splice(i, 1);
                  updateArrayField('tags', arr);
                }}
                placeholder="Add tag..."
              />
              <EditableTextarea
                label="Notes"
                value={company.notes || ''}
                onSave={(v) => updateField('notes', v || null)}
                placeholder="Click to add notes..."
              />
            </div>

            {/* Custom Fields */}
            <div className="mt-6 pt-4 border-t border-slate-200">
              <h3 className="text-sm font-medium text-slate-700 mb-3">Custom Fields</h3>
              {Object.entries(customFields).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-slate-500 w-24 truncate">{key}</span>
                  <input
                    type="text"
                    defaultValue={value}
                    onBlur={(e) => {
                      const updated = { ...customFields, [key]: e.target.value };
                      updateCustomFields(updated);
                    }}
                    className="flex-1 text-sm px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    onClick={() => {
                      const updated = { ...customFields };
                      delete updated[key];
                      updateCustomFields(updated);
                    }}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  placeholder="Key"
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(e.target.value)}
                  className="w-24 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                  className="flex-1 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={() => {
                    if (newFieldKey.trim()) {
                      const updated = { ...customFields, [newFieldKey.trim()]: newFieldValue };
                      updateCustomFields(updated);
                      setNewFieldKey('');
                      setNewFieldValue('');
                    }
                  }}
                  className="text-indigo-600 hover:text-indigo-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              Delete company
            </button>
          </div>
        </div>

        {/* Right Column: Tabs */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-slate-200">
            {/* Tab Bar */}
            <div className="flex border-b border-slate-200 overflow-x-auto">
              {(() => {
                const tabs: Array<{ id: typeof activeTab; label: string; count?: number; show: boolean }> = [
                  { id: 'contacts',      label: 'Contacts',     count: contacts.length,      show: true },
                  { id: 'deals',         label: 'Deals',        count: deals.length,         show: true },
                  { id: 'activity',      label: 'Activity',     count: undefined,            show: true },
                  { id: 'subscriptions', label: 'Subscriptions',count: subscriptions.length, show: subscriptions.length > 0 },
                  { id: 'usage',         label: 'App usage',    count: usageEvents.length,   show: usageEvents.length > 0 },
                ]
                return tabs.filter(t => t.show).map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`px-6 py-3 text-sm font-medium whitespace-nowrap ${
                      activeTab === t.id
                        ? 'text-indigo-600 border-b-2 border-indigo-600'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.label}{t.count != null ? ` (${t.count})` : ''}
                  </button>
                ))
              })()}
            </div>

            <div className="p-4">
              {activeTab === 'contacts' && (
                <div>
                  {contacts.length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center">No contacts at this company</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Name</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Email</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Lead Status</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contacts.map(contact => (
                            <tr key={contact.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <Link href={`/contacts/${contact.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                                  {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
                                </Link>
                              </td>
                              <td className="px-3 py-2 text-slate-600">{contact.email}</td>
                              <td className="px-3 py-2"><LeadStatusBadge status={contact.lead_status} /></td>
                              <td className="px-3 py-2 text-slate-500">{format(new Date(contact.created_at), 'MMM d, yyyy')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'deals' && (
                <div>
                  {deals.length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center">No deals for this company</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Name</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Amount</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Stage</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Expected Close</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deals.map(deal => (
                            <tr key={deal.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-900">{deal.name}</td>
                              <td className="px-3 py-2 text-slate-600">{deal.amount ? `$${deal.amount.toLocaleString()}` : '—'}</td>
                              <td className="px-3 py-2"><DealStageBadge stage={deal.stage} /></td>
                              <td className="px-3 py-2 text-slate-500">
                                {deal.expected_close_date ? format(new Date(deal.expected_close_date), 'MMM d, yyyy') : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'activity' && (
                <div>
                  {activities.length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center">No activity</p>
                  ) : (
                    <div className="space-y-0">
                      {activities.map(activity => (
                        <div key={activity.id} className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900">
                              {activity.subject || activity.type.replace(/_/g, ' ')}
                            </p>
                            {activity.description && (
                              <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{activity.description}</p>
                            )}
                            <p className="text-xs text-slate-400 mt-1">
                              {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'subscriptions' && (
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
                      {subscriptions.map(sub => (
                        <tr key={sub.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-900 font-mono text-xs">{sub.plan ?? '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                              sub.status === 'active'    ? 'bg-emerald-100 text-emerald-700' :
                              sub.status === 'trialing'  ? 'bg-amber-100 text-amber-700' :
                              sub.status === 'canceled'  ? 'bg-red-100 text-red-700' :
                                                            'bg-slate-100 text-slate-700'
                            }`}>{sub.status ?? '—'}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {sub.mrr_cents != null
                              ? (sub.mrr_cents / 100).toLocaleString(undefined, { style: 'currency', currency: sub.currency || 'EUR' })
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">
                            {sub.current_period_start && sub.current_period_end
                              ? `${format(new Date(sub.current_period_start), 'MMM d')} → ${format(new Date(sub.current_period_end), 'MMM d, yyyy')}`
                              : sub.trial_end
                                ? `trial until ${format(new Date(sub.trial_end), 'MMM d, yyyy')}`
                                : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-slate-500 truncate max-w-[160px]">{sub.stripe_subscription_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'usage' && (
                <div>
                  {(() => {
                    const totalDiagnostics = contacts.reduce((s, c) => s + (c.diagnostics_total ?? 0), 0)
                    const last30dDiagnostics = contacts.reduce((s, c) => s + (c.diagnostics_last_30d ?? 0), 0)
                    const lastActiveDates = contacts
                      .map(c => c.last_active_at ? new Date(c.last_active_at).getTime() : 0)
                      .filter(t => t > 0)
                    const mostRecentActive = lastActiveDates.length ? new Date(Math.max(...lastActiveDates)) : null
                    return (
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-slate-50 rounded-md p-3">
                          <div className="text-2xl font-semibold text-slate-900 leading-none">{totalDiagnostics.toLocaleString()}</div>
                          <div className="text-[11px] text-slate-500 mt-1">Total diagnostics</div>
                        </div>
                        <div className="bg-slate-50 rounded-md p-3">
                          <div className="text-2xl font-semibold text-slate-900 leading-none">{last30dDiagnostics.toLocaleString()}</div>
                          <div className="text-[11px] text-slate-500 mt-1">Last 30 days</div>
                        </div>
                        <div className="bg-slate-50 rounded-md p-3">
                          <div className="text-sm font-semibold text-slate-900 leading-tight">
                            {mostRecentActive ? formatDistanceToNow(mostRecentActive, { addSuffix: true }) : 'never'}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">Last team activity</div>
                        </div>
                      </div>
                    )
                  })()}
                  <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Recent events</h4>
                  {usageEvents.length === 0 ? (
                    <p className="text-sm text-slate-400 py-4 text-center">No usage events yet</p>
                  ) : (
                    <div className="space-y-1">
                      {usageEvents.slice(0, 20).map(ev => (
                        <div key={ev.id} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
                          <ActivityIcon className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-900 capitalize">{ev.event_type.replace(/_/g, ' ')}</div>
                            {ev.metadata && Object.keys(ev.metadata as object).length > 0 && (
                              <div className="text-[11px] text-slate-500 font-mono truncate">{JSON.stringify(ev.metadata)}</div>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 whitespace-nowrap">{formatDistanceToNow(new Date(ev.event_at), { addSuffix: true })}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Company">
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete <strong>{company.name}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </Modal>
    </div>
  );
}

function EditableField({
  label, value, isEditing, onEdit, editValue, onEditValueChange, onSave, onCancel, type = 'text'
}: {
  label: string; value: string; isEditing: boolean;
  onEdit: () => void; editValue: string; onEditValueChange: (v: string) => void;
  onSave: () => void; onCancel: () => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {isEditing ? (
        <input
          type={type}
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={onSave}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
          autoFocus
          className="w-full text-sm px-2 py-1.5 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      ) : (
        <p
          onClick={onEdit}
          className="text-sm text-slate-900 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-slate-200"
        >
          {value || <span className="text-slate-400">—</span>}
        </p>
      )}
    </div>
  );
}

function SocialLinkField({
  label, value, isEditing, onEdit, editValue, onEditValueChange, onSave, onCancel
}: {
  label: string; value: string; isEditing: boolean;
  onEdit: () => void; editValue: string; onEditValueChange: (v: string) => void;
  onSave: () => void; onCancel: () => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {isEditing ? (
        <input
          type="url"
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={onSave}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
          autoFocus
          placeholder="https://..."
          className="w-full text-sm px-2 py-1.5 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      ) : value ? (
        <div className="flex items-center gap-1 px-2 py-1.5">
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 truncate"
          >
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">View</span>
          </a>
          <button
            onClick={onEdit}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600"
          >
            Edit
          </button>
        </div>
      ) : (
        <p
          onClick={onEdit}
          className="text-sm text-slate-400 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-slate-200"
        >
          —
        </p>
      )}
    </div>
  );
}
