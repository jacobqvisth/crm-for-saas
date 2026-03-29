'use client';

import { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Plus, GripVertical, Trash2, Pencil, Check, X, ArrowLeft, Loader2, Palette } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { Modal } from '@/components/ui/modal';
import toast from 'react-hot-toast';
import type { Tables, PipelineStage } from '@/lib/database.types';

type Pipeline = Tables<'pipelines'>;

const STAGE_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6b7280',
];

export default function PipelineSettingsPage() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [editStages, setEditStages] = useState<PipelineStage[]>([]);
  const [pipelineName, setPipelineName] = useState('');

  // New pipeline
  const [showNewPipeline, setShowNewPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [creatingPipeline, setCreatingPipeline] = useState(false);

  // New stage
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [newStageProbability, setNewStageProbability] = useState('50');

  // Delete confirmation
  const [deleteStageIndex, setDeleteStageIndex] = useState<number | null>(null);
  const [stageHasDeals, setStageHasDeals] = useState(false);

  // Editing stage inline
  const [editingStageIndex, setEditingStageIndex] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);

  const fetchPipelines = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at');

    if (error) toast.error('Failed to load pipelines');
    else setPipelines(data || []);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  const startEditing = (pipeline: Pipeline) => {
    setEditingPipeline(pipeline);
    setPipelineName(pipeline.name);
    setEditStages((pipeline.stages as unknown as PipelineStage[]) || []);
  };

  const saveStages = async () => {
    if (!editingPipeline || !workspaceId) return;
    setSaving(true);

    const { error } = await supabase
      .from('pipelines')
      .update({
        name: pipelineName,
        stages: editStages as unknown as PipelineStage[],
      })
      .eq('id', editingPipeline.id)
      .eq('workspace_id', workspaceId);

    if (error) toast.error('Failed to save pipeline');
    else {
      toast.success('Pipeline saved');
      setEditingPipeline(null);
      fetchPipelines();
    }
    setSaving(false);
  };

  const addStage = () => {
    if (!newStageName.trim()) return;
    const newStage: PipelineStage = {
      name: newStageName.trim(),
      order: editStages.length,
      probability: Number(newStageProbability) || 0,
      color: newStageColor,
    };
    setEditStages(prev => [...prev, newStage]);
    setNewStageName('');
    setNewStageProbability('50');
    setNewStageColor(STAGE_COLORS[(editStages.length + 1) % STAGE_COLORS.length]);
  };

  const checkAndDeleteStage = async (index: number) => {
    if (!editingPipeline || !workspaceId) return;
    const stageName = editStages[index].name;

    // Check if any deals are in this stage
    const { count } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', editingPipeline.id)
      .eq('stage', stageName);

    if (count && count > 0) {
      setStageHasDeals(true);
      setDeleteStageIndex(index);
    } else {
      setStageHasDeals(false);
      setDeleteStageIndex(index);
    }
  };

  const confirmDeleteStage = () => {
    if (deleteStageIndex === null) return;
    if (stageHasDeals) {
      toast.error('Cannot delete a stage that has deals');
      setDeleteStageIndex(null);
      return;
    }
    setEditStages(prev => prev.filter((_, i) => i !== deleteStageIndex).map((s, i) => ({ ...s, order: i })));
    setDeleteStageIndex(null);
  };

  const onStageDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(editStages);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setEditStages(items.map((s, i) => ({ ...s, order: i })));
  };

  const createPipeline = async () => {
    if (!workspaceId || !newPipelineName.trim()) return;
    setCreatingPipeline(true);

    const defaultStages: PipelineStage[] = [
      { name: 'Lead', order: 0, probability: 10, color: '#6366f1' },
      { name: 'Qualified', order: 1, probability: 25, color: '#8b5cf6' },
      { name: 'Proposal', order: 2, probability: 50, color: '#a855f7' },
      { name: 'Negotiation', order: 3, probability: 75, color: '#d946ef' },
      { name: 'Closed Won', order: 4, probability: 100, color: '#22c55e' },
      { name: 'Closed Lost', order: 5, probability: 0, color: '#ef4444' },
    ];

    const { error } = await supabase.from('pipelines').insert({
      workspace_id: workspaceId,
      name: newPipelineName.trim(),
      stages: defaultStages as unknown as PipelineStage[],
    });

    if (error) toast.error('Failed to create pipeline');
    else {
      toast.success('Pipeline created');
      setShowNewPipeline(false);
      setNewPipelineName('');
      fetchPipelines();
    }
    setCreatingPipeline(false);
  };

  if (!workspaceId) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/deals" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pipeline Settings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your sales pipelines and stages</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : editingPipeline ? (
        /* Editing a pipeline */
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pipeline Name</label>
              <input
                type="text"
                value={pipelineName}
                onChange={e => setPipelineName(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditingPipeline(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveStages}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>

          {/* Stage list with DnD */}
          <DragDropContext onDragEnd={onStageDragEnd}>
            <Droppable droppableId="stages">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2 mb-4">
                  {editStages.map((stage, index) => (
                    <Draggable key={`${stage.name}-${index}`} draggableId={`stage-${index}`} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`flex items-center gap-3 p-3 rounded-lg border ${
                            snapshot.isDragging ? 'bg-white shadow-lg border-indigo-300' : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div {...provided.dragHandleProps} className="text-slate-400 hover:text-slate-600 cursor-grab">
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />

                          {editingStageIndex === index ? (
                            <>
                              <input
                                type="text"
                                value={stage.name}
                                onChange={e => {
                                  const updated = [...editStages];
                                  updated[index] = { ...updated[index], name: e.target.value };
                                  setEditStages(updated);
                                }}
                                className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                autoFocus
                              />
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-slate-400">Prob:</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={stage.probability}
                                  onChange={e => {
                                    const updated = [...editStages];
                                    updated[index] = { ...updated[index], probability: Number(e.target.value) };
                                    setEditStages(updated);
                                  }}
                                  className="w-16 px-2 py-1 border border-slate-300 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <span className="text-xs text-slate-400">%</span>
                              </div>
                              <div className="flex items-center gap-1">
                                {STAGE_COLORS.slice(0, 7).map(c => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => {
                                      const updated = [...editStages];
                                      updated[index] = { ...updated[index], color: c };
                                      setEditStages(updated);
                                    }}
                                    className={`w-4 h-4 rounded-full border-2 ${stage.color === c ? 'border-slate-800' : 'border-transparent'}`}
                                    style={{ backgroundColor: c }}
                                  />
                                ))}
                              </div>
                              <button
                                onClick={() => setEditingStageIndex(null)}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-sm font-medium text-slate-700">{stage.name}</span>
                              <span className="text-xs text-slate-400">{stage.probability}%</span>
                              <button
                                onClick={() => setEditingStageIndex(index)}
                                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => checkAndDeleteStage(index)}
                                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

          {/* Add new stage */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-dashed border-slate-300">
            <input
              type="text"
              value={newStageName}
              onChange={e => setNewStageName(e.target.value)}
              placeholder="New stage name"
              className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={e => { if (e.key === 'Enter') addStage(); }}
            />
            <input
              type="number"
              min="0"
              max="100"
              value={newStageProbability}
              onChange={e => setNewStageProbability(e.target.value)}
              className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="%"
            />
            <div className="flex items-center gap-1">
              {STAGE_COLORS.slice(0, 5).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewStageColor(c)}
                  className={`w-4 h-4 rounded-full border-2 ${newStageColor === c ? 'border-slate-800' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={addStage}
              disabled={!newStageName.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>
      ) : (
        /* Pipeline list */
        <div className="space-y-4">
          {pipelines.map(pipeline => {
            const pStages = (pipeline.stages as unknown as PipelineStage[]) || [];
            return (
              <div key={pipeline.id} className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-slate-900">{pipeline.name}</h3>
                  <button
                    onClick={() => startEditing(pipeline)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pStages.map(stage => (
                    <div key={stage.name} className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 rounded-full border border-slate-200">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-xs font-medium text-slate-600">{stage.name}</span>
                      <span className="text-xs text-slate-400">{stage.probability}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <button
            onClick={() => setShowNewPipeline(true)}
            className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span className="text-sm font-medium">Create New Pipeline</span>
          </button>
        </div>
      )}

      {/* New Pipeline Modal */}
      <Modal open={showNewPipeline} onClose={() => setShowNewPipeline(false)} title="Create Pipeline">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Pipeline Name</label>
            <input
              type="text"
              value={newPipelineName}
              onChange={e => setNewPipelineName(e.target.value)}
              placeholder="e.g. Enterprise Sales"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') createPipeline(); }}
            />
          </div>
          <p className="text-xs text-slate-500">A default set of stages will be created. You can customize them after.</p>
          <div className="flex gap-3">
            <button
              onClick={createPipeline}
              disabled={!newPipelineName.trim() || creatingPipeline}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {creatingPipeline && <Loader2 className="w-4 h-4 animate-spin" />}
              Create
            </button>
            <button
              onClick={() => { setShowNewPipeline(false); setNewPipelineName(''); }}
              className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Stage Confirmation */}
      <Modal
        open={deleteStageIndex !== null}
        onClose={() => setDeleteStageIndex(null)}
        title={stageHasDeals ? 'Cannot Delete Stage' : 'Delete Stage'}
      >
        <div className="space-y-4">
          {stageHasDeals ? (
            <p className="text-sm text-slate-600">
              This stage has active deals. Move or delete all deals in this stage before removing it.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Are you sure you want to delete the stage &quot;{deleteStageIndex !== null ? editStages[deleteStageIndex]?.name : ''}&quot;?
            </p>
          )}
          <div className="flex gap-3">
            {!stageHasDeals && (
              <button
                onClick={confirmDeleteStage}
                className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            )}
            <button
              onClick={() => setDeleteStageIndex(null)}
              className={`${stageHasDeals ? 'flex-1' : ''} px-4 py-2 border border-slate-300 text-sm font-medium rounded-lg text-slate-700 hover:bg-slate-50`}
            >
              {stageHasDeals ? 'OK' : 'Cancel'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
