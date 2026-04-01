'use client';

import { useState, useEffect } from 'react';
import { Plus, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { FilterRow } from './filter-row';
import type { Tables } from '@/lib/database.types';
import type { ListFilter } from '@/lib/lists/filter-query';

interface FilterBuilderProps {
  filters: ListFilter[];
  onChange: (filters: ListFilter[]) => void;
}

export function FilterBuilder({ filters, onChange }: FilterBuilderProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const [companies, setCompanies] = useState<Tables<'companies'>[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from('companies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => { if (data) setCompanies(data); });
  }, [workspaceId, supabase]);

  const addFilter = () => {
    onChange([...filters, { field: 'status', operator: 'equals', value: '' }]);
  };

  const updateFilter = (index: number, filter: ListFilter) => {
    const next = [...filters];
    next[index] = filter;
    onChange(next);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {filters.length === 0 ? (
        <div className="text-center py-6 text-sm text-slate-500">
          <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p>No filters yet. Add a filter to define your dynamic list.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filters.map((filter, i) => (
            <div key={i}>
              {i > 0 && (
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider py-1 pl-1">AND</div>
              )}
              <FilterRow
                filter={filter}
                onChange={(f) => updateFilter(i, f)}
                onRemove={() => removeFilter(i)}
                companies={companies}
              />
            </div>
          ))}
        </div>
      )}

      <button
        onClick={addFilter}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
      >
        <Plus className="w-4 h-4" />
        Add Filter
      </button>
    </div>
  );
}
