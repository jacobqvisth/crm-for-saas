'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { buildFilterQuery, type ListFilter } from '@/lib/lists/filter-query';
import toast from 'react-hot-toast';

interface ExportCsvButtonProps {
  listId: string;
  listName: string;
  isDynamic: boolean;
  filters: ListFilter[];
}

export function ExportCsvButton({ listId, listName, isDynamic, filters }: ExportCsvButtonProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!workspaceId) {
      toast.error('Workspace not loaded');
      return;
    }

    setExporting(true);

    try {
      let contacts: Record<string, unknown>[] = [];

      if (isDynamic) {
        const { data, error } = await buildFilterQuery(
          supabase,
          workspaceId,
          filters,
          '*, companies(name)',
        );
        if (error) throw error;
        contacts = (data || []) as unknown as Record<string, unknown>[];
      } else {
        const { data, error } = await supabase
          .from('contact_list_members')
          .select('contacts(*, companies(name))')
          .eq('list_id', listId);
        if (error) throw error;
        contacts = ((data || []) as unknown as { contacts: Record<string, unknown> }[]).map((m) => m.contacts).filter(Boolean) as Record<string, unknown>[];
      }

      const csvData = contacts.map((c: Record<string, unknown>) => ({
        Email: c.email,
        'First Name': c.first_name || '',
        'Last Name': c.last_name || '',
        Phone: c.phone || '',
        Company: (c.companies as { name: string } | null)?.name || '',
        Status: c.status,
        'Lead Status': c.lead_status,
      }));

      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${listName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Exported ${contacts.length} contacts`);
    } catch {
      toast.error('Failed to export contacts');
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
    >
      {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      Export CSV
    </button>
  );
}
