"use client";

import { useState, useRef, useEffect } from "react";
import { Variable } from "lucide-react";

const VARIABLES = [
  { key: "first_name", label: "First Name", example: "John" },
  { key: "last_name", label: "Last Name", example: "Doe" },
  { key: "email", label: "Email", example: "john@example.com" },
  { key: "company_name", label: "Company Name", example: "Acme Inc" },
  { key: "phone", label: "Phone", example: "+1 555-0123" },
  { key: "unsubscribe_link", label: "Unsubscribe Link", example: "#" },
];

interface VariablePickerProps {
  onInsert: (variable: string) => void;
}

export function VariablePicker({ onInsert }: VariablePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
      >
        <Variable className="w-3.5 h-3.5" />
        Variables
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-1">
          {VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                onInsert(`{{${v.key}}}`);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between"
            >
              <span className="text-sm text-slate-700">{v.label}</span>
              <code className="text-xs text-slate-400">{`{{${v.key}}}`}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
