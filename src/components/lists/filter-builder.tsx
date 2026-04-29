'use client';

import { useState, useEffect } from 'react';
import { Plus, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { FilterRow } from './filter-row';
import type { Tables } from '@/lib/database.types';
import type { ListFilter } from '@/lib/lists/filter-query';
import { SUPPORTED_OUTBOUND_COUNTRIES, COUNTRY_NAMES } from '@/lib/countries';

interface FilterBuilderProps {
  filters: ListFilter[];
  onChange: (filters: ListFilter[]) => void;
}

export function FilterBuilder({ filters, onChange }: FilterBuilderProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const [companies, setCompanies] = useState<Tables<'companies'>[]>([]);
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from('companies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => { if (data) setCompanies(data); });
  }, [workspaceId, supabase]);

  useEffect(() => {
    if (!workspaceId) return;
    // Always include the supported outbound countries (so UK and any other
    // target country shows up even before any contacts have been added).
    // Also union in any country_code that's actually present in contacts so
    // unexpected codes from a fresh scrape auto-appear without a code change.
    const seen = new Set<string>();
    const list: { code: string; name: string }[] = [];
    for (const c of SUPPORTED_OUTBOUND_COUNTRIES) {
      seen.add(c.code);
      list.push({ code: c.code, name: c.name });
    }
    supabase
      .from('contacts')
      .select('country_code, country')
      .eq('workspace_id', workspaceId)
      .not('country_code', 'is', null)
      .then(({ data }) => {
        if (data) {
          for (const row of data) {
            const code = row.country_code?.toUpperCase();
            if (code && !seen.has(code)) {
              seen.add(code);
              list.push({ code, name: COUNTRY_NAMES[code] ?? row.country ?? code });
            }
          }
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        setCountries([...list]);
      });
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
                countries={countries}
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
