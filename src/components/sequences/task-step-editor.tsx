"use client";

import { useState, useEffect } from "react";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

interface TaskStepEditorProps {
  step: Step;
  onUpdate: (updates: Partial<Step>) => void;
}

/**
 * Editor for the two action steps that produce a row in Tasks rather than an
 * email: `call` (a follow-up call) and `task` (anything else).
 *
 * Both are non-blocking — the sequence keeps running past them, so a rep who
 * never picks the task up doesn't strand the enrollment.
 */
export function TaskStepEditor({ step, onUpdate }: TaskStepEditorProps) {
  const isCall = step.type === "call";
  const [title, setTitle] = useState(step.task_title || "");
  const [description, setDescription] = useState(step.task_description || "");
  const [dueDays, setDueDays] = useState(step.task_due_days ?? 0);
  const [priority, setPriority] = useState(step.task_priority || "medium");

  useEffect(() => {
    setTitle(step.task_title || "");
    setDescription(step.task_description || "");
    setDueDays(step.task_due_days ?? 0);
    setPriority(step.task_priority || "medium");
  }, [step]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {isCall
          ? "Creates a call task for this contact when the sequence reaches this step. The sequence keeps running — it doesn't wait for the call."
          : "Creates a task for this contact when the sequence reaches this step. The sequence keeps running — it doesn't wait for the task."}
      </p>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          Task title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onUpdate({ task_title: title.trim() || null })}
          placeholder={
            isCall ? "e.g. Follow-up call: {{first_name}}" : "e.g. Check {{company_name}} on LinkedIn"
          }
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">
          Leave blank for an auto-generated title. Variables like{" "}
          <code className="text-slate-500">{"{{first_name}}"}</code> and{" "}
          <code className="text-slate-500">{"{{company_name}}"}</code> work here.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          Notes (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => onUpdate({ task_description: description.trim() || null })}
          rows={3}
          placeholder={
            isCall
              ? "What to cover on the call — talking points, what they replied to, objections to expect."
              : "What needs doing."
          }
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
        />
      </div>

      <div className="flex items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Due in (days)
          </label>
          <input
            type="number"
            value={dueDays}
            onChange={(e) => setDueDays(Math.max(0, Number(e.target.value)))}
            onBlur={() => onUpdate({ task_due_days: dueDays })}
            min={0}
            className="w-24 px-2 py-1.5 border border-slate-300 rounded-md text-sm text-center"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              onUpdate({ task_priority: e.target.value });
            }}
            className="px-2 py-1.5 border border-slate-300 rounded-md text-sm"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
    </div>
  );
}
