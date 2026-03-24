"use client";

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-slate-200 rounded-lg ${className ?? ""}`} />
  );
}

function MetricCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <SkeletonBox className="h-4 w-24" />
          <SkeletonBox className="h-8 w-20" />
          <SkeletonBox className="h-3 w-32" />
        </div>
        <SkeletonBox className="h-9 w-9 rounded-lg" />
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <SkeletonBox className="h-5 w-40 mb-4" />
      <SkeletonBox className="h-64 w-full" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <SkeletonBox className="h-5 w-48 mb-4" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBox key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      {/* Email performance */}
      <ChartSkeleton />

      {/* Two column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartSkeleton />
        <TableSkeleton />
      </div>

      {/* Pipeline + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}
