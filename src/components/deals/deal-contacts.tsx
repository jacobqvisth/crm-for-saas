'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, UserPlus, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';

type Contact = Tables<'contacts'>;

interface LinkedContact {
  id: string;
  deal_id: string;
  contact_id: string;
  role: string | null;
  contact: Contact;
}

interface DealContactsProps {
  dealId: string;
}

export function DealContacts({ dealId }: DealContactsProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [linkedContacts, setLinkedContacts] = useState<LinkedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const fetchLinkedContacts = async () => {
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('deal_contacts')
      .select('id, deal_id, contact_id, role, contact:contacts(*)')
      .eq('deal_id', dealId);

    if (error) {
      toast.error('Failed to load contacts');
      return;
    }
    // Flatten the joined data
    const parsed = (data || [])
      .filter((d): d is typeof d & { contact: Contact } => d.contact !== null)
      .map(d => ({
        id: d.id,
        deal_id: d.deal_id,
        contact_id: d.contact_id,
        role: d.role,
        contact: d.contact as unknown as Contact,
      }));
    setLinkedContacts(parsed);
    setLoading(false);
  };

  useEffect(() => {
    fetchLinkedContacts();
  }, [workspaceId, dealId]);

  // Search contacts
  useEffect(() => {
    if (!workspaceId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const linkedIds = linkedContacts.map(lc => lc.contact_id);
      let query = supabase
        .from('contacts')
        .select('*')
        .eq('workspace_id', workspaceId)
        .limit(10);

      query = query.or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);

      const { data } = await query;
      if (data) {
        setSearchResults(data.filter(c => !linkedIds.includes(c.id)));
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, workspaceId, linkedContacts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addContact = async (contact: Contact) => {
    setAdding(true);
    const { error } = await supabase
      .from('deal_contacts')
      .insert({ deal_id: dealId, contact_id: contact.id });

    if (error) {
      if (error.code === '23505') toast.error('Contact already linked');
      else toast.error('Failed to link contact');
    } else {
      toast.success('Contact linked');
      setSearchQuery('');
      setShowSearch(false);
      await fetchLinkedContacts();
    }
    setAdding(false);
  };

  const removeContact = async (dcId: string) => {
    const { error } = await supabase
      .from('deal_contacts')
      .delete()
      .eq('id', dcId);

    if (error) toast.error('Failed to remove contact');
    else {
      toast.success('Contact removed');
      setLinkedContacts(prev => prev.filter(lc => lc.id !== dcId));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const contactName = (c: Contact) =>
    [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-700">Contacts ({linkedContacts.length})</h4>
        <button
          onClick={() => setShowSearch(s => !s)}
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {showSearch && (
        <div ref={searchRef} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          {searchResults.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {searchResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => addContact(c)}
                  disabled={adding}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700"
                >
                  <span className="font-medium">{contactName(c)}</span>
                  <span className="text-slate-400 ml-2">{c.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {linkedContacts.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">No contacts linked</p>
      ) : (
        <div className="space-y-1">
          {linkedContacts.map(lc => (
            <div key={lc.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 group">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{contactName(lc.contact)}</p>
                <p className="text-xs text-slate-400 truncate">{lc.contact.email}</p>
              </div>
              <button
                onClick={() => removeContact(lc.id)}
                className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
