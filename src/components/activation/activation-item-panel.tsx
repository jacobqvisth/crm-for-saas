"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { SlideOver } from "@/components/ui/slide-over";
import type { ActivationItem, ActivationGroup, ActivationScenario } from "@/lib/activation/types";
import { ITEM_STATUSES, ANCHOR_EVENTS } from "@/lib/activation/types";
import { COLOR_TOKENS, colorClasses } from "@/lib/roadmap/colors";

interface ActivationItemPanelProps {
  item: ActivationItem | null;
  groups: ActivationGroup[];
  scenarios: ActivationScenario[];
  onClose: () => void;
  onSave: (id: string, patch: Partial<ActivationItem>) => void;
  onDelete: (id: string) => void;
}

type Form = {
  title: string;
  description: string;
  day_start: string;
  day_end: string;
  group_id: string;
  trigger_type: string;
  anchor_event: string;
  status: string;
  color: string; // "" = inherit swimlane
  cio_campaign_id: string;
  link_url: string;
  scenario_ids: string[];
};

function toForm(item: ActivationItem): Form {
  return {
    title: item.title,
    description: item.description ?? "",
    day_start: String(item.day_start),
    day_end: String(item.day_end),
    group_id: item.group_id,
    trigger_type: item.trigger_type,
    anchor_event: item.anchor_event ?? "",
    status: item.status ?? "",
    color: item.color ?? "",
    cio_campaign_id: item.cio_campaign_id ?? "",
    link_url: item.link_url ?? "",
    scenario_ids: item.scenario_ids ?? [],
  };
}

function parseDayField(s: string): number | null {
  if (!/^\d+$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : null;
}

export function ActivationItemPanel({
  item,
  groups,
  scenarios,
  onClose,
  onSave,
  onDelete,
}: ActivationItemPanelProps) {
  const [form, setForm] = useState<Form | null>(item ? toForm(item) : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setForm(item ? toForm(item) : null);
    setConfirmDelete(false);
  }, [item]);

  if (!item || !form) return null;

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const dayStart = parseDayField(form.day_start);
  const dayEnd = parseDayField(form.day_end);
  const dayError =
    dayStart === null || dayEnd === null
      ? "Days must be whole numbers (0 = signup day)."
      : dayEnd < dayStart
        ? "End day must be on or after the start day."
        : null;

  function handleSave() {
    if (!item || !form) return;
    if (!form.title.trim() || dayError || dayStart === null || dayEnd === null) return;
    onSave(item.id, {
      title: form.title.trim(),
      description: form.description || null,
      day_start: dayStart,
      day_end: dayEnd,
      group_id: form.group_id,
      trigger_type: form.trigger_type,
      anchor_event: form.trigger_type === "event" ? form.anchor_event.trim() || null : null,
      status: form.status || null,
      color: (form.color || null) as ActivationItem["color"],
      cio_campaign_id: form.cio_campaign_id.trim() || null,
      link_url: form.link_url.trim() || null,
      scenario_ids: form.scenario_ids,
    });
    onClose();
  }

  const inputClass =
    "w-full rounded border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300";
  const labelClass = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <SlideOver open={!!item} onClose={onClose} title="Touchpoint details">
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
            placeholder="What the user receives/sees, and why…"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>Trigger</label>
          <div className="flex items-center rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              onClick={() => set("trigger_type", "day_offset")}
              className={`flex-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                form.trigger_type === "day_offset"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              Scheduled (day N)
            </button>
            <button
              type="button"
              onClick={() => set("trigger_type", "event")}
              className={`flex-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                form.trigger_type === "event"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              Event-triggered
            </button>
          </div>
        </div>

        {form.trigger_type === "event" && (
          <div>
            <label className={labelClass}>Anchor event</label>
            <input
              className={inputClass}
              list="activation-anchor-events"
              placeholder="first_diagnosis, trial_end, …"
              value={form.anchor_event}
              onChange={(e) => set("anchor_event", e.target.value)}
            />
            <datalist id="activation-anchor-events">
              {ANCHOR_EVENTS.map((ev) => (
                <option key={ev} value={ev} />
              ))}
            </datalist>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {form.trigger_type === "event" ? "Typical day" : "Start day"}
            </label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={form.day_start}
              onChange={(e) => set("day_start", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>End day</label>
            <input
              type="number"
              min={0}
              className={`${inputClass} ${dayError ? "border-red-400 ring-1 ring-red-300" : ""}`}
              value={form.day_end}
              onChange={(e) => set("day_end", e.target.value)}
            />
          </div>
        </div>
        {dayError ? (
          <p className="text-xs text-red-500">{dayError}</p>
        ) : (
          <p className="text-xs text-slate-400">
            Days since signup, inclusive. Day 0 = signup day; a single email has the same start and end day.
          </p>
        )}

        <div>
          <label className={labelClass}>Channel</label>
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

        {scenarios.length > 0 && (
          <div>
            <label className={labelClass}>Scenarios</label>
            <div className="space-y-1.5 rounded border border-slate-200 p-2.5">
              {scenarios.map((sc) => {
                const checked = form.scenario_ids.includes(sc.id);
                return (
                  <label key={sc.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        set(
                          "scenario_ids",
                          checked
                            ? form.scenario_ids.filter((id) => id !== sc.id)
                            : [...form.scenario_ids, sc.id]
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
                    />
                    <span className={`h-2 w-2 shrink-0 rounded-full ${colorClasses(sc.color).dot}`} />
                    <span className="truncate">{sc.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className={labelClass}>Customer.io campaign ID</label>
          <input
            className={inputClass}
            placeholder="Links this touchpoint to a live campaign (metrics in PR 2)"
            value={form.cio_campaign_id}
            onChange={(e) => set("cio_campaign_id", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>
            Link
            {item.link_url && (
              <a
                href={item.link_url}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-0.5 font-normal text-indigo-600 hover:underline"
              >
                open <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </label>
          <input
            className={inputClass}
            placeholder="https://… (Customer.io editor, Figma, doc)"
            value={form.link_url}
            onChange={(e) => set("link_url", e.target.value)}
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
            disabled={!form.title.trim() || !!dayError}
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
