'use client';

import { useState, useRef, useEffect } from 'react';

interface EditableTextareaProps {
  label: string;
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export function EditableTextarea({
  label,
  value,
  onSave,
  placeholder = '—',
  rows = 4,
}: EditableTextareaProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  // Sync draft when value changes externally
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const handleSave = () => {
    onSave(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {editing ? (
        <div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={rows}
            className="w-full text-sm px-2 py-1.5 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
          <div className="flex gap-2 mt-1 justify-end">
            <button
              type="button"
              onClick={handleCancel}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded px-2 py-1"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p
          onClick={() => { setDraft(value); setEditing(true); }}
          className="text-sm text-slate-900 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-slate-200 whitespace-pre-wrap"
        >
          {value || <span className="text-slate-400">{placeholder}</span>}
        </p>
      )}
    </div>
  );
}
