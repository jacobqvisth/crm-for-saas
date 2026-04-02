'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';

interface ArrayChipsFieldProps {
  label: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
  placeholder?: string;
  variant?: 'default' | 'tag';
}

export function ArrayChipsField({
  label,
  values,
  onAdd,
  onRemove,
  placeholder = 'Add...',
  variant = 'default',
}: ArrayChipsFieldProps) {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const chipClass =
    variant === 'tag'
      ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700'
      : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700';

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map((val, idx) => (
            <span key={idx} className={chipClass}>
              {val}
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="ml-0.5 text-current opacity-60 hover:opacity-100"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 text-xs px-2 py-1 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="flex-shrink-0 text-indigo-600 hover:text-indigo-700 p-1"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
