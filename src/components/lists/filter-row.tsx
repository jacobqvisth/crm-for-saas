'use client';

import { X } from 'lucide-react';
import type { Tables } from '@/lib/database.types';
import {
  type ListFilter,
  type FilterField,
  type FilterOperator,
  FILTER_FIELDS,
  OPERATORS_BY_FIELD,
  STATUS_OPTIONS,
  LEAD_STATUS_OPTIONS,
} from '@/lib/lists/filter-query';

interface FilterRowProps {
  filter: ListFilter;
  onChange: (filter: ListFilter) => void;
  onRemove: () => void;
  companies: Tables<'companies'>[];
  countries: { code: string; name: string }[];
}

export function FilterRow({ filter, onChange, onRemove, companies, countries }: FilterRowProps) {
  const operators = OPERATORS_BY_FIELD[filter.field] || [];

  const handleFieldChange = (field: FilterField) => {
    const newOps = OPERATORS_BY_FIELD[field];
    const newFilter: ListFilter = {
      field,
      operator: newOps[0]?.value || 'equals',
      value: '',
    };
    onChange(newFilter);
  };

  const handleOperatorChange = (operator: FilterOperator) => {
    onChange({ ...filter, operator });
  };

  const needsNoValue = filter.operator === 'is_null' || filter.operator === 'is_not_null';

  const renderValueInput = () => {
    if (needsNoValue) return null;

    if (filter.field === 'status') {
      if (filter.operator === 'in') {
        const selected = Array.isArray(filter.value) ? filter.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map(s => (
              <label key={s} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(s)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, s]
                      : selected.filter(x => x !== s);
                    onChange({ ...filter, value: next });
                  }}
                  className="rounded border-slate-300 text-indigo-600"
                />
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select
          value={(filter.value as string) || ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select...</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      );
    }

    if (filter.field === 'lead_status') {
      if (filter.operator === 'in') {
        const selected = Array.isArray(filter.value) ? filter.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {LEAD_STATUS_OPTIONS.map(s => (
              <label key={s} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(s)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, s]
                      : selected.filter(x => x !== s);
                    onChange({ ...filter, value: next });
                  }}
                  className="rounded border-slate-300 text-indigo-600"
                />
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select
          value={(filter.value as string) || ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select...</option>
          {LEAD_STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      );
    }

    if (filter.field === 'company_id') {
      return (
        <select
          value={(filter.value as string) || ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select company...</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      );
    }

    if (filter.field === 'country_code') {
      return (
        <select
          value={(filter.value as string) || ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select country...</option>
          {countries.map(c => (
            <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
          ))}
        </select>
      );
    }

    if (filter.field === 'created_at' || filter.field === 'last_contacted_at') {
      if (filter.operator === 'older_than_days' || filter.operator === 'within_last_days') {
        return (
          <input
            type="number"
            min={1}
            placeholder="Number of days"
            value={(filter.value as number) || ''}
            onChange={(e) => onChange({ ...filter, value: parseInt(e.target.value) || 0 })}
            className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        );
      }
      return (
        <input
          type="date"
          value={(filter.value as string) || ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      );
    }

    if (filter.field === 'custom_fields') {
      return (
        <div className="flex flex-1 gap-2">
          <input
            type="text"
            placeholder="Field name"
            value={filter.customFieldKey || ''}
            onChange={(e) => onChange({ ...filter, customFieldKey: e.target.value })}
            className="w-32 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            placeholder="Value"
            value={(filter.value as string) || ''}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
            className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      );
    }

    // Default text input for email, first_name, last_name
    return (
      <input
        type="text"
        placeholder="Value..."
        value={(filter.value as string) || ''}
        onChange={(e) => onChange({ ...filter, value: e.target.value })}
        className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    );
  };

  return (
    <div className="flex items-start gap-2">
      <select
        value={filter.field}
        onChange={(e) => handleFieldChange(e.target.value as FilterField)}
        className="w-40 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {FILTER_FIELDS.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      <select
        value={filter.operator}
        onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)}
        className="w-44 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {operators.map(op => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>

      {renderValueInput()}

      <button
        onClick={onRemove}
        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
