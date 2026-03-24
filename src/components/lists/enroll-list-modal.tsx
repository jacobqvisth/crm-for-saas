'use client';

import { useState, useEffect } from 'react';
import { Loader2, Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { Modal } from '@/components/ui/modal';
import { buildFilterQuery, type ListFilter } from '@/lib/lists/filter-query';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';

interface EnrollListModalProps {
  open: boolean;
  onClose: () => void;
  listId: string;
  isDynamic: boolean;
  filters: ListFilter[];
  contactCount: number;
}

export function EnrollListModal({ open, onClose, listId, isDynamic, filters, contactCount }: EnrollListModalProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [sequences, setSequences] = useState<Tables<'sequences'>[]>([]);
  const [selectedSequence, setSelectedSequence] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!workspaceId || !open) return;
    supabase
      .from('sequences')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'draft'])
      .order('name')
      .then(({ data }) => { if (data) setSequences(data); });
  }, [workspaceId, open, supabase]);

  const handleEnroll = async () => {
    if (!workspaceId || !selectedSequence) return;
    setEnrolling(true);

    try {
      let contactIds: string[] = [];

      if (isDynamic) {
        const { data, error } = await buildFilterQuery(
          supabase,
          workspaceId,
          filters,
          'id',
        );
        if (error) throw error;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contactIds = (data || []).map((c: any) => c.id);
      } else {
        const { data, error } = await supabase
          .from('contact_list_members')
          .select('contact_id')
          .eq('list_id', listId);
        if (error) throw error;
        contactIds = (data || []).map(m => m.contact_id);
      }

      if (contactIds.length === 0) {
        toast.error('No contacts in this list');
        setEnrolling(false);
        return;
      }

      const res = await fetch('/api/sequences/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequenceId: selectedSequence,
          contactIds,
          workspaceId,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || 'Enrollment failed');
      } else {
        toast.success(
          `Enrolled ${result.enrolled} contacts${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}`
        );
        onClose();
      }
    } catch {
      toast.error('Failed to enroll contacts');
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Enroll in Sequence" maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Enroll {contactCount} contact{contactCount !== 1 ? 's' : ''} from this list into a sequence.
        </p>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Select Sequence</label>
          <select
            value={selectedSequence}
            onChange={(e) => setSelectedSequence(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Choose a sequence...</option>
            {sequences.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.status})
              </option>
            ))}
          </select>
        </div>

        {sequences.length === 0 && (
          <p className="text-sm text-slate-500">No sequences available. Create a sequence first.</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleEnroll}
            disabled={enrolling || !selectedSequence}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {enrolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {enrolling ? 'Enrolling...' : 'Enroll'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
