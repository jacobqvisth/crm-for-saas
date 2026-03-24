'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Plus, Copy, Trash2, Users, Filter, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { Modal } from '@/components/ui/modal';
import { FilterBuilder } from './filter-builder';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';
import type { ListFilter } from '@/lib/lists/filter-query';

type ContactList = Tables<'contact_lists'> & { contact_count?: number };

export function ListTable() {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDelete, setShowDelete] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  // Create form state
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createType, setCreateType] = useState<'static' | 'dynamic'>('static');
  const [createFilters, setCreateFilters] = useState<ListFilter[]>([]);
  const [creating, setCreating] = useState(false);

  const fetchLists = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('contact_lists')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load lists');
      setLoading(false);
      return;
    }

    // Get member counts for static lists
    const listsWithCounts: ContactList[] = [];
    for (const list of data || []) {
      if (list.type === 'dynamic') {
        listsWithCounts.push({ ...list, contact_count: undefined });
      } else {
        const { count } = await supabase
          .from('contact_list_members')
          .select('*', { count: 'exact', head: true })
          .eq('list_id', list.id);
        listsWithCounts.push({ ...list, contact_count: count || 0 });
      }
    }

    setLists(listsWithCounts);
    setLoading(false);
  }, [workspaceId, supabase]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  // Close action menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredLists = lists.filter(l =>
    !search || l.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!workspaceId || !createName.trim()) return;
    setCreating(true);

    const { data, error } = await supabase
      .from('contact_lists')
      .insert({
        workspace_id: workspaceId,
        name: createName.trim(),
        description: createDesc.trim() || null,
        type: createType,
        filters: createType === 'dynamic' ? (createFilters as unknown as Tables<'contact_lists'>['filters']) : null,
      })
      .select('id')
      .single();

    if (error) {
      toast.error('Failed to create list');
      setCreating(false);
      return;
    }

    toast.success('List created');
    setShowCreate(false);
    setCreateName('');
    setCreateDesc('');
    setCreateType('static');
    setCreateFilters([]);
    setCreating(false);
    router.push(`/lists/${data.id}`);
  };

  const handleDuplicate = async (list: ContactList) => {
    if (!workspaceId) return;
    setActionMenuId(null);

    const { data, error } = await supabase
      .from('contact_lists')
      .insert({
        workspace_id: workspaceId,
        name: `${list.name} (copy)`,
        description: list.description,
        type: list.type,
        filters: list.filters,
      })
      .select('id')
      .single();

    if (error) {
      toast.error('Failed to duplicate list');
      return;
    }

    // For static lists, copy members
    if (list.type === 'static') {
      const { data: members } = await supabase
        .from('contact_list_members')
        .select('contact_id')
        .eq('list_id', list.id);

      if (members && members.length > 0) {
        await supabase.from('contact_list_members').insert(
          members.map(m => ({ list_id: data.id, contact_id: m.contact_id }))
        );
      }
    }

    toast.success('List duplicated');
    fetchLists();
  };

  const handleDelete = async (listId: string) => {
    const { error } = await supabase.from('contact_lists').delete().eq('id', listId);
    if (error) {
      toast.error('Failed to delete list');
    } else {
      toast.success('List deleted');
      setLists(prev => prev.filter(l => l.id !== listId));
    }
    setShowDelete(null);
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lists</h1>
          <p className="text-sm text-slate-500 mt-1">Create static and dynamic contact lists for targeted outreach</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          Create List
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search lists..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Description</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Contacts</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
                <th className="w-12 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-slate-200 rounded-full" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-48 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-12 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"></td>
                  </tr>
                ))
              ) : filteredLists.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">{search ? 'No lists match your search' : 'No lists yet'}</p>
                    <p className="text-slate-400 text-sm mt-1">Create your first contact list</p>
                    {!search && (
                      <button
                        onClick={() => setShowCreate(true)}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                      >
                        <Plus className="w-4 h-4" />
                        Create List
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredLists.map((list, i) => (
                  <tr
                    key={list.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}
                    onClick={() => router.push(`/lists/${list.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900">{list.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        list.type === 'dynamic'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {list.type === 'dynamic' ? <Filter className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                        {list.type === 'dynamic' ? 'Dynamic' : 'Static'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                      {list.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {list.type === 'dynamic' ? '—' : (list.contact_count ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {format(new Date(list.created_at), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="relative" ref={actionMenuId === list.id ? actionMenuRef : undefined}>
                        <button
                          onClick={() => setActionMenuId(actionMenuId === list.id ? null : list.id)}
                          className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {actionMenuId === list.id && (
                          <div className="absolute right-0 top-8 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-36">
                            <button
                              onClick={() => handleDuplicate(list)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <Copy className="w-4 h-4" />
                              Duplicate
                            </button>
                            <button
                              onClick={() => { setShowDelete(list.id); setActionMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create List Modal */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreateName(''); setCreateDesc(''); setCreateType('static'); setCreateFilters([]); }}
        title="Create List"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Hot Leads Q1"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder="Optional description..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setCreateType('static')}
                className={`flex-1 px-4 py-3 rounded-lg border text-sm text-left ${
                  createType === 'static'
                    ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-slate-900">
                  <Users className="w-4 h-4" />
                  Static
                </div>
                <p className="text-xs text-slate-500 mt-1">Manually add contacts</p>
              </button>
              <button
                onClick={() => setCreateType('dynamic')}
                className={`flex-1 px-4 py-3 rounded-lg border text-sm text-left ${
                  createType === 'dynamic'
                    ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-slate-900">
                  <Filter className="w-4 h-4" />
                  Dynamic
                </div>
                <p className="text-xs text-slate-500 mt-1">Auto-populate with filters</p>
              </button>
            </div>
          </div>

          {createType === 'dynamic' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Filters</label>
              <div className="border border-slate-200 rounded-lg p-3">
                <FilterBuilder filters={createFilters} onChange={setCreateFilters} />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => { setShowCreate(false); setCreateName(''); setCreateDesc(''); setCreateType('static'); setCreateFilters([]); }}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create List'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        open={!!showDelete}
        onClose={() => setShowDelete(null)}
        title="Delete List"
      >
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete this list? This will not delete the contacts, only the list itself.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowDelete(null)}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => showDelete && handleDelete(showDelete)}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
