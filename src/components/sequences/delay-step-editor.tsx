"use client";

import { useState, useEffect } from "react";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

interface DelayStepEditorProps {
  step: Step;
  onUpdate: (updates: Partial<Step>) => void;
}

export function DelayStepEditor({ step, onUpdate }: DelayStepEditorProps) {
  const [days, setDays] = useState(step.delay_days || 0);
  const [hours, setHours] = useState(step.delay_hours || 0);

  useEffect(() => {
    setDays(step.delay_days || 0);
    setHours(step.delay_hours || 0);
  }, [step]);

  const handleDaysBlur = () => {
    onUpdate({ delay_days: days });
  };

  const handleHoursBlur = () => {
    onUpdate({ delay_hours: hours });
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Days</label>
        <input
          type="number"
          value={days}
          onChange={(e) => setDays(Math.max(0, Number(e.target.value)))}
          onBlur={handleDaysBlur}
          min={0}
          className="w-20 px-2 py-1.5 border border-slate-300 rounded-md text-sm text-center"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Hours</label>
        <input
          type="number"
          value={hours}
          onChange={(e) => setHours(Math.max(0, Math.min(23, Number(e.target.value))))}
          onBlur={handleHoursBlur}
          min={0}
          max={23}
          className="w-20 px-2 py-1.5 border border-slate-300 rounded-md text-sm text-center"
        />
      </div>
    </div>
  );
}
