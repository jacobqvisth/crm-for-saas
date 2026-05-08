'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, X, Search } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Optional left-aligned hint, e.g. emoji or flag */
  prefix?: React.ReactNode;
  /** Optional right-aligned hint, e.g. count */
  hint?: React.ReactNode;
}

interface MultiSelectProps {
  values: string[];
  options: MultiSelectOption[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Plural noun for the "All X" label when nothing selected, e.g. "countries" */
  allLabel?: string;
  /** Show a search box at the top of the popover. Defaults to true if options.length >= 6. */
  searchable?: boolean;
  /** Width of the trigger button + popover. */
  className?: string;
  disabled?: boolean;
}

export function MultiSelect({
  values, options, onChange, placeholder, allLabel = 'options', searchable, className, disabled,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const showSearch = searchable ?? options.length >= 6;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [query, options]);

  const valueSet = new Set(values);
  const triggerLabel =
    values.length === 0 ? `All ${allLabel}` :
    values.length === 1 ? options.find((o) => o.value === values[0])?.label || values[0] :
                          `${values.length} selected`;

  const toggle = (value: string) => {
    if (valueSet.has(value)) onChange(values.filter((v) => v !== value));
    else onChange([...values, value]);
  };

  return (
    <div ref={ref} className={`relative ${className || ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-between gap-2 px-3 py-1.5 text-sm rounded-lg border bg-white min-w-[150px] ${
          disabled
            ? 'border-slate-100 text-slate-400 cursor-not-allowed'
            : values.length > 0
              ? 'border-indigo-300 text-indigo-700 ring-1 ring-indigo-100'
              : 'border-slate-200 text-slate-700 hover:border-slate-300'
        }`}
      >
        <span className="truncate">{placeholder && values.length === 0 ? placeholder : triggerLabel}</span>
        {values.length > 0 ? (
          <span
            role="button"
            aria-label="Clear selection"
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            onMouseDown={(e) => e.preventDefault()}
            className="ml-1 -mr-1 p-0.5 rounded hover:bg-indigo-100 text-indigo-600 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </span>
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
          {showSearch && (
            <div className="border-b border-slate-100 px-2 py-2 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                autoFocus
                className="w-full text-sm border-0 outline-none bg-transparent placeholder:text-slate-400"
              />
            </div>
          )}
          <div className="overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 italic">No matches</div>
            ) : (
              filtered.map((o) => {
                const active = valueSet.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${
                      active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                      active ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white'
                    }`}>
                      {active && <Check className="w-3 h-3 text-white" />}
                    </span>
                    {o.prefix != null && <span className="flex-shrink-0">{o.prefix}</span>}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.hint != null && <span className="text-xs text-slate-400 flex-shrink-0">{o.hint}</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
