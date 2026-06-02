// Fallback shown inside a page's <Suspense> boundary while its heavy data
// (GA4 runReport, a Postgres RPC, or a multi-table warehouse scan) loads. The
// DashboardShell chrome above it has already rendered from the cached shared
// dashboard data, so this only fills the content area below the range buttons.

function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export function CeoPanelSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <Block className="h-4 w-24" />
            <Block className="mt-3 h-8 w-20" />
            <Block className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <Block className="h-5 w-40" />
        <Block className="mt-6 h-64 w-full" />
      </div>
    </div>
  );
}
