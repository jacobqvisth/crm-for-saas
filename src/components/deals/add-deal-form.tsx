'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import toast from 'react-hot-toast';
import type { Tables, PipelineStage, Json } from '@/lib/database.types';

interface AddDealFormProps {
  pipelineId: string;
  stages: PipelineStage[];
  defaultStage?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function AddDealForm({ pipelineId, stages, defaultStage, onSuccess, onCancel }: AddDealFormProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [form, setForm] = useState({
    name: '',
    amount: '',
    stage: defaultStage || stages[0]?.name || '',
    expected_close_date: '',
    company_id: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Company search
  const [companies, setCompanies] = useState<Tables<'companies'>[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [selectedCompanyName, setSelectedCompanyName] = useState('');
  const companyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!workspaceId) return;
    const fetchCompanies = async () => {
      let query = supabase
        .from('companies')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('name')
        .limit(20);
      if (companySearch) {
        query = query.ilike('name', `%${companySearch}%`);
      }
      const { data } = await query;
      if (data) setCompanies(data);
    };
    fetchCompanies();
  }, [workspaceId, companySearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (companyRef.current && !companyRef.current.contains(e.target as Node)) {
        setShowCompanyDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }

    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Deal name is required';
    if (form.amount && isNaN(Number(form.amount))) newErrors.amount = 'Amount must be a number';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    const stageConfig = stages.find(s => s.name === form.stage);

    const { data: user } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('deals')
      .insert({
        workspace_id: workspaceId,
        pipeline_id: pipelineId,
        name: form.name.trim(),
        amount: form.amount ? Number(form.amount) : null,
        stage: form.stage,
        probability: stageConfig?.probability ?? 0,
        company_id: form.company_id || null,
        owner_id: user?.user?.id || null,
        expected_close_date: form.expected_close_date || null,
      })
      .select('id')
      .single();

    if (error) {
      toast.error('Failed to create deal');
      setSaving(false);
      return;
    }

    // Create activity for deal creation
    await supabase.from('activities').insert({
      workspace_id: workspaceId!,
      type: 'deal_stage_change',
      deal_id: data.id,
      user_id: user?.user?.id || null,
      subject: `Deal created in ${form.stage}`,
      metadata: { from_stage: null, to_stage: form.stage } as Json,
    });

    toast.success('Deal created');
    setSaving(false);
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Deal Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErrors(e2 => ({ ...e2, name: '' })); }}
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.name ? 'border-red-300' : 'border-slate-300'}`}
          placeholder="e.g. Acme Corp Enterprise Deal"
          autoFocus
        />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
          <input
            type="text"
            value={form.amount}
            onChange={e => { setForm(f => ({ ...f, amount: e.target.value })); setErrors(e2 => ({ ...e2, amount: '' })); }}
            className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.amount ? 'border-red-300' : 'border-slate-300'}`}
            placeholder="0"
          />
        </div>
        {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Stage</label>
        <select
          value={form.stage}
          onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {stages.map(s => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>

      <div ref={companyRef} className="relative">
        <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={selectedCompanyName || companySearch}
            onChange={e => {
              setCompanySearch(e.target.value);
              setSelectedCompanyName('');
              setForm(f => ({ ...f, company_id: '' }));
              setShowCompanyDropdown(true);
            }}
            onFocus={() => setShowCompanyDropdown(true)}
            className="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Search companies..."
          />
          {selectedCompanyName && (
            <button
              type="button"
              onClick={() => { setSelectedCompanyName(''); setCompanySearch(''); setForm(f => ({ ...f, company_id: '' })); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          )}
        </div>
        {showCompanyDropdown && companies.length > 0 && !selectedCompanyName && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {companies.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setForm(f => ({ ...f, company_id: c.id }));
                  setSelectedCompanyName(c.name);
                  setCompanySearch('');
                  setShowCompanyDropdown(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Expected Close Date</label>
        <input
          type="date"
          value={form.expected_close_date}
          onChange={e => setForm(f => ({ ...f, expected_close_date: e.target.value }))}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Create Deal
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-lg text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
