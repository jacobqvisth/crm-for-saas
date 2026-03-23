import { Construction } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({
  title,
  description = "This feature is under development and will be available soon.",
}: PlaceholderPageProps) {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <Construction className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-slate-700 mb-2">
          Coming soon
        </h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          {description}
        </p>
      </div>
    </div>
  );
}
