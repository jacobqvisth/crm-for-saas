'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trash2, Plus, Loader2, X } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { LeadStatusBadge, DealStageBadge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import toast from 'react-hot-toast';
import type { Tables, Json } from '@/lib/database.types';

type Company = Tables<'companies'>;
type Contact = Tables<'contacts'>;
type Activity = Tables<'activities'>;

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing',
  'Retail', 'Real Estate', 'Media', 'Consulting', 'Legal', 'Other',
];

export function CompanyDetailClient({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<{ id: string; name: string; amount: number | null; stage: string; owner_id: string | null; expected_close_date: string | null }[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activeTab, setActiveTab] = useState<'contacts' | 'deals' | 'activity'>('contacts');
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
            <div className="flex border-b border-slate-200">
              {(['contacts', 'deals', 'activity'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-3 text-sm font-medium capitalize ${
                    activeTab === tab
                      ? 'text-indigo-600 border-b-2 border-indigo-600'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab} {tab === 'contacts' ? `(${contacts.length})` : tab === 'deals' ? `(${deals.length})` : ''}
                </button>
              ))}
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
