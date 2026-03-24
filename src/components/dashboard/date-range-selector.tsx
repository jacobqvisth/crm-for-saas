"use client";

type RangeKey = "1d" | "7d" | "30d" | "90d" | "all";

const ranges: { key: RangeKey; label: string }[] = [
  { key: "1d", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "90d", label: "90 Days" },
  { key: "all", label: "All Time" },
];

interface DateRangeSelectorProps {
  value: RangeKey;
  onChange: (range: RangeKey) => void;
}

export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      {ranges.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === r.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export type { RangeKey };
