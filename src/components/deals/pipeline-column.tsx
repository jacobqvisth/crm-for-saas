'use client';

import { Droppable } from '@hello-pangea/dnd';
import { Plus } from 'lucide-react';
import { DealCard, type DealCardData } from './deal-card';
import type { PipelineStage } from '@/lib/database.types';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

interface PipelineColumnProps {
  stage: PipelineStage;
  deals: DealCardData[];
  onDealClick: (dealId: string) => void;
  onAddDeal: (stageName: string) => void;
}

export function PipelineColumn({ stage, deals, onDealClick, onAddDeal }: PipelineColumnProps) {
  const totalAmount = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  return (
    <div className="flex flex-col w-72 shrink-0 bg-slate-50 rounded-xl border border-slate-200">
      {/* Column header */}
      <div className="p-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
          <h3 className="text-sm font-semibold text-slate-900 truncate">{stage.name}</h3>
          <span className="ml-auto text-xs font-medium text-slate-400 bg-slate-200 rounded-full px-1.5 py-0.5">
            {deals.length}
          </span>
        </div>
        {totalAmount > 0 && (
          <p className="text-xs text-slate-500 mt-1 ml-4.5">{formatCurrency(totalAmount)}</p>
        )}
      </div>

      {/* Droppable area */}
      <Droppable droppableId={stage.name}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 p-2 space-y-2 overflow-y-auto min-h-[120px] transition-colors ${
              snapshot.isDraggingOver ? 'bg-indigo-50/50' : ''
            }`}
          >
            {deals.map((deal, index) => (
              <DealCard key={deal.id} deal={deal} index={index} onClick={onDealClick} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {/* Add deal button */}
      <div className="p-2 border-t border-slate-200">
        <button
          onClick={() => onAddDeal(stage.name)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 hover:bg-white rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add deal
        </button>
      </div>
    </div>
  );
}
