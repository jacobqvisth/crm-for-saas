'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Mail, MailOpen, Eye, MousePointerClick, FileText, Phone, Calendar, UserPlus, ArrowRight,
  Trash2, Plus, ChevronDown, Loader2
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { LeadStatusBadge, ContactStatusBadge, DealStageBadge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { EnrollInSequenceModal } from '@/components/contacts/enroll-in-sequence-modal';
import toast from 'react-hot-toast';
import type { Tables, Json } from '@/lib/database.types';

type Contact = Tables<'contacts'>;
type Activity = Tables<'activities'>;
type Company = Tables<'companies'>;

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'customer', 'churned'] as const;
const CONTACT_STATUSES = ['active', 'bounced', 'unsubscribed', 'archived'] as const;

const activityIcons: Record<string, React.ReactNode> = {
  email_sent: <Mail className="w-4 h-4 text-blue-500" />,
  email_received: <MailOpen className="w-4 h-4 text-green-500" />,
  email_opened: <Eye className="w-4 h-4 text-purple-500" />,
  email_clicked: <MousePointerClick className="w-4 h-4 text-orange-500" />,
  note: <FileText className="w-4 h-4 text-slate-500" />,
  call: <Phone className="w-4 h-4 text-teal-500" />,
  meeting: <Calendar className="w-4 h-4 text-indigo-500" />,
  contact_created: <UserPlus className="w-4 h-4 text-green-500" />,
  deal_stage_change: <ArrowRight className="w-4 h-4 text-yellow-500" />,
  task: <FileText className="w-4 h-4 text-slate-400" />,
};

function getActivityTitle(activity: Activity): string {
  switch (activity.type) {
    case 'email_sent': return `Email sent: ${activity.subject || 'No subject'}`;
    case 'email_received': return `Reply received: ${activity.subject || 'No subject'}`;
    case 'email_opened': return `Opened: ${activity.subject || 'No subject'}`;
    case 'email_clicked': return `Clicked link in: ${activity.subject || 'No subject'}`;
    case 'note': return 'Note';
    case 'call': return 'Call logged';
    case 'meeting': return `Meeting: ${activity.subject || ''}`;
    case 'contact_created': return 'Contact created';
    case 'deal_stage_change': return `Deal moved to ${(activity.metadata as Record<string, string>)?.stage || 'new stage'}`;
    default: return activity.subject || activity.type;
  }
}

