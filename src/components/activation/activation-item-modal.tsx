"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, Pencil, Trash2, X, Zap } from "lucide-react";
import type { ActivationItem, ActivationGroup, ActivationScenario } from "@/lib/activation/types";
import { ITEM_STATUSES, ANCHOR_EVENTS } from "@/lib/activation/types";
import { COLOR_TOKENS, colorClasses } from "@/lib/roadmap/colors";
import { statusStyle } from "@/lib/activation/status";

// Centered modal for a touchpoint: read view first (the canvas is an
// overview), editing behind an explicit Edit button.

interface ActivationItemModalProps {
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
  color: string; // "" = inherit channel
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

export function ActivationItemModal({
  item,
  groups,
  scenarios,
  onClose,
  onSave,
  onDelete,
}: ActivationItemModalProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form | null>(item ? toForm(item) : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setForm(item ? toForm(item) : null);
    // A freshly created touchpoint ("New touchpoint") opens straight in edit mode.
    setEditing(!!item && item.title === "New touchpoint" && !item.description);
    setConfirmDelete(false);
  }, [item]);

  // Close on Escape.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item || !form) return null;

  const group = groups.find((g) => g.id === item.group_id);
  const memberScenarios = scenarios.filter((sc) => (item.scenario_ids ?? []).includes(sc.id));
  const status = statusStyle(item.status);
  const isEvent = item.trigger_type === "event";
  const dayText =
    item.day_start === item.day_end
      ? `Day ${item.day_start}`
      : `Day ${item.day_start}–${item.day_end}`;

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
    setEditing(false);
  }

  const inputClass =
    "w-full rounded border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300";
  const labelClass = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative mx-auto my-[7vh] w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl">
        {/* header */}
        <div className="mb-3 flex items-center gap-2">
          {group && (
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClasses(item.color ?? group.color).chip}`}
            >
              <span className={`h-2 w-2 rounded-full ${colorClasses(item.color ?? group.color).dot}`} />
              {group.name}
            </span>
          )}
          {status && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.pill}`}>
              {status.label}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!editing ? (
          /* ===== Read view ===== */
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-slate-400" />
                {dayText} after signup
              </span>
              <span className="flex items-center gap-1.5">
                {isEvent ? (
                  <>
                    <Zap className="h-4 w-4 text-amber-500" />
                    Triggered by{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                      {item.anchor_event || "event"}
                    </code>
                    <span className="text-xs text-slate-400">(day is typical)</span>
                  </>
                ) : (
                  <span className="text-slate-500">Scheduled by day offset</span>
                )}
              </span>
            </div>

            {item.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {item.description}
              </p>
            ) : (
              <p className="text-sm italic text-slate-400">No description yet.</p>
            )}

            {memberScenarios.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Part of scenarios</p>
                <div className="flex flex-wrap gap-1.5">
                  {memberScenarios.map((sc) => (
                    <span
                      key={sc.id}
                      className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600"
                    >
                      <span className={`h-2 w-2 rounded-full ${colorClasses(sc.color).dot}`} />
                      {sc.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(item.cio_campaign_id || item.link_url) && (
              <div className="space-y-1 text-sm text-slate-600">
                {item.cio_campaign_id && (
                  <p>
                    <span className="text-xs font-medium text-slate-500">Customer.io campaign:</span>{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                      {item.cio_campaign_id}
                    </code>
                  </p>
                )}
                {item.link_url && (
                  <a
                    href={item.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    Open linked resource <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            )}

            {/* actions */}
            <div className="flex items-center gap-2 border-t border-slate-200 pt-4">
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
              >
                Close
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
        ) : (
          /* ===== Edit view ===== */
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
                Days since signup, inclusive. Day 0 = signup day; a single email has the same start
                and end day.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
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
            </div>

            {scenarios.length > 0 && (
              <div>
                <label className={labelClass}>Scenarios</label>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded border border-slate-200 p-2.5">
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Customer.io campaign ID</label>
                <input
                  className={inputClass}
                  placeholder="cio campaign id"
                  value={form.cio_campaign_id}
                  onChange={(e) => set("cio_campaign_id", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Link</label>
                <input
                  className={inputClass}
                  placeholder="https://…"
                  value={form.link_url}
                  onChange={(e) => set("link_url", e.target.value)}
                />
              </div>
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
                  Inherit channel
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
                onClick={() => {
                  setForm(toForm(item));
                  setEditing(false);
                }}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
