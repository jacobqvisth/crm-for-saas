'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { Modal } from '@/components/ui/modal';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';

type Contact = Tables<'contacts'>;

interface AddContactsModalProps {
  open: boolean;
  onClose: () => void;
  listId: string;
  onAdded: () => void;
}

export function AddContactsModal({ open, onClose, listId, onAdded }: AddContactsModalProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const searchContacts = useCallback(async () => {
    if (!workspaceId || !search.trim()) {
      setContacts([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
      .limit(30);
    setContacts(data || []);
    setLoading(false);
  }, [workspaceId, search, supabase]);

  useEffect(() => {
    const timer = setTimeout(searchContacts, 300);
    return () => clearTimeout(timer);
  }, [searchContacts]);

  const toggleContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;
    setAdding(true);

    const rows = Array.from(selectedIds).map(contactId => ({
      list_id: listId,
      contact_id: contactId,
    }));

    const { error } = await supabase
      .from('contact_list_members')
      .upsert(rows, { onConflict: 'list_id,contact_id' });

    if (error) {
      toast.error('Failed to add contacts');
    } else {
      toast.success(`Added ${selectedIds.size} contacts to list`);
      onAdded();
      handleClose();
    }
    setAdding(false);
  };

  const handleClose = () => {
    setSearch('');
    setContacts([]);
    setSelectedIds(new Set());
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add Contacts to List" maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
        </div>

        <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">
              {search.trim() ? 'No contacts found' : 'Type to search contacts'}
            </div>
          ) : (
            contacts.map(c => (
              <label
                key={c.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleContact(c.id)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{c.email}</div>
                </div>
              </label>
            ))
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="text-sm text-indigo-600 font-medium">
            {selectedIds.size} contact(s) selected
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={adding || selectedIds.size === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {adding ? 'Adding...' : 'Add to List'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
