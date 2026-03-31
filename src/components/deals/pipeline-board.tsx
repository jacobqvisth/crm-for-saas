'use client';

import { useState, useEffect, useCallback } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { Plus, Settings, Loader2, Filter, X, Search } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { PipelineColumn } from './pipeline-column';
import { AddDealForm } from './add-deal-form';
import { DealDetailPanel } from './deal-detail-panel';
import { SlideOver } from '@/components/ui/slide-over';
import toast from 'react-hot-toast';
import type { Tables, PipelineStage, Json } from '@/lib/database.types';
import type { DealCardData } from './deal-card';

type Pipeline = Tables<'pipelines'>;
type Deal = Tables<'deals'>;

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

export function PipelineBoard() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [deals, setDeals] = useState<DealCardData[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [addDealStage, setAddDealStage] = useState<string | undefined>();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterAmountMin, setFilterAmountMin] = useState('');
  const [filterAmountMax, setFilterAmountMax] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [companies, setCompanies] = useState<Tables<'companies'>[]>([]);

  const activePipeline = pipelines.find(p => p.id === activePipelineId);
  const stages: PipelineStage[] = (activePipeline?.stages as unknown as PipelineStage[]) || [];

  // Fetch pipelines
  useEffect(() => {
    if (!workspaceId) return;
    async function fetchPipelines() {
      const { data, error } = await supabase
        .from('pipelines')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .order('created_at');

      if (error) {
        toast.error('Failed to load pipelines');
        return;
      }
      setPipelines(data || []);
      if (data && data.length > 0 && !activePipelineId) {
        setActivePipelineId(data[0].id);
      }
    }
    fetchPipelines();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch companies for filter
  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from('companies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => { if (data) setCompanies(data); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch deals
  const fetchDeals = useCallback(async () => {
    if (!workspaceId || !activePipelineId) return;
    setLoading(true);

    let query = supabase
      .from('deals')
      .select('id, name, amount, stage, probability, company_id, expected_close_date, updated_at, companies(name)')
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', activePipelineId)
      .order('created_at', { ascending: true });

    if (filterCompany) query = query.eq('company_id', filterCompany);
    if (filterAmountMin) query = query.gte('amount', Number(filterAmountMin));
    if (filterAmountMax) query = query.lte('amount', Number(filterAmountMax));
    if (filterDateFrom) query = query.gte('expected_close_date', filterDateFrom);
    if (filterDateTo) query = query.lte('expected_close_date', filterDateTo);

    const { data, error } = await query;

    if (error) {
      toast.error('Failed to load deals');
      setLoading(false);
      return;
    }

    const mapped: DealCardData[] = (data || []).map((d) => ({
      id: d.id,
      name: d.name,
      amount: d.amount,
      stage: d.stage,
      company_name: (d.companies as unknown as { name: string } | null)?.name || null,
      expected_close_date: d.expected_close_date,
      updated_at: d.updated_at,
    }));

    setDeals(mapped);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, activePipelineId, filterCompany, filterAmountMin, filterAmountMax, filterDateFrom, filterDateTo]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  // Handle drag end
  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination || !workspaceId) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const fromStage = source.droppableId;
    const toStage = destination.droppableId;
    const dealId = draggableId;

    // Optimistic update
    setDeals(prev => prev.map(d =>
      d.id === dealId ? { ...d, stage: toStage, updated_at: new Date().toISOString() } : d
    ));

    const stageConfig = stages.find(s => s.name === toStage);

    const { error } = await supabase
      .from('deals')
      .update({
        stage: toStage,
        probability: stageConfig?.probability ?? 0,
      })
      .eq('id', dealId)
      .eq('workspace_id', workspaceId);

    if (error) {
      toast.error('Failed to move deal');
      fetchDeals(); // Revert
      return;
    }

    // Log stage change activity
    if (fromStage !== toStage) {
      const { data: user } = await supabase.auth.getUser();
      await supabase.from('activities').insert({
        workspace_id: workspaceId,
        type: 'deal_stage_change',
        deal_id: dealId,
        user_id: user?.user?.id || null,
        subject: `Stage changed to ${toStage}`,
        metadata: { from_stage: fromStage, to_stage: toStage } as unknown as Json,
      });
    }
  };

  const handleAddDeal = (stageName: string) => {
    setAddDealStage(stageName);
    setShowAddDeal(true);
  };

  const hasActiveFilters = filterCompany || filterAmountMin || filterAmountMax || filterDateFrom || filterDateTo;

  const clearFilters = () => {
    setFilterCompany('');
    setFilterAmountMin('');
    setFilterAmountMax('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  // Calculate totals
  const totalValue = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const weightedValue = deals.reduce((sum, d) => {
    const stageConfig = stages.find(s => s.name === d.stage);
    const prob = stageConfig?.probability ?? 0;
    return sum + ((d.amount ?? 0) * prob / 100);
  }, 0);

  // Group deals by stage
  const dealsByStage: Record<string, DealCardData[]> = {};
  for (const stage of stages) {
    dealsByStage[stage.name] = deals.filter(d => d.stage === stage.name);
  }

  if (!workspaceId) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">
                {activePipeline?.name || 'Deals'}
              </h1>
              {pipelines.length > 1 && (
                <select
                  value={activePipelineId || ''}
                  onChange={e => setActivePipelineId(e.target.value)}
                  className="text-sm border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {pipelines.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
              <span>Total: <strong className="text-slate-700">{formatCurrency(totalValue)}</strong></span>
              <span>Weighted: <strong className="text-slate-700">{formatCurrency(weightedValue)}</strong></span>
              <span>{deals.length} deal{deals.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                hasActiveFilters
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && (
                <button
                  onClick={e => { e.stopPropagation(); clearFilters(); }}
                  className="ml-1 p-0.5 rounded-full hover:bg-indigo-200"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </button>
            <button
              onClick={() => { setAddDealStage(undefined); setShowAddDeal(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" />
              New Deal
            </button>
            <Link
              href="/settings/pipelines"
              className="p-2 border border-slate-300 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <select
              value={filterCompany}
              onChange={e => setFilterCompany(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder="Min $"
                value={filterAmountMin}
                onChange={e => setFilterAmountMin(e.target.value)}
                className="w-24 text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-slate-400">–</span>
              <input
                type="number"
                placeholder="Max $"
                value={filterAmountMax}
                onChange={e => setFilterAmountMax(e.target.value)}
                className="w-24 text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-slate-400">–</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto px-6 pb-6">
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4 h-full">
              {stages.map(stage => (
                <PipelineColumn
                  key={stage.name}
                  stage={stage}
                  deals={dealsByStage[stage.name] || []}
                  onDealClick={id => setSelectedDealId(id)}
                  onAddDeal={handleAddDeal}
                />
              ))}
            </div>
          </DragDropContext>
        </div>
      )}

      {/* Add Deal Slide-Over */}
      <SlideOver
        open={showAddDeal}
        onClose={() => setShowAddDeal(false)}
        title="New Deal"
      >
        {activePipelineId && (
          <AddDealForm
            pipelineId={activePipelineId}
            stages={stages}
            defaultStage={addDealStage}
            onSuccess={() => { setShowAddDeal(false); fetchDeals(); }}
            onCancel={() => setShowAddDeal(false)}
          />
        )}
      </SlideOver>

      {/* Deal Detail Panel */}
      {selectedDealId && (
        <DealDetailPanel
          dealId={selectedDealId}
          stages={stages}
          open={!!selectedDealId}
          onClose={() => setSelectedDealId(null)}
          onDealUpdated={fetchDeals}
        />
      )}
    </div>
  );
}
