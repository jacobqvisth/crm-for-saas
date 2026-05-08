'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { SlideOver } from '@/components/ui/slide-over';
import { createClient } from '@/lib/supabase/client';
import { AddDealForm } from '@/components/deals/add-deal-form';
import type { PipelineStage } from '@/lib/database.types';

interface AddDealModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  workspaceId: string;
  onCreated: () => void;
}

export function AddDealModal({
  open, onClose, companyId, companyName, workspaceId, onCreated,
}: AddDealModalProps) {
  const supabase = createClient();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setEmpty(false);
      const { data } = await supabase
        .from('pipelines')
        .select('id, stages')
        .eq('workspace_id', workspaceId)
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        setEmpty(true);
        setLoading(false);
        return;
      }
      setPipelineId(data.id);
      setStages((data.stages as unknown as PipelineStage[]) || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const handleSuccess = () => {
    onCreated();
    onClose();
    toast.success('Deal created');
  };

  return (
    <SlideOver open={open} onClose={onClose} title={`Add deal for ${companyName}`}>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : empty ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-600 mb-2">No pipeline configured yet.</p>
          <Link
            href="/settings/pipelines"
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            Create one in Settings → Pipelines
          </Link>
        </div>
      ) : pipelineId ? (
        <DealFormWithPrefill
          pipelineId={pipelineId}
          stages={stages}
          companyId={companyId}
          companyName={companyName}
          onSuccess={handleSuccess}
          onCancel={onClose}
        />
      ) : null}
    </SlideOver>
  );
}

function DealFormWithPrefill({
  pipelineId, stages, companyId, companyName, onSuccess, onCancel,
}: {
  pipelineId: string;
  stages: PipelineStage[];
  companyId: string;
  companyName: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <div className="mb-4 px-3 py-2 bg-slate-50 rounded-lg text-xs">
        <span className="text-slate-500">Linked to: </span>
        <span className="font-medium text-slate-900">{companyName}</span>
      </div>
      <AddDealForm
        pipelineId={pipelineId}
        stages={stages}
        defaultCompanyId={companyId}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </div>
  );
}
