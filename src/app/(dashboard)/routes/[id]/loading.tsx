export default function Loading() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="h-4 w-28 bg-slate-100 animate-pulse rounded mb-4" />
      <div className="h-32 bg-slate-100 animate-pulse rounded mb-4" />
      <div className="h-16 bg-slate-100 animate-pulse rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-3 aspect-square md:aspect-[16/9] bg-slate-100 animate-pulse rounded" />
        <div className="md:col-span-2 h-96 bg-slate-100 animate-pulse rounded" />
      </div>
    </div>
  );
}