export function ContactDetailClient({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [contact, setContact] = useState<Contact | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [hasMoreActivities, setHasMoreActivities] = useState(false);
  const [activitiesPage, setActivitiesPage] = useState(0);
  const [deals, setDeals] = useState<{ id: string; name: string; amount: number | null; stage: string }[]>([]);
  const [contactLists, setContactLists] = useState<{ id: string; name: string }[]>([]);
  const [sequences, setSequences] = useState<{ id: string; name: string; status: string; current_step: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEnrollInSequence, setShowEnrollInSequence] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showLogCall, setShowLogCall] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [callSubject, setCallSubject] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  const fetchActivities = useCallback(async (pageNum: number) => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from('activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .range(pageNum * 20, (pageNum + 1) * 20 - 1);

    if (data) {
      if (pageNum === 0) setActivities(data);
      else setActivities(prev => [...prev, ...data]);
      setHasMoreActivities(data.length === 20);
    }
  }, [workspaceId, contactId, supabase]);

  useEffect(() => {
    if (!workspaceId) return;

    async function load() {
      setLoading(true);

      // Fetch contact
      const { data: contactData } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .eq('workspace_id', workspaceId!)
        .single();

      if (!contactData) {
        toast.error('Contact not found');
        router.push('/contacts');
        return;
      }
      setContact(contactData);
      setCustomFields((contactData.custom_fields as Record<string, string>) || {});

      // Fetch company if linked
      if (contactData.company_id) {
        const { data: companyData } = await supabase
          .from('companies')
          .select('*')
          .eq('id', contactData.company_id)
          .single();
        if (companyData) setCompany(companyData);
      }

      // Fetch all companies for dropdown
      const { data: allCompanies } = await supabase
        .from('companies')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .order('name');
      if (allCompanies) setCompanies(allCompanies);

      // Fetch activities
      await fetchActivities(0);

      // Fetch deals via junction table
      const { data: dealContacts } = await supabase
        .from('deal_contacts')
        .select('deal_id')
        .eq('contact_id', contactId);
      if (dealContacts && dealContacts.length > 0) {
        const dealIds = dealContacts.map(dc => dc.deal_id);
        const { data: dealsData } = await supabase
          .from('deals')
          .select('id, name, amount, stage')
          .in('id', dealIds);
        if (dealsData) setDeals(dealsData);
      }

      // Fetch lists
      const { data: listMembers } = await supabase
        .from('contact_list_members')
        .select('list_id')
        .eq('contact_id', contactId);
      if (listMembers && listMembers.length > 0) {
        const listIds = listMembers.map(lm => lm.list_id);
        const { data: listsData } = await supabase
          .from('contact_lists')
          .select('id, name')
          .in('id', listIds);
        if (listsData) setContactLists(listsData);
      }

      // Fetch sequences
      const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('sequence_id, status, current_step')
        .eq('contact_id', contactId)
        .eq('workspace_id', workspaceId!);
      if (enrollments && enrollments.length > 0) {
        const seqIds = enrollments.map(e => e.sequence_id);
        const { data: seqData } = await supabase
          .from('sequences')
          .select('id, name')
          .in('id', seqIds);
        if (seqData) {
          setSequences(enrollments.map(e => {
            const seq = seqData.find(s => s.id === e.sequence_id);
            return {
              id: e.sequence_id,
              name: seq?.name || 'Unknown',
              status: e.status,
              current_step: e.current_step,
            };
          }));
        }
      }

      setLoading(false);
    }

    load();

    // Real-time subscription for new activities
    const channel = supabase
      .channel(`activities-${contactId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activities', filter: `contact_id=eq.${contactId}` },
        (payload) => {
          setActivities(prev => [payload.new as Activity, ...prev]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, contactId]);

  const updateField = async (field: string, value: string | null) => {
    if (!contact || !workspaceId) return;
    const { error } = await supabase
      .from('contacts')
      .update({ [field]: value } as Record<string, unknown>)
      .eq('id', contact.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to update');
    else {
      setContact(prev => prev ? { ...prev, [field]: value } : null);
      toast.success('Updated');
    }
    setEditField(null);
  };

  const updateCustomFields = async (fields: Record<string, string>) => {
    if (!contact || !workspaceId) return;
    const { error } = await supabase
      .from('contacts')
      .update({ custom_fields: fields as unknown as Json })
      .eq('id', contact.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to update');
    else {
      setContact(prev => prev ? { ...prev, custom_fields: fields as unknown as Json } : null);
      setCustomFields(fields);
    }
  };

  const handleDelete = async () => {
    if (!contact || !workspaceId) return;
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contact.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to delete');
    else {
      toast.success('Contact deleted');
      router.push('/contacts');
    }
  };

  const addNote = async () => {
    if (!workspaceId || !noteText.trim()) return;
    await supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'note',
      contact_id: contactId,
      description: noteText.trim(),
    });
    setNoteText('');
    setShowAddNote(false);
    toast.success('Note added');
  };

  const logCall = async () => {
    if (!workspaceId) return;
    await supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'call',
      contact_id: contactId,
      subject: callSubject.trim() || 'Phone call',
      description: callNotes.trim() || null,
    });
    setCallSubject('');
    setCallNotes('');
    setShowLogCall(false);
    toast.success('Call logged');
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!contact) return null;

  const initials = [contact.first_name?.[0], contact.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed Contact';

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href="/contacts" className="text-sm text-indigo-600 hover:text-indigo-700">
          &larr; Back to Contacts
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Contact Info */}
        <div className="w-full lg:w-[300px] flex-shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            {/* Avatar & Name */}
            <div className="flex flex-col items-center mb-6">
              <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl font-bold mb-3">
                {initials}
              </div>
              <h2 className="text-lg font-bold text-slate-900 text-center">{fullName}</h2>
              <p className="text-sm text-slate-500">{contact.email}</p>
            </div>

            {/* Editable Fields */}
            <div className="space-y-3">
              <EditableField
                label="First Name"
                value={contact.first_name || ''}
                isEditing={editField === 'first_name'}
                onEdit={() => { setEditField('first_name'); setEditValue(contact.first_name || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('first_name', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Last Name"
                value={contact.last_name || ''}
                isEditing={editField === 'last_name'}
                onEdit={() => { setEditField('last_name'); setEditValue(contact.last_name || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('last_name', editValue || null)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Email"
                value={contact.email}
                isEditing={editField === 'email'}
                onEdit={() => { setEditField('email'); setEditValue(contact.email); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('email', editValue)}
                onCancel={() => setEditField(null)}
              />
              <EditableField
                label="Phone"
                value={contact.phone || ''}
                isEditing={editField === 'phone'}
                onEdit={() => { setEditField('phone'); setEditValue(contact.phone || ''); }}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSave={() => updateField('phone', editValue || null)}
                onCancel={() => setEditField(null)}
              />

              {/* Company dropdown */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Company</label>
                <select
                  value={contact.company_id || ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    updateField('company_id', val);
                    if (val) {
                      const c = companies.find(c => c.id === val);
                      if (c) setCompany(c);
                    } else setCompany(null);
                  }}
                  className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">No company</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Lead Status */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Lead Status</label>
                <select
                  value={contact.lead_status}
                  onChange={(e) => updateField('lead_status', e.target.value)}
                  className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {LEAD_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                <select
                  value={contact.status}
                  onChange={(e) => updateField('status', e.target.value)}
                  className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {CONTACT_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
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

            {/* Delete */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              Delete contact
            </button>
          </div>
        </div>

        {/* Center Column: Activity Timeline */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Activity</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddNote(!showAddNote)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Add Note
                </button>
                <button
                  onClick={() => setShowLogCall(!showLogCall)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Log Call
                </button>
              </div>
            </div>

            {/* Inline Note Form */}
            {showAddNote && (
              <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write a note..."
                  rows={3}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowAddNote(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
                  <button onClick={addNote} className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">Save Note</button>
                </div>
              </div>
            )}

            {/* Inline Call Form */}
            {showLogCall && (
              <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <input
                  type="text"
                  value={callSubject}
                  onChange={(e) => setCallSubject(e.target.value)}
                  placeholder="Call subject"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                />
                <textarea
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  placeholder="Notes..."
                  rows={2}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowLogCall(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
                  <button onClick={logCall} className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">Log Call</button>
                </div>
              </div>
            )}

            {/* Timeline */}
            {activities.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No activity yet</p>
            ) : (
              <div className="space-y-0">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
                    <div className="mt-0.5 flex-shrink-0">
                      {activityIcons[activity.type] || <FileText className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{getActivityTitle(activity)}</p>
                      {activity.description && (
                        <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{activity.description}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-1">
                        {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
                {hasMoreActivities && (
                  <button
                    onClick={() => {
                      const nextPage = activitiesPage + 1;
                      setActivitiesPage(nextPage);
                      fetchActivities(nextPage);
                    }}
                    className="w-full py-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Load more
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Associations */}
        <div className="w-full lg:w-[280px] flex-shrink-0 space-y-4">
          {/* Company */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Company</h3>
            {company ? (
              <Link href={`/companies/${company.id}`} className="block hover:bg-slate-50 rounded-lg p-2 -m-2">
                <p className="text-sm font-medium text-slate-900">{company.name}</p>
                {company.domain && <p className="text-xs text-slate-500">{company.domain}</p>}
                {company.industry && <p className="text-xs text-slate-400 mt-0.5">{company.industry}</p>}
              </Link>
            ) : (
              <p className="text-sm text-slate-400">No company linked</p>
            )}
          </div>

          {/* Deals */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Deals</h3>
            {deals.length === 0 ? (
              <p className="text-sm text-slate-400">No deals</p>
            ) : (
              <div className="space-y-2">
                {deals.map(deal => (
                  <div key={deal.id} className="p-2 rounded-lg bg-slate-50">
                    <p className="text-sm font-medium text-slate-900">{deal.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {deal.amount && <span className="text-xs text-slate-600">${deal.amount.toLocaleString()}</span>}
                      <DealStageBadge stage={deal.stage} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lists */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Lists</h3>
            {contactLists.length === 0 ? (
              <p className="text-sm text-slate-400">Not in any lists</p>
            ) : (
              <div className="space-y-1">
                {contactLists.map(list => (
                  <div key={list.id} className="text-sm text-slate-700 py-1">{list.name}</div>
                ))}
              </div>
            )}
          </div>

          {/* Sequences */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Sequences</h3>
              <button
                onClick={() => setShowEnrollInSequence(true)}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>
            {sequences.length === 0 ? (
              <p className="text-sm text-slate-400">Not enrolled in any sequences</p>
            ) : (
              <div className="space-y-2">
                {sequences.map(seq => (
                  <div key={seq.id} className="p-2 rounded-lg bg-slate-50">
                    <p className="text-sm font-medium text-slate-900">{seq.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">Step {seq.current_step}</span>
                      <ContactStatusBadge status={seq.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Enroll in Sequence Modal */}
      <EnrollInSequenceModal
        open={showEnrollInSequence}
        onClose={() => setShowEnrollInSequence(false)}
        contactId={contactId}
        contactEmail={contact.email}
        onEnrolled={() => {
          // Reload sequences section
          if (!workspaceId) return;
          (async () => {
            const { data: enrollments } = await supabase
              .from('sequence_enrollments')
              .select('sequence_id, status, current_step')
              .eq('contact_id', contactId)
              .eq('workspace_id', workspaceId);
            if (enrollments && enrollments.length > 0) {
              const seqIds = enrollments.map(e => e.sequence_id);
              const { data: seqData } = await supabase
                .from('sequences')
                .select('id, name')
                .in('id', seqIds);
              if (seqData) {
                setSequences(enrollments.map(e => {
                  const seq = seqData.find(s => s.id === e.sequence_id);
                  return { id: e.sequence_id, name: seq?.name || 'Unknown', status: e.status, current_step: e.current_step };
                }));
              }
            }
          })();
        }}
      />

      {/* Delete Modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Contact">
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete <strong>{fullName}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </Modal>
    </div>
  );
}

// Inline editable field component
function EditableField({
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
          type="text"
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

// Need to import X for custom fields delete button
import { X } from 'lucide-react';
