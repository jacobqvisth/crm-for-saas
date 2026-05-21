"use client";

import { Info } from "lucide-react";
import { useState } from "react";

interface InfoTooltipProps {
  label: string;
  className?: string;
}

export function InfoTooltip({ label, className }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        tabIndex={0}
        aria-label="What does this mean?"
        className="text-slate-400 hover:text-slate-600 transition-colors"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 w-64 px-3 py-2 text-xs font-normal text-white bg-slate-900 rounded-lg shadow-lg whitespace-normal text-left leading-relaxed"
        >
          {label}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-900" />
        </span>
      )}
    </span>
  );
}
