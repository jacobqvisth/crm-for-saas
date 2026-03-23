const leadStatusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  qualified: 'bg-purple-100 text-purple-700',
  customer: 'bg-green-100 text-green-700',
  churned: 'bg-red-100 text-red-700',
};

const contactStatusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  bounced: 'bg-red-100 text-red-700',
  unsubscribed: 'bg-slate-100 text-slate-700',
  archived: 'bg-slate-100 text-slate-500',
};

export function LeadStatusBadge({ status }: { status: string }) {
  const color = leadStatusColors[status] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {status}
    </span>
  );
}

export function ContactStatusBadge({ status }: { status: string }) {
  const color = contactStatusColors[status] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
      {status}
    </span>
  );
}

export function DealStageBadge({ stage }: { stage: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 capitalize">
      {stage}
    </span>
  );
}
