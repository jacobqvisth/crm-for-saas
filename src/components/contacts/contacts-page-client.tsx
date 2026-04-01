'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search, X, Plus, Upload, ChevronLeft, ChevronRight, Trash2, Tags, ListPlus, ShieldCheck } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { LeadStatusBadge } from '@/components/ui/badge';
import { SlideOver } from '@/components/ui/slide-over';
import { Modal } from '@/components/ui/modal';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';

type Contact = Tables<'contacts'> & { company_name?: string | null };

const PAGE_SIZE = 50;

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'customer', 'churned'] as const;
const CONTACT_STATUSES = ['active', 'bounced', 'unsubscribed', 'archived'] as const;

export function ContactsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Tables<'companies'>[]>([]);
  const [lists, setLists] = useState<Tables<'contact_lists'>[]>([]);

  // Table state from URL
  const page = Number(searchParams.get('page') || '1');
  const search = searchParams.get('search') || '';
  const leadStatusFilter = searchParams.get('lead_status') || '';
  const statusFilter = searchParams.get('status') || '';
  const companyFilter = searchParams.get('company_id') || '';

  // Local state
  const [searchInput, setSearchInput] = useState(search);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddContact, setShowAddContact] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [bulkLeadStatus, setBulkLeadStatus] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Update URL params
  const updateParams = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    // Reset page when filters change (unless page is being set)
    if (!('page' in updates)) params.set('page', '1');
    router.push(`/contacts?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchInput !== search) {
        updateParams({ search: searchInput });
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput, search, updateParams]);

  // Fetch contacts
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    async function fetchContacts() {
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('contacts')
        .select('*, companies(name)', { count: 'exact' })
        .eq('workspace_id', workspaceId!)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (leadStatusFilter) {
        query = query.eq('lead_status', leadStatusFilter as Contact['lead_status']);
      }
      if (statusFilter) {
        query = query.eq('status', statusFilter as Contact['status']);
      }
      if (companyFilter) {
        query = query.eq('company_id', companyFilter);
      }

      const { data, count, error } = await query;
      if (cancelled) return;
      if (error) {
        toast.error('Failed to load contacts');
        setLoading(false);
        return;
      }

      const mapped = (data || []).map((c: Record<string, unknown>) => ({
        ...c,
        company_name: (c.companies as { name: string } | null)?.name || null,
      })) as Contact[];

      setContacts(mapped);
      setTotalCount(count || 0);
      setSelectedIds(new Set());
      setLoading(false);
    }

    fetchContacts();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, page, search, leadStatusFilter, statusFilter, companyFilter]);

  // Fetch companies for filter dropdown
  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from('companies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => { if (data) setCompanies(data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch lists for bulk action
  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from('contact_lists')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => { if (data) setLists(data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasFilters = !!leadStatusFilter || !!statusFilter || !!companyFilter;
  const allSelected = contacts.length > 0 && selectedIds.size === contacts.length;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(contacts.map(c => c.id)));
  };

  // Bulk actions
  const handleBulkLeadStatusChange = async (newStatus: string) => {
    if (!workspaceId || selectedIds.size === 0) return;
    const { error } = await supabase
      .from('contacts')
      .update({ lead_status: newStatus as Contact['lead_status'] })
      .in('id', Array.from(selectedIds))
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to update contacts');
    else {
      toast.success(`Updated ${selectedIds.size} contacts`);
      setContacts(prev => prev.map(c => selectedIds.has(c.id) ? { ...c, lead_status: newStatus as Contact['lead_status'] } : c));
      setSelectedIds(new Set());
      setBulkLeadStatus('');
    }
  };

  const handleBulkDelete = async () => {
    if (!workspaceId || selectedIds.size === 0) return;
    const { error } = await supabase
      .from('contacts')
      .delete()
      .in('id', Array.from(selectedIds))
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to delete contacts');
    else {
      toast.success(`Deleted ${selectedIds.size} contacts`);
      setContacts(prev => prev.filter(c => !selectedIds.has(c.id)));
      setTotalCount(prev => prev - selectedIds.size);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    }
  };

  const handleBulkVerify = async () => {
    if (!workspaceId || selectedIds.size === 0) return;
    setVerifying(true);
    try {
      const res = await fetch('/api/contacts/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: Array.from(selectedIds), workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Verification failed');
        return;
      }
      const { verified, skipped, errors } = data;
      toast.success(
        `Verified ${verified}, skipped ${skipped} (cached)${errors > 0 ? `, ${errors} errors` : ''}`
      );
      router.refresh();
      setSelectedIds(new Set());
      setShowVerifyConfirm(false);
    } catch {
      toast.error('Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleBulkAddToList = async (listId: string) => {
    if (!workspaceId || selectedIds.size === 0) return;
    const rows = Array.from(selectedIds).map(contactId => ({
      list_id: listId,
      contact_id: contactId,
    }));
    const { error } = await supabase.from('contact_list_members').upsert(rows, { onConflict: 'list_id,contact_id' });
    if (error) toast.error('Failed to add to list');
    else {
      toast.success(`Added ${selectedIds.size} contacts to list`);
      setShowAddToList(false);
      setSelectedIds(new Set());
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
          <p className="text-sm text-slate-500 mt-1">Manage your contacts and track engagement</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/contacts/import"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </Link>
          <button
            onClick={() => setShowAddContact(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); updateParams({ search: '' }); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={leadStatusFilter}
          onChange={(e) => updateParams({ lead_status: e.target.value })}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Lead Statuses</option>
          {LEAD_STATUSES.map(s => (
            <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => updateParams({ status: e.target.value })}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          {CONTACT_STATUSES.map(s => (
            <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        <select
          value={companyFilter}
          onChange={(e) => updateParams({ company_id: e.target.value })}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Companies</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => updateParams({ lead_status: '', status: '', company_id: '' })}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Title</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Company</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Lead Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Last Contacted</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 w-4 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-40 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-28 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-slate-200 rounded-full" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <p className="text-slate-500 font-medium">No contacts yet</p>
                    <p className="text-slate-400 text-sm mt-1">Add your first contact or import from CSV</p>
                    <button
                      onClick={() => setShowAddContact(true)}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                    >
                      <Plus className="w-4 h-4" />
                      Add Contact
                    </button>
                  </td>
                </tr>
              ) : (
                contacts.map((contact, i) => (
                  <tr
                    key={contact.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(contact.id)}
                        onChange={() => toggleSelect(contact.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/contacts/${contact.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                        {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{contact.email}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 max-w-[160px] truncate">
                      {contact.title || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {contact.company_id && contact.company_name ? (
                        <Link href={`/companies/${contact.company_id}`} className="text-indigo-600 hover:text-indigo-700">
                          {contact.company_name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <LeadStatusBadge status={contact.lead_status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {contact.last_contacted_at
                        ? formatDistanceToNow(new Date(contact.last_contacted_at), { addSuffix: true })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {format(new Date(contact.created_at), 'MMM d, yyyy')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-sm text-slate-600">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateParams({ page: String(page - 1) })}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => updateParams({ page: String(page + 1) })}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">{selectedIds.size} contacts selected</span>
          <div className="h-5 w-px bg-slate-600" />
          <select
            value={bulkLeadStatus}
            onChange={(e) => {
              if (e.target.value) handleBulkLeadStatusChange(e.target.value);
            }}
            className="text-sm bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white"
          >
            <option value="">Change Lead Status</option>
            {LEAD_STATUSES.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddToList(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg hover:bg-slate-700"
          >
            <ListPlus className="w-4 h-4" />
            Add to List
          </button>
          <button
            onClick={() => setShowVerifyConfirm(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg hover:bg-slate-700"
          >
            <ShieldCheck className="w-4 h-4" />
            Verify Emails
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-600 rounded-lg hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}

      {/* Add Contact Slide-Over */}
      <SlideOver open={showAddContact} onClose={() => setShowAddContact(false)} title="Add Contact">
        <AddContactForm
          workspaceId={workspaceId}
          companies={companies}
          onSuccess={() => {
            setShowAddContact(false);
            router.refresh();
            // Re-fetch contacts
            updateParams({});
          }}
        />
      </SlideOver>

      {/* Delete Confirmation Modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Contacts">
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete {selectedIds.size} contact{selectedIds.size > 1 ? 's' : ''}? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </Modal>

      {/* Verify Emails Modal */}
      <Modal open={showVerifyConfirm} onClose={() => setShowVerifyConfirm(false)} title="Verify Email Addresses">
        <p className="text-sm text-slate-600 mb-4">
          This will verify {selectedIds.size} email address{selectedIds.size !== 1 ? 'es' : ''} using Prospeo (1 credit each). Already-verified contacts will be skipped.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowVerifyConfirm(false)}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleBulkVerify}
            disabled={verifying}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {verifying && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            {verifying ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      </Modal>

      {/* Add to List Modal */}
      <Modal open={showAddToList} onClose={() => setShowAddToList(false)} title="Add to List">
        {lists.length === 0 ? (
          <p className="text-sm text-slate-500">No lists yet. Create a list first.</p>
        ) : (
          <div className="space-y-2">
            {lists.map(list => (
              <button
                key={list.id}
                onClick={() => handleBulkAddToList(list.id)}
                className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm"
              >
                <span className="font-medium text-slate-900">{list.name}</span>
                {list.description && <p className="text-slate-500 text-xs mt-0.5">{list.description}</p>}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// Add Contact Form
function AddContactForm({
  workspaceId,
  companies,
  onSuccess,
}: {
  workspaceId: string | null;
  companies: Tables<'companies'>[];
  onSuccess: () => void;
}) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company_id: '',
    lead_status: 'new' as const,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    const newErrors: Record<string, string> = {};
    if (!form.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = 'Invalid email format';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        workspace_id: workspaceId,
        email: form.email.trim(),
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        phone: form.phone.trim() || null,
        company_id: form.company_id || null,
        lead_status: form.lead_status,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') toast.error('A contact with this email already exists');
      else toast.error('Failed to create contact');
      setSaving(false);
      return;
    }

    // Create activity
    await supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'contact_created',
      contact_id: data.id,
      subject: 'Contact created',
    });

    toast.success('Contact created');
    setSaving(false);
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm(f => ({ ...f, first_name: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm(f => ({ ...f, last_name: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => { setForm(f => ({ ...f, email: e.target.value })); setErrors({}); }}
          className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.email ? 'border-red-300' : 'border-slate-300'}`}
        />
        {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
        <input
          type="text"
          value={form.phone}
          onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
        <select
          value={form.company_id}
          onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">No company</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Lead Status</label>
        <select
          value={form.lead_status}
          onChange={(e) => setForm(f => ({ ...f, lead_status: e.target.value as typeof form.lead_status }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {LEAD_STATUSES.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>
      <div className="pt-4 border-t border-slate-200">
        <button
          type="submit"
          disabled={saving}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Contact'}
        </button>
      </div>
    </form>
  );
}
