"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { SlideOver } from "@/components/ui/slide-over";
import type { RoadmapItem, RoadmapGroup } from "@/lib/roadmap/types";
import { ITEM_STATUSES, ITEM_PRIORITIES } from "@/lib/roadmap/types";
import { COLOR_TOKENS, colorClasses } from "@/lib/roadmap/colors";

interface ItemDetailPanelProps {
  item: RoadmapItem | null;
  groups: RoadmapGroup[];
  onClose: () => void;
  onSave: (id: string, patch: Partial<RoadmapItem>) => void;
  onDelete: (id: string) => void;
}

type Form = {
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  group_id: string;
  status: string;
  owner: string;
  phase: string;
  priority: string;
  team: string;
  color: string; // "" = inherit swimlane
  progress_note: string;
};

function toForm(item: RoadmapItem): Form {
  return {
    title: item.title,
    description: item.description ?? "",
    start_date: item.start_date,
    end_date: item.end_date,
    group_id: item.group_id,
    status: item.status ?? "",
    owner: item.owner ?? "",
    phase: item.phase ?? "",
    priority: item.priority ?? "",
    team: item.team ?? "",
    color: item.color ?? "",
    progress_note: item.progress_note ?? "",
  };
}

export function ItemDetailPanel({
  item,
  groups,
  onClose,
  onSave,
  onDelete,
}: ItemDetailPanelProps) {
  const [form, setForm] = useState<Form | null>(item ? toForm(item) : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setForm(item ? toForm(item) : null);
    setConfirmDelete(false);
  }, [item]);

  if (!item || !form) return null;

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  function handleSave() {
    if (!item || !form) return;
    if (!form.title.trim()) return;
    if (form.end_date < form.start_date) return;
    onSave(item.id, {
      title: form.title.trim(),
      description: form.description || null,
      start_date: form.start_date,
      end_date: form.end_date,
      group_id: form.group_id,
      status: form.status || null,
      owner: form.owner || null,
      phase: form.phase || null,
      priority: form.priority || null,
      team: form.team || null,
      color: (form.color || null) as RoadmapItem["color"],
      progress_note: form.progress_note || null,
    });
    onClose();
  }

  const inputClass =
    "w-full rounded border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300";
  const labelClass = "block text-xs font-medium text-slate-500 mb-1";
  const dateError = form.end_date < form.start_date;

  return (
    <SlideOver open={!!item} onClose={onClose} title="Item details">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Title</label>
          <input
            autoFocus
            className={inputClass}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={3}
            placeholder="Add a description…"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>
            Progress note
            {item.progress_updated_at && (
              <span className="ml-2 font-normal text-slate-400">
                updated {new Date(item.progress_updated_at).toLocaleDateString()}
              </span>
            )}
          </label>
          <textarea
            className={`${inputClass} resize-none`}
            rows={2}
            placeholder="What's actually been done so far… (the Update button fills this in)"
            value={form.progress_note}
            onChange={(e) => set("progress_note", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Start date</label>
            <input
              type="date"
              className={inputClass}
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>End date</label>
            <input
              type="date"
              className={`${inputClass} ${dateError ? "border-red-400 ring-1 ring-red-300" : ""}`}
              value={form.end_date}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </div>
        </div>
        {dateError && (
          <p className="text-xs text-red-500">End date must be on or after the start date.</p>
        )}

        <div>
          <label className={labelClass}>Swimlane</label>
          <select
            className={inputClass}
            value={form.group_id}
            onChange={(e) => set("group_id", e.target.value)}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Status</label>
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="">—</option>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Priority</label>
            <select
              className={inputClass}
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              <option value="">—</option>
              {ITEM_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Owner</label>
            <input
              className={inputClass}
              placeholder="—"
              value={form.owner}
              onChange={(e) => set("owner", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Team</label>
            <input
              className={inputClass}
              placeholder="—"
              value={form.team}
              onChange={(e) => set("team", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Phase</label>
          <input
            className={inputClass}
            placeholder="—"
            value={form.phase}
            onChange={(e) => set("phase", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>Color</label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => set("color", "")}
              className={`rounded border px-2 py-1 text-xs ${
                form.color === ""
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-500"
              }`}
            >
              Inherit
            </button>
            {COLOR_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => set("color", token)}
                title={token}
                className={`h-6 w-6 rounded-full ${colorClasses(token).dot} ${
                  form.color === token ? "ring-2 ring-indigo-500 ring-offset-1" : ""
                }`}
              />
            ))}
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-2 border-t border-slate-200 pt-4">
          <button
            onClick={handleSave}
            disabled={!form.title.trim() || dateError}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
          >
            Cancel
          </button>
          {confirmDelete ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500">Delete?</span>
              <button
                onClick={() => onDelete(item.id)}
                className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>
    </SlideOver>
  );
}
