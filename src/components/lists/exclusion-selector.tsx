"use client";

import { ShieldOff, Plus, X } from "lucide-react";
import {
  EXCLUSION_GROUPS,
  type ExclusionGroupKey,
  type ListExclusions,
} from "@/lib/lists/exclusion-types";

interface ExclusionSelectorProps {
  value: ListExclusions;
  onChange: (next: ListExclusions) => void;
  /** Lists available to subtract ("exclude members of"). */
  availableLists: { id: string; name: string }[];
  /** Groups that are always applied and can't be unchecked (e.g. never-call on call lists). */
  lockedGroups?: ExclusionGroupKey[];
  /** The list being edited — hidden from the "exclude members of" picker to avoid self-reference. */
  currentListId?: string;
}

export function ExclusionSelector({
  value,
  onChange,
  availableLists,
  lockedGroups = [],
  currentListId,
}: ExclusionSelectorProps) {
  const toggleGroup = (key: ExclusionGroupKey) => {
    if (lockedGroups.includes(key)) return;
    const has = value.groups.includes(key);
    onChange({
      ...value,
      groups: has ? value.groups.filter((g) => g !== key) : [...value.groups, key],
    });
  };

  const addList = (id: string) => {
    if (!id || value.lists.includes(id)) return;
    onChange({ ...value, lists: [...value.lists, id] });
  };

  const removeList = (id: string) => {
    onChange({ ...value, lists: value.lists.filter((l) => l !== id) });
  };

  const nameFor = (id: string) => availableLists.find((l) => l.id === id)?.name ?? "Removed list";
  const pickable = availableLists.filter(
    (l) => l.id !== currentListId && !value.lists.includes(l.id),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <ShieldOff className="h-3.5 w-3.5 text-rose-500" /> Exclude from this list
      </div>

      <div className="space-y-2">
        {EXCLUSION_GROUPS.map((g) => {
          const locked = lockedGroups.includes(g.key);
          const checked = locked || value.groups.includes(g.key);
          return (
            <label
              key={g.key}
              className={`flex items-start gap-2 text-sm ${locked ? "opacity-70" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => toggleGroup(g.key)}
                className="mt-0.5 rounded border-slate-300 text-rose-600"
              />
              <span>
                <span className="font-medium text-slate-800">{g.label}</span>
                {locked && (
                  <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    always on for call lists
                  </span>
                )}
                <span className="block text-xs text-slate-500">{g.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      {/* Exclude members of other lists */}
      <div className="space-y-2">
        {value.lists.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.lists.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
              >
                {nameFor(id)}
                <button
                  type="button"
                  onClick={() => removeList(id)}
                  className="text-rose-400 hover:text-rose-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {pickable.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Plus className="h-3.5 w-3.5 text-slate-400" />
            <span>Exclude members of</span>
            <select
              value=""
              onChange={(e) => addList(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              <option value="">pick a list…</option>
              {pickable.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          value.lists.length === 0 && (
            <p className="text-xs text-slate-400">
              Tip: make a list (e.g. &ldquo;Hans – private deals&rdquo;) then exclude its members here.
            </p>
          )
        )}
      </div>
    </div>
  );
}
