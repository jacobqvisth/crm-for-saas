export default function ContactsLoading() {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-32 bg-slate-200 rounded" />
          <div className="h-4 w-56 bg-slate-200 rounded mt-2" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-28 bg-slate-200 rounded-lg" />
          <div className="h-10 w-32 bg-slate-200 rounded-lg" />
        </div>
      </div>
      {/* Search */}
      <div className="h-10 w-full bg-slate-200 rounded-lg mb-4" />
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-40 bg-slate-200 rounded-lg" />
        <div className="h-10 w-32 bg-slate-200 rounded-lg" />
        <div className="h-10 w-36 bg-slate-200 rounded-lg" />
      </div>
      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="border-b border-slate-200 px-4 py-3 flex gap-4">
          {[32, 120, 160, 100, 80, 80, 80].map((w, i) => (
            <div key={i} className="h-4 bg-slate-200 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="border-b border-slate-100 px-4 py-3 flex gap-4">
            <div className="h-4 w-4 bg-slate-200 rounded" />
            <div className="h-4 w-32 bg-slate-200 rounded" />
            <div className="h-4 w-40 bg-slate-200 rounded" />
            <div className="h-4 w-24 bg-slate-200 rounded" />
            <div className="h-5 w-16 bg-slate-200 rounded-full" />
            <div className="h-4 w-20 bg-slate-200 rounded" />
            <div className="h-4 w-20 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
