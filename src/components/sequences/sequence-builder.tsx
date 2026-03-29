"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { StepCard } from "./step-card";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Plus, Mail, Clock, GitBranch } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

interface AddStepButtonProps {
  index: number;
  addMenuIndex: number | null;
  setAddMenuIndex: (i: number | null) => void;
  addStep: (type: Step["type"], afterIndex: number) => void;
}

function AddStepButton({ index, addMenuIndex, setAddMenuIndex, addStep }: AddStepButtonProps) {
  return (
    <div className="flex items-center justify-center py-2 relative">
      <div className="w-0.5 h-4 bg-slate-200" />
      <div className="absolute">
        <div className="relative">
          <button
            onClick={() => setAddMenuIndex(addMenuIndex === index ? null : index)}
            className="w-7 h-7 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {addMenuIndex === index && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-10">
              <button
                onClick={() => addStep("email", index)}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Mail className="w-3.5 h-3.5 text-indigo-500" /> Email
              </button>
              <button
                onClick={() => addStep("delay", index)}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Clock className="w-3.5 h-3.5 text-amber-500" /> Delay
              </button>
              <button
                onClick={() => addStep("condition", index)}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <GitBranch className="w-3.5 h-3.5 text-purple-500" /> Condition
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SequenceBuilderProps {
  sequenceId: string;
}

export function SequenceBuilder({ sequenceId }: SequenceBuilderProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMenuIndex, setAddMenuIndex] = useState<number | null>(null);

  const loadSteps = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("sequence_steps")
      .select("*")
      .eq("sequence_id", sequenceId)
      .order("step_order");

    if (error) {
      toast.error("Failed to load steps");
    } else {
      setSteps(data || []);
    }
    setLoading(false);
  }, [workspaceId, sequenceId, supabase]);

  useEffect(() => {
    loadSteps();
  }, [loadSteps]);

  const addStep = async (type: Step["type"], afterIndex: number) => {
    if (!workspaceId) return;

    // When adding an email step after another step, auto-insert a 3-day delay first
    // — unless the preceding step is already a delay (no double-delays)
    const prevStep = afterIndex >= 0 ? steps[afterIndex] : null;
    const autoDelay = type === "email" && afterIndex >= 0 && prevStep?.type !== "delay";
    const insertCount = autoDelay ? 2 : 1;

    const newOrder = afterIndex + 1;

    // Shift existing steps down to make room
    const stepsToShift = steps.filter((s) => s.step_order >= newOrder);
    for (const s of stepsToShift) {
      await supabase
        .from("sequence_steps")
        .update({ step_order: s.step_order + insertCount })
        .eq("id", s.id);
    }

    // Insert auto-delay before the email if needed
    if (autoDelay) {
      await supabase.from("sequence_steps").insert({
        sequence_id: sequenceId,
        step_order: newOrder,
        type: "delay",
        delay_days: 3,
        delay_hours: 0,
        condition_type: null,
      });
    }

    // Insert the actual step
    const { error } = await supabase.from("sequence_steps").insert({
      sequence_id: sequenceId,
      step_order: autoDelay ? newOrder + 1 : newOrder,
      type,
      delay_days: type === "delay" ? 3 : null,
      delay_hours: type === "delay" ? 0 : null,
      condition_type: type === "condition" ? ("opened" as const) : null,
    });

    if (error) {
      toast.error("Failed to add step");
    } else {
      toast.success(autoDelay ? "Email step added (3-day delay inserted before it)" : `${type} step added`);
      loadSteps();
    }
    setAddMenuIndex(null);
  };

  const updateStep = async (stepId: string, updates: Partial<Step>) => {
    const { error } = await supabase
      .from("sequence_steps")
      .update(updates)
      .eq("id", stepId);

    if (error) {
      toast.error("Failed to update step");
    } else {
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, ...updates } : s))
      );
    }
  };

  const deleteStep = async (stepId: string) => {
    if (!confirm("Delete this step?")) return;

    const step = steps.find((s) => s.id === stepId);
    if (!step) return;

    const { error } = await supabase
      .from("sequence_steps")
      .delete()
      .eq("id", stepId);

    if (error) {
      toast.error("Failed to delete step");
      return;
    }

    // Reorder remaining steps
    const remaining = steps
      .filter((s) => s.id !== stepId)
      .sort((a, b) => a.step_order - b.step_order);

    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].step_order !== i) {
        await supabase
          .from("sequence_steps")
          .update({ step_order: i })
          .eq("id", remaining[i].id);
      }
    }

    toast.success("Step deleted");
    loadSteps();
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const sourceIdx = result.source.index;
    const destIdx = result.destination.index;
    if (sourceIdx === destIdx) return;

    const reordered = [...steps];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(destIdx, 0, moved);

    // Optimistic update
    const updated = reordered.map((s, i) => ({ ...s, step_order: i }));
    setSteps(updated);

    // Persist
    for (const s of updated) {
      await supabase
        .from("sequence_steps")
        .update({ step_order: s.step_order })
        .eq("id", s.id);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {steps.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500 mb-4">Start building your sequence by adding the first step.</p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => addStep("email", -1)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Mail className="w-4 h-4 text-indigo-500" /> Add Email
            </button>
            <button
              onClick={() => addStep("delay", -1)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Clock className="w-4 h-4 text-amber-500" /> Add Delay
            </button>
          </div>
        </div>
      ) : (
        <>
          <AddStepButton index={-1} addMenuIndex={addMenuIndex} setAddMenuIndex={setAddMenuIndex} addStep={addStep} />

          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="steps">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {steps.map((step, index) => (
                    <div key={step.id}>
                      <Draggable draggableId={step.id} index={index}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                          >
                            <StepCard
                              step={step}
                              totalSteps={steps.length}
                              onUpdate={updateStep}
                              onDelete={deleteStep}
                              dragHandleProps={dragProvided.dragHandleProps}
                            />
                          </div>
                        )}
                      </Draggable>
                      <AddStepButton index={index} addMenuIndex={addMenuIndex} setAddMenuIndex={setAddMenuIndex} addStep={addStep} />
                    </div>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </>
      )}
    </div>
  );
}
