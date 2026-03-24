"use client";

import { useState, useEffect } from "react";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

interface ConditionStepEditorProps {
  step: Step;
  totalSteps: number;
  onUpdate: (updates: Partial<Step>) => void;
}

export function ConditionStepEditor({ step, totalSteps, onUpdate }: ConditionStepEditorProps) {
  const [conditionType, setConditionType] = useState<string>(step.condition_type || "opened");
  const [branchYes, setBranchYes] = useState<number>(step.condition_branch_yes ?? -1);
  const [branchNo, setBranchNo] = useState<number>(step.condition_branch_no ?? -1);

  useEffect(() => {
    setConditionType(step.condition_type || "opened");
    setBranchYes(step.condition_branch_yes ?? -1);
    setBranchNo(step.condition_branch_no ?? -1);
  }, [step]);

  const handleConditionTypeChange = (value: string) => {
    setConditionType(value);
    onUpdate({ condition_type: value as "opened" | "clicked" | "replied" });
  };

  const handleBranchYesChange = (value: number) => {
    setBranchYes(value);
    onUpdate({ condition_branch_yes: value >= 0 ? value : null });
  };

  const handleBranchNoChange = (value: number) => {
    setBranchNo(value);
    onUpdate({ condition_branch_no: value >= 0 ? value : null });
  };

  const stepOptions = Array.from({ length: totalSteps }, (_, i) => ({
    value: i,
    label: `Step ${i + 1}`,
  }));

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Condition</label>
        <select
          value={conditionType}
          onChange={(e) => handleConditionTypeChange(e.target.value)}
          className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm"
        >
          <option value="opened">Previous email was opened</option>
          <option value="clicked">Previous email was clicked</option>
          <option value="replied">Previous email was replied to</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-green-600 mb-1">If Yes → Go to</label>
          <select
            value={branchYes}
            onChange={(e) => handleBranchYesChange(Number(e.target.value))}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm"
          >
            <option value={-1}>Next step</option>
            {stepOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-red-500 mb-1">If No → Go to</label>
          <select
            value={branchNo}
            onChange={(e) => handleBranchNoChange(Number(e.target.value))}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm"
          >
            <option value={-1}>Next step</option>
            {stepOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
