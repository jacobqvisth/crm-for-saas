export default function DashboardLoading() {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-pulse">
      <div className="mb-8">
        <div className="h-8 w-40 bg-slate-200 rounded" />
        <div className="h-4 w-64 bg-slate-200 rounded mt-2" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-slate-200 p-6 h-28"
          >
            <div className="h-4 w-24 bg-slate-200 rounded mb-3" />
            <div className="h-8 w-16 bg-slate-200 rounded" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6 h-80" />
        <div className="bg-white rounded-xl border border-slate-200 p-6 h-80" />
      </div>
    </div>
  );
}
