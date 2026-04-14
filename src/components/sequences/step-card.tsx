"use client";

import { useState } from "react";
import type { DraggableProvidedDragHandleProps } from "@hello-pangea/dnd";
import { Mail, Clock, GitBranch, Trash2, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { EmailStepEditor } from "./email-step-editor";
import { DelayStepEditor } from "./delay-step-editor";
import { ConditionStepEditor } from "./condition-step-editor";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

const STEP_CONFIG = {
  email: {
    icon: Mail,
    label: "Email",
    bgColor: "bg-indigo-100",
    textColor: "text-indigo-600",
    borderColor: "border-indigo-200",
  },
  delay: {
    icon: Clock,
    label: "Delay",
    bgColor: "bg-amber-100",
    textColor: "text-amber-600",
    borderColor: "border-amber-200",
  },
  condition: {
    icon: GitBranch,
    label: "Condition",
    bgColor: "bg-purple-100",
    textColor: "text-purple-600",
    borderColor: "border-purple-200",
  },
};

interface StepCardProps {
  step: Step;
  totalSteps: number;
  stepNumber?: number;
  sequenceName?: string;
  isFirstEmailStep?: boolean;
  onUpdate: (stepId: string, updates: Partial<Step>) => void;
  onDelete: (stepId: string) => void;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
}

export function StepCard({ step, totalSteps, stepNumber, sequenceName, isFirstEmailStep, onUpdate, onDelete, dragHandleProps }: StepCardProps) {
  const [expanded, setExpanded] = useState(true);

  const config = STEP_CONFIG[step.type];
  const Icon = config.icon;

  const getSummary = () => {
    if (step.type === "email") {
      return step.subject_override || "No subject set";
    }
    if (step.type === "delay") {
      const d = step.delay_days || 0;
      const h = step.delay_hours || 0;
      if (d === 0 && h === 0) return "No delay set";
      const parts = [];
      if (d > 0) parts.push(`${d} day${d !== 1 ? "s" : ""}`);
      if (h > 0) parts.push(`${h} hour${h !== 1 ? "s" : ""}`);
      return `Wait ${parts.join(" ")}`;
    }
    if (step.type === "condition") {
      return `If previous email was ${step.condition_type || "opened"}`;
    }
    return "";
  };

  return (
    <div className={`bg-white rounded-lg border ${config.borderColor} shadow-sm`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div {...dragHandleProps} className="cursor-grab text-slate-300 hover:text-slate-500">
          <GripVertical className="w-4 h-4" />
        </div>

        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${config.bgColor} ${config.textColor}`}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 uppercase">
              Step {step.step_order + 1}
            </span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${config.bgColor} ${config.textColor}`}>
              {config.label}
            </span>
          </div>
          {!expanded && (
            <p className="text-sm text-slate-600 truncate mt-0.5">{getSummary()}</p>
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-slate-100 text-slate-400"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <button
          onClick={() => onDelete(step.id)}
          className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100">
          {step.type === "email" && (
            <EmailStepEditor
              step={step}
              onUpdate={(updates) => onUpdate(step.id, updates)}
              stepNumber={stepNumber}
              sequenceName={sequenceName}
              isFirstEmailStep={isFirstEmailStep}
            />
          )}
          {step.type === "delay" && (
            <DelayStepEditor
              step={step}
              onUpdate={(updates) => onUpdate(step.id, updates)}
            />
          )}
          {step.type === "condition" && (
            <ConditionStepEditor
              step={step}
              totalSteps={totalSteps}
              onUpdate={(updates) => onUpdate(step.id, updates)}
            />
          )}
        </div>
      )}
    </div>
  );
}
