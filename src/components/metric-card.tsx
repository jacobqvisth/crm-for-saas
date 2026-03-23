import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
  trend?: {
    value: number;
    positive: boolean;
  };
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  subtitle,
  trend,
}: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-400">{subtitle}</p>
          )}
          {trend && (
            <p
              className={`text-xs font-medium ${
                trend.positive ? "text-green-600" : "text-red-600"
              }`}
            >
              {trend.positive ? "+" : ""}
              {trend.value}% from last period
            </p>
          )}
        </div>
        <div className="p-2 bg-indigo-50 rounded-lg">
          <Icon className="w-5 h-5 text-indigo-600" />
        </div>
      </div>
    </div>
  );
}
