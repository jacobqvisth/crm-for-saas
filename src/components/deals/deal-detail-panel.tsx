'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Pencil, Loader2, Search, Building2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { DealContacts } from './deal-contacts';
import { DealActivityTimeline } from './deal-activity-timeline';
import toast from 'react-hot-toast';
import type { Tables, PipelineStage, Json } from '@/lib/database.types';

type Deal = Tables<'deals'>;
type Company = Tables<'companies'>;

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

interface DealDetailPanelProps {
  dealId: string;
  stages: PipelineStage[];
  open: boolean;
  onClose: () => void;
  onDealUpdated: () => void;
}

export function DealDetailPanel({ dealId, stages, open, onClose, onDealUpdated }: DealDetailPanelProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  // Inline editing states
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountValue, setAmountValue] = useState('');
  const [editingDate, setEditingDate] = useState(false);
  const [dateValue, setDateValue] = useState('');

  // Company search
  const [editingCompany, setEditingCompany] = useState(false);
  const [companySearch, setCompanySearch] = useState('');
  const [companyResults, setCompanyResults] = useState<Company[]>([]);
  const companyRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<'activity' | 'contacts'>('activity');

  const fetchDeal = useCallback(async () => {
    if (!workspaceId || !dealId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) {
      toast.error('Failed to load deal');
      setLoading(false);
      return;
    }

    setDeal(data);
    setNameValue(data.name);
    setAmountValue(data.amount?.toString() || '');
    setDateValue(data.expected_close_date || '');

    if (data.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .eq('id', data.company_id)
        .single();
      setCompany(companyData);
    } else {
      setCompany(null);
    }

    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, dealId]);

  useEffect(() => {
    if (open && dealId) fetchDeal();
  }, [open, dealId, fetchDeal]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  // Company search
  useEffect(() => {
    if (!workspaceId || !companySearch.trim()) { setCompanyResults([]); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('companies')
        .select('*')
        .eq('workspace_id', workspaceId)
        .ilike('name', `%${companySearch}%`)
        .limit(10);
      if (data) setCompanyResults(data);
    }, 200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companySearch, workspaceId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (companyRef.current && !companyRef.current.contains(e.target as Node)) {
        setEditingCompany(false);
        setCompanySearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateField = async (field: string, value: unknown) => {
    if (!deal || !workspaceId) return;

    const oldStage = deal.stage;
    const updateData: Record<string, unknown> = { [field]: value };

    // If stage changes, update probability too
    if (field === 'stage') {
      const stageConfig = stages.find(s => s.name === value);
      if (stageConfig) updateData.probability = stageConfig.probability;
    }

    const { error } = await supabase
      .from('deals')
      .update(updateData)
      .eq('id', deal.id)
      .eq('workspace_id', workspaceId);

    if (error) {
      toast.error('Failed to update deal');
      return;
    }

    // Log stage change activity
    if (field === 'stage' && value !== oldStage) {
      const { data: user } = await supabase.auth.getUser();
      await supabase.from('activities').insert({
        workspace_id: workspaceId,
        type: 'deal_stage_change',
        deal_id: deal.id,
        user_id: user?.user?.id || null,
        subject: `Stage changed to ${value}`,
        metadata: { from_stage: oldStage, to_stage: value } as unknown as Json,
      });
    }

    toast.success('Deal updated');
    await fetchDeal();
    onDealUpdated();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white shadow-xl flex flex-col">
        {loading || !deal ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between p-4 border-b border-slate-200">
              <div className="flex-1 min-w-0">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nameValue}
                      onChange={e => setNameValue(e.target.value)}
                      className="text-lg font-semibold text-slate-900 border border-slate-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') { updateField('name', nameValue); setEditingName(false); }
                        if (e.key === 'Escape') { setNameValue(deal.name); setEditingName(false); }
                      }}
                    />
                    <button onClick={() => { updateField('name', nameValue); setEditingName(false); }} className="p-1 text-green-600 hover:bg-green-50 rounded">
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <h2
                    className="text-lg font-semibold text-slate-900 truncate cursor-pointer hover:text-indigo-600 group flex items-center gap-2"
                    onClick={() => setEditingName(true)}
                  >
                    {deal.name}
                    <Pencil className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100" />
                  </h2>
                )}
                {/* Stage badge */}
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: stages.find(s => s.name === deal.stage)?.color || '#6366f1' }}
                  />
                  <span className="text-sm text-slate-500">{deal.stage}</span>
                </div>
              </div>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 ml-2">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Fields */}
            <div className="p-4 border-b border-slate-200 space-y-3">
              {/* Amount */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Amount</span>
                {editingAmount ? (
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-slate-400">$</span>
                    <input
                      type="text"
                      value={amountValue}
                      onChange={e => setAmountValue(e.target.value)}
                      className="w-28 text-sm border border-slate-300 rounded px-2 py-0.5 text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') { updateField('amount', amountValue ? Number(amountValue) : null); setEditingAmount(false); }
                        if (e.key === 'Escape') { setAmountValue(deal.amount?.toString() || ''); setEditingAmount(false); }
                      }}
                    />
                    <button onClick={() => { updateField('amount', amountValue ? Number(amountValue) : null); setEditingAmount(false); }} className="p-0.5 text-green-600">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span
                    className="text-sm font-medium text-slate-900 cursor-pointer hover:text-indigo-600"
                    onClick={() => setEditingAmount(true)}
                  >
                    {deal.amount != null ? formatCurrency(deal.amount) : '—'}
                  </span>
                )}
              </div>

              {/* Stage */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Stage</span>
                <select
                  value={deal.stage}
                  onChange={e => updateField('stage', e.target.value)}
                  className="text-sm border border-slate-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {stages.map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Expected close date */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Close Date</span>
                {editingDate ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={dateValue}
                      onChange={e => setDateValue(e.target.value)}
                      className="text-sm border border-slate-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') { updateField('expected_close_date', dateValue || null); setEditingDate(false); }
                        if (e.key === 'Escape') { setDateValue(deal.expected_close_date || ''); setEditingDate(false); }
                      }}
                    />
                    <button onClick={() => { updateField('expected_close_date', dateValue || null); setEditingDate(false); }} className="p-0.5 text-green-600">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span
                    className="text-sm text-slate-900 cursor-pointer hover:text-indigo-600"
                    onClick={() => setEditingDate(true)}
                  >
                    {deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString() : '—'}
                  </span>
                )}
              </div>

              {/* Company */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Company</span>
                {editingCompany ? (
                  <div ref={companyRef} className="relative">
                    <input
                      type="text"
                      value={companySearch}
                      onChange={e => setCompanySearch(e.target.value)}
                      placeholder="Search..."
                      className="w-40 text-sm border border-slate-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                    />
                    {companyResults.length > 0 && (
                      <div className="absolute right-0 z-10 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                        {companyResults.map(c => (
                          <button
                            key={c.id}
                            onClick={() => {
                              updateField('company_id', c.id);
                              setEditingCompany(false);
                              setCompanySearch('');
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 text-slate-700"
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span
                    className="text-sm text-slate-900 cursor-pointer hover:text-indigo-600 flex items-center gap-1"
                    onClick={() => setEditingCompany(true)}
                  >
                    {company ? (
                      <><Building2 className="w-3.5 h-3.5 text-slate-400" />{company.name}</>
                    ) : '—'}
                  </span>
                )}
              </div>

              {/* Probability */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Probability</span>
                <span className="text-sm text-slate-900">{deal.probability ?? 0}%</span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setActiveTab('activity')}
                className={`flex-1 py-2.5 text-sm font-medium text-center border-b-2 transition-colors ${
                  activeTab === 'activity' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Activity
              </button>
              <button
                onClick={() => setActiveTab('contacts')}
                className={`flex-1 py-2.5 text-sm font-medium text-center border-b-2 transition-colors ${
                  activeTab === 'contacts' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Contacts
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'activity' ? (
                <DealActivityTimeline dealId={deal.id} />
              ) : (
                <DealContacts dealId={deal.id} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
