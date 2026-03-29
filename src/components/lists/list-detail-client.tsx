'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Users, Filter, Pencil, Trash2, Plus, Send, ChevronLeft, ChevronRight, Check, X,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { Modal } from '@/components/ui/modal';
import { LeadStatusBadge } from '@/components/ui/badge';
import { FilterBuilder } from './filter-builder';
import { AddContactsModal } from './add-contacts-modal';
import { EnrollListModal } from './enroll-list-modal';
import { ExportCsvButton } from './export-csv-button';
import { buildFilterQuery, describeFilter, type ListFilter } from '@/lib/lists/filter-query';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';

type Contact = Tables<'contacts'> & { company_name?: string | null; added_at?: string };

const PAGE_SIZE = 50;

interface ListDetailClientProps {
  listId: string;
}

export function ListDetailClient({ listId }: ListDetailClientProps) {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [list, setList] = useState<Tables<'contact_lists'> | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [companies, setCompanies] = useState<Map<string, string>>(new Map());

  // Modals
  const [showAddContacts, setShowAddContacts] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showEditFilters, setShowEditFilters] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  // Editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descInput, setDescInput] = useState('');
  const [editFilters, setEditFilters] = useState<ListFilter[]>([]);

  const isDynamic = list?.is_dynamic === true;
  const filters = useMemo(
    () => (list?.filters as unknown as ListFilter[]) || [],
    [list?.filters],
  );

  // Load list
  useEffect(() => {
    if (!workspaceId) return;
    (async () => {
      const { data, error } = await supabase
        .from('contact_lists')
        .select('*')
        .eq('id', listId)
        .eq('workspace_id', workspaceId)
        .single();

      if (error || !data) {
        toast.error('List not found');
        router.push('/lists');
        return;
      }
      setList(data);
      setNameInput(data.name);
      setDescInput(data.description || '');
      setLoading(false);
    })();
  }, [workspaceId, listId, supabase, router]);

  // Load contacts
  const fetchContacts = useCallback(async () => {
    if (!workspaceId || !list) return;
    setContactsLoading(true);

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    if (isDynamic) {
      const { data, count, error } = await buildFilterQuery(
        supabase,
        workspaceId,
        filters,
        '*, companies(name)',
        { count: 'exact', range: [from, to] },
      );

      if (error) {
        toast.error('Failed to load contacts');
        setContactsLoading(false);
        return;
      }

      const mapped = (data || []).map((c: Record<string, unknown>) => ({
        ...c,
        company_name: (c.companies as { name: string } | null)?.name || null,
      })) as Contact[];

      setContacts(mapped);
      setTotalCount(count || 0);
    } else {
      const { data, count, error } = await supabase
        .from('contact_list_members')
        .select('added_at, contacts(*, companies(name))', { count: 'exact' })
        .eq('list_id', listId)
        .order('added_at', { ascending: false })
        .range(from, to);

      if (error) {
        toast.error('Failed to load contacts');
        setContactsLoading(false);
        return;
      }

      const mapped = (data || []).map((m: Record<string, unknown>) => {
        const c = m.contacts as Record<string, unknown>;
        return {
          ...c,
          company_name: (c.companies as { name: string } | null)?.name || null,
          added_at: m.added_at as string,
        };
      }) as Contact[];

      setContacts(mapped);
      setTotalCount(count || 0);
    }

    setSelectedIds(new Set());
    setContactsLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, list, page, listId, isDynamic, filters]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
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

  const handleSaveName = async () => {
    if (!nameInput.trim() || !list) return;
    const { error } = await supabase
      .from('contact_lists')
      .update({ name: nameInput.trim() })
      .eq('id', list.id);

    if (error) toast.error('Failed to update name');
    else {
      setList({ ...list, name: nameInput.trim() });
      toast.success('Name updated');
    }
    setEditingName(false);
  };

  const handleSaveDesc = async () => {
    if (!list) return;
    const { error } = await supabase
      .from('contact_lists')
      .update({ description: descInput.trim() || null })
      .eq('id', list.id);

    if (error) toast.error('Failed to update description');
    else {
      setList({ ...list, description: descInput.trim() || null });
      toast.success('Description updated');
    }
    setEditingDesc(false);
  };

  const handleSaveFilters = async () => {
    if (!list) return;
    const { error } = await supabase
      .from('contact_lists')
      .update({ filters: editFilters as unknown as Tables<'contact_lists'>['filters'] })
      .eq('id', list.id);

    if (error) toast.error('Failed to update filters');
    else {
      setList({ ...list, filters: editFilters as unknown as Tables<'contact_lists'>['filters'] });
      toast.success('Filters updated');
      setShowEditFilters(false);
      setPage(1);
    }
  };

  const handleRemoveFromList = async () => {
    if (selectedIds.size === 0) return;

    for (const contactId of selectedIds) {
      await supabase
        .from('contact_list_members')
        .delete()
        .eq('list_id', listId)
        .eq('contact_id', contactId);
    }

    toast.success(`Removed ${selectedIds.size} contacts from list`);
    setShowRemoveConfirm(false);
    fetchContacts();
  };

  const handleRemoveSingle = async (contactId: string) => {
    await supabase
      .from('contact_list_members')
      .delete()
      .eq('list_id', listId)
      .eq('contact_id', contactId);

    toast.success('Contact removed from list');
    fetchContacts();
  };

  const handleDeleteList = async () => {
    const { error } = await supabase.from('contact_lists').delete().eq('id', listId);
    if (error) toast.error('Failed to delete list');
    else {
      toast.success('List deleted');
      router.push('/lists');
    }
  };

  if (loading || !list) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-slate-200 rounded" />
          <div className="h-4 w-96 bg-slate-200 rounded" />
          <div className="h-64 bg-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Back */}
      <button
        onClick={() => router.push('/lists')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Lists
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="text-2xl font-bold text-slate-900 border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                />
                <button onClick={handleSaveName} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                <button onClick={() => { setEditingName(false); setNameInput(list.name); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <h1
                className="text-2xl font-bold text-slate-900 cursor-pointer hover:text-indigo-600 group"
                onClick={() => setEditingName(true)}
              >
                {list.name}
                <Pencil className="w-4 h-4 inline ml-2 opacity-0 group-hover:opacity-100 text-slate-400" />
              </h1>
            )}

            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              isDynamic ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isDynamic ? <Filter className="w-3 h-3" /> : <Users className="w-3 h-3" />}
              {isDynamic ? 'Dynamic' : 'Static'}
            </span>
          </div>

          {editingDesc ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                value={descInput}
                onChange={(e) => setDescInput(e.target.value)}
                placeholder="Add a description..."
                className="text-sm text-slate-500 border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-96"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDesc(); if (e.key === 'Escape') setEditingDesc(false); }}
              />
              <button onClick={handleSaveDesc} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setEditingDesc(false); setDescInput(list.description || ''); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <p
              className="text-sm text-slate-500 mt-1 cursor-pointer hover:text-slate-700"
              onClick={() => setEditingDesc(true)}
            >
              {list.description || 'Click to add description'}
            </p>
          )}

          <p className="text-sm text-slate-500 mt-2">
            {totalCount.toLocaleString()} contact{totalCount !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isDynamic ? (
            <button
              onClick={() => { setEditFilters(filters); setShowEditFilters(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Filter className="w-4 h-4" />
              Edit Filters
            </button>
          ) : (
            <button
              onClick={() => setShowAddContacts(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" />
              Add Contacts
            </button>
          )}

          <button
            onClick={() => setShowEnroll(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Send className="w-4 h-4" />
            Enroll in Sequence
          </button>

          <ExportCsvButton
            listId={listId}
            listName={list.name}
            isDynamic={isDynamic}
            filters={filters}
          />

          <button
            onClick={() => setShowDelete(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-slate-300 rounded-lg hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter summary for dynamic lists */}
      {isDynamic && filters.length > 0 && (
        <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <p className="text-xs font-medium text-purple-700 uppercase tracking-wider mb-1">Active Filters</p>
          <div className="flex flex-wrap gap-2">
            {filters.map((f, i) => (
              <span key={i} className="inline-flex items-center px-2 py-1 bg-white rounded text-xs text-purple-700 border border-purple-200">
                {describeFilter(f)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contacts Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {!isDynamic && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300"
                    />
                  </th>
                )}
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Company</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Lead Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">
                  {isDynamic ? 'Created' : 'Added'}
                </th>
                {!isDynamic && <th className="w-10 px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {contactsLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 animate-pulse">
                    {!isDynamic && <td className="px-4 py-3"><div className="h-4 w-4 bg-slate-200 rounded" /></td>}
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-40 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-slate-200 rounded-full" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-slate-200 rounded-full" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                    {!isDynamic && <td className="px-4 py-3"></td>}
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={isDynamic ? 7 : 8} className="px-4 py-16 text-center">
                    <p className="text-slate-500 font-medium">No contacts in this list</p>
                    <p className="text-slate-400 text-sm mt-1">
                      {isDynamic ? 'Adjust your filters to match contacts' : 'Add contacts to get started'}
                    </p>
                    {!isDynamic && (
                      <button
                        onClick={() => setShowAddContacts(true)}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                      >
                        <Plus className="w-4 h-4" />
                        Add Contacts
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                contacts.map((contact, i) => (
                  <tr
                    key={contact.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}
                  >
                    {!isDynamic && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleSelect(contact.id)}
                          className="rounded border-slate-300"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link href={`/contacts/${contact.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                        {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{contact.email}</td>
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
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        contact.status === 'active' ? 'bg-green-100 text-green-700' :
                        contact.status === 'bounced' ? 'bg-red-100 text-red-700' :
                        contact.status === 'unsubscribed' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {contact.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <LeadStatusBadge status={contact.lead_status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {isDynamic
                        ? format(new Date(contact.created_at), 'MMM d, yyyy')
                        : contact.added_at
                          ? format(new Date(contact.added_at), 'MMM d, yyyy')
                          : '—'
                      }
                    </td>
                    {!isDynamic && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleRemoveSingle(contact.id)}
                          className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                          title="Remove from list"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    )}
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
                onClick={() => setPage(p => p - 1)}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
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

      {/* Bulk action bar for static lists */}
      {!isDynamic && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">{selectedIds.size} contacts selected</span>
          <div className="h-5 w-px bg-slate-600" />
          <button
            onClick={() => setShowRemoveConfirm(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-600 rounded-lg hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4" />
            Remove from List
          </button>
        </div>
      )}

      {/* Add Contacts Modal */}
      <AddContactsModal
        open={showAddContacts}
        onClose={() => setShowAddContacts(false)}
        listId={listId}
        onAdded={fetchContacts}
      />

      {/* Enroll Modal */}
      <EnrollListModal
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        listId={listId}
        isDynamic={isDynamic}
        filters={filters}
        contactCount={totalCount}
      />

      {/* Edit Filters Modal */}
      <Modal
        open={showEditFilters}
        onClose={() => setShowEditFilters(false)}
        title="Edit Filters"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <FilterBuilder filters={editFilters} onChange={setEditFilters} />
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              onClick={() => setShowEditFilters(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveFilters}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              Save Filters
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete List">
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete &ldquo;{list.name}&rdquo;? This will not delete the contacts, only the list.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowDelete(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleDeleteList} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </Modal>

      {/* Remove from list confirmation */}
      <Modal open={showRemoveConfirm} onClose={() => setShowRemoveConfirm(false)} title="Remove from List">
        <p className="text-sm text-slate-600 mb-4">
          Remove {selectedIds.size} contact{selectedIds.size > 1 ? 's' : ''} from this list? The contacts will not be deleted.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setShowRemoveConfirm(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleRemoveFromList} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Remove</button>
        </div>
      </Modal>
    </div>
  );
}
