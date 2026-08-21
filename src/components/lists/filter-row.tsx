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
  EMAIL_STATUS_OPTIONS,
  PLAN_TYPE_OPTIONS,
  PLAN_TYPE_LABELS,
  SUBSCRIPTION_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  PAYMENT_STATUS_LABELS,
  RECENCY_PRESET_DAYS,
  RECENCY_PRESET_LABELS,
  DATE_FIELDS,
} from '@/lib/lists/filter-query';
import { LANGUAGE_OPTIONS } from '@/lib/i18n/languages';

const NUMERIC_FIELDS: FilterField[] = [
  'diagnostics_total',
  'diagnostics_last_30d',
  'login_count',
  'credits_remaining',
];

const EMAIL_STATUS_LABELS: Record<string, string> = {
  valid: 'Valid (deliverable)',
  invalid: 'Invalid (bounces)',
  catch_all: 'Catch-all (uncertain)',
  risky: 'Risky (MV couldn’t verify)',
  unknown: 'Unknown (not yet verified)',
};

interface FilterRowProps {
  filter: ListFilter;
  onChange: (filter: ListFilter) => void;
  onRemove: () => void;
  companies: Tables<'companies'>[];
  countries: { code: string; name: string }[];
}

export function FilterRow({ filter, onChange, onRemove, companies, countries }: FilterRowProps) {
  const operators = OPERATORS_BY_FIELD[filter.field] || [];

  // A day-count operator with no value is meaningless (and `0` would quietly
  // match everything or nothing), so seed one month whenever we switch into
  // one. Every other operator keeps starting empty.
  const DEFAULT_DAYS = 30;
  const isDayCount = (op: FilterOperator) =>
    op === 'within_last_days' || op === 'older_than_days';

  const handleFieldChange = (field: FilterField) => {
    const newOps = OPERATORS_BY_FIELD[field];
    const operator = newOps[0]?.value || 'equals';
    onChange({ field, operator, value: isDayCount(operator) ? DEFAULT_DAYS : '' });
  };

  const handleOperatorChange = (operator: FilterOperator) => {
    const keepsValue = isDayCount(operator) === isDayCount(filter.operator);
    onChange({
      ...filter,
      operator,
      value: keepsValue ? filter.value : isDayCount(operator) ? DEFAULT_DAYS : '',
    });
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

    if (filter.field === 'email_status') {
      if (filter.operator === 'in') {
        const selected = Array.isArray(filter.value) ? filter.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {EMAIL_STATUS_OPTIONS.map(s => (
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
                {EMAIL_STATUS_LABELS[s] ?? s}
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
          {EMAIL_STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{EMAIL_STATUS_LABELS[s] ?? s}</option>
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

    if (filter.field === 'language') {
      if (filter.operator === 'in') {
        const selected = Array.isArray(filter.value) ? filter.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGE_OPTIONS.map(l => (
              <label key={l.code} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(l.code)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, l.code]
                      : selected.filter(x => x !== l.code);
                    onChange({ ...filter, value: next });
                  }}
                  className="rounded border-slate-300 text-indigo-600"
                />
                {l.label}
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
          <option value="">Select language...</option>
          {LANGUAGE_OPTIONS.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      );
    }

    if (
      filter.field === 'user_plan_type' ||
      filter.field === 'user_subscription_status' ||
      filter.field === 'payment_status'
    ) {
      const options: readonly string[] =
        filter.field === 'user_plan_type'
          ? PLAN_TYPE_OPTIONS
          : filter.field === 'payment_status'
            ? PAYMENT_STATUS_OPTIONS
            : SUBSCRIPTION_STATUS_OPTIONS;
      const labelFor = (s: string) =>
        filter.field === 'user_plan_type'
          ? PLAN_TYPE_LABELS[s] ?? s
          : filter.field === 'payment_status'
            ? PAYMENT_STATUS_LABELS[s] ?? s
            : s.charAt(0).toUpperCase() + s.slice(1);
      if (filter.operator === 'in') {
        const selected = Array.isArray(filter.value) ? filter.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {options.map(s => (
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
                {labelFor(s)}
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
          {options.map(s => (
            <option key={s} value={s}>{labelFor(s)}</option>
          ))}
        </select>
      );
    }

    if (NUMERIC_FIELDS.includes(filter.field)) {
      return (
        <input
          type="number"
          min={0}
          placeholder="Number"
          value={(filter.value as number) ?? ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value === '' ? 0 : parseInt(e.target.value) })}
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      );
    }

    if (DATE_FIELDS.includes(filter.field)) {
      if (filter.operator === 'older_than_days' || filter.operator === 'within_last_days') {
        // Presets cover the windows people actually ask for ("last week",
        // "last month", "last quarter"); "Custom…" falls back to a raw day
        // count so nothing that was expressible before is lost.
        const days = Number(filter.value) || 0;
        const isPreset = (RECENCY_PRESET_DAYS as readonly number[]).includes(days);
        return (
          <div className="flex flex-1 gap-2">
            <select
              value={isPreset ? String(days) : 'custom'}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...filter, value: v === 'custom' ? 0 : parseInt(v) });
              }}
              className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {RECENCY_PRESET_DAYS.map((d) => (
                <option key={d} value={d}>{RECENCY_PRESET_LABELS[d]}</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {!isPreset && (
              <input
                type="number"
                min={1}
                placeholder="Days"
                autoFocus
                value={days || ''}
                onChange={(e) => onChange({ ...filter, value: parseInt(e.target.value) || 0 })}
                className="w-28 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>
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
