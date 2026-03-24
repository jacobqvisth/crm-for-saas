'use client';

import { Draggable } from '@hello-pangea/dnd';
import { Building2, Calendar, Clock } from 'lucide-react';
import { differenceInDays } from 'date-fns';

export interface DealCardData {
  id: string;
  name: string;
  amount: number | null;
  stage: string;
  company_name: string | null;
  expected_close_date: string | null;
  updated_at: string;
}

interface DealCardProps {
  deal: DealCardData;
  index: number;
  onClick: (dealId: string) => void;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

export function DealCard({ deal, index, onClick }: DealCardProps) {
  const daysInStage = differenceInDays(new Date(), new Date(deal.updated_at));

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onClick(deal.id)}
          className={`bg-white rounded-lg border p-3 cursor-pointer transition-shadow ${
            snapshot.isDragging
              ? 'shadow-lg border-indigo-300 ring-2 ring-indigo-100'
              : 'border-slate-200 hover:shadow-md hover:border-slate-300'
          }`}
        >
          <p className="text-sm font-medium text-slate-900 truncate">{deal.name}</p>
          {deal.amount != null && (
            <p className="text-sm font-semibold text-indigo-600 mt-1">{formatCurrency(deal.amount)}</p>
          )}
          <div className="mt-2 space-y-1">
            {deal.company_name && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Building2 className="w-3 h-3 shrink-0" />
                <span className="truncate">{deal.company_name}</span>
              </div>
            )}
            {deal.expected_close_date && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Calendar className="w-3 h-3 shrink-0" />
                <span>{new Date(deal.expected_close_date).toLocaleDateString()}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Clock className="w-3 h-3 shrink-0" />
              <span>{daysInStage === 0 ? 'Today' : `${daysInStage}d in stage`}</span>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
