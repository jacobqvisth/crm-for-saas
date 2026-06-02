// Instant route-level skeleton for every /ceo/* page. The sidebar lives in
// the (ceo) layout and persists across navigation, so this only fills the
// content pane — Next shows it the moment a CEO link is clicked, while the
// server component resolves its (now-cached) data. Mirrors the chrome in
// dashboard-shell.tsx (p-6 lg:p-8 max-w-7xl mx-auto) so the swap is seamless.

function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export default function CeoLoading() {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto" aria-busy="true">
      {/* Title */}
      <header className="mb-6">
        <Block className="h-7 w-56" />
        <Block className="mt-2 h-4 w-40" />
      </header>

      {/* Section nav */}
      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Block key={i} className="h-5 w-20" />
        ))}
      </div>

      {/* Time-range buttons */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <Block key={i} className="h-7 w-16" />
        ))}
      </div>

      {/* KPI tiles */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      {/* Main content block (chart / table) */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <Block className="h-5 w-40" />
        <Block className="mt-6 h-56 w-full" />
      </div>
    </div>
  );
}
