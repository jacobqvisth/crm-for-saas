"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, Info, Loader2, Mail, Pencil, Trash2, X, Zap } from "lucide-react";
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

interface CioCampaignOut {
  id: number;
  name: string;
  state: string | null;
}

interface CioEmailOut {
  id: number;
  name: string | null;
  subject: string | null;
  from: string | null;
  body: string | null;
}

interface CioContentState {
  loading: boolean;
  error: string | null;
  campaign: CioCampaignOut | null;
  emails: CioEmailOut[];
  dashboardUrl: string | null;
  metrics: Record<string, number> | null;
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
  source_note: string;
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
    source_note: item.source_note ?? "",
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
  const [cioContent, setCioContent] = useState<CioContentState | null>(null);
  // null = not fetched yet; [] = unavailable (no key / API error) → text input fallback.
  const [cioCampaigns, setCioCampaigns] = useState<CioCampaignOut[] | null>(null);

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

  // Live email content from Customer.io for linked touchpoints (read view).
  const cioId = item?.cio_campaign_id ?? null;
  useEffect(() => {
    if (!cioId || !/^\d+$/.test(cioId)) {
      setCioContent(null);
      return;
    }
    let cancelled = false;
    setCioContent({ loading: true, error: null, campaign: null, emails: [], dashboardUrl: null, metrics: null });
    fetch(`/api/activation/cio/campaigns/${cioId}`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          error?: string;
          campaign?: CioCampaignOut | null;
          emails?: CioEmailOut[];
          dashboard_url?: string;
          metrics?: Record<string, number>;
        };
        if (!r.ok) throw new Error(data.error ?? "Couldn't load from Customer.io");
        if (!cancelled)
          setCioContent({
            loading: false,
            error: null,
            campaign: data.campaign ?? null,
            emails: data.emails ?? [],
            dashboardUrl: data.dashboard_url ?? null,
            metrics: data.metrics ?? null,
          });
      })
      .catch((e: Error) => {
        if (!cancelled)
          setCioContent({ loading: false, error: e.message, campaign: null, emails: [], dashboardUrl: null, metrics: null });
      });
    return () => {
      cancelled = true;
    };
  }, [cioId]);

  // Campaign list for the pickers: fetched once when edit mode opens, or when
  // an email touchpoint without a linked campaign is viewed (inline picker).
  const groupName = groups.find((g) => g.id === item?.group_id)?.name ?? "";
  const emailish = /email|customer/i.test(groupName);
  const needsInlinePicker = Boolean(item) && emailish && !item?.cio_campaign_id;
  useEffect(() => {
    if (cioCampaigns !== null) return;
    if (!editing && !needsInlinePicker) return;
    fetch("/api/activation/cio/campaigns")
      .then((r) => r.json())
      .then((d: { available?: boolean; campaigns?: CioCampaignOut[] }) =>
        setCioCampaigns(d.available ? (d.campaigns ?? []) : [])
      )
      .catch(() => setCioCampaigns([]));
  }, [editing, needsInlinePicker, cioCampaigns]);

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
      source_note: form.source_note.trim() || null,
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

            {item.source_note && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Info className="h-3.5 w-3.5" /> Where this info comes from
                </p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                  {item.source_note}
                </p>
              </div>
            )}

            {cioContent && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Mail className="h-3.5 w-3.5" /> Email content (live from Customer.io)
                  {cioContent.dashboardUrl && (
                    <a
                      href={cioContent.dashboardUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 font-normal text-indigo-600 hover:underline"
                    >
                      Open in Customer.io <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </p>
                {cioContent.loading ? (
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading campaign…
                  </p>
                ) : cioContent.error ? (
                  <p className="text-xs text-amber-600">{cioContent.error}</p>
                ) : (
                  <div className="space-y-3">
                    {cioContent.campaign && (
                      <p className="text-sm text-slate-700">
                        <span className="font-medium">{cioContent.campaign.name}</span>
                        {cioContent.campaign.state && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {cioContent.campaign.state}
                          </span>
                        )}
                      </p>
                    )}
                    {cioContent.metrics && (cioContent.metrics.cio_sent ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {(() => {
                          const m = cioContent.metrics;
                          const sent = m.cio_sent ?? 0;
                          const pct = (n: number) => (sent > 0 ? `${Math.round((n / sent) * 100)}%` : "—");
                          return (
                            <>
                              <span>
                                <span className="font-semibold text-slate-800">{sent}</span> sent
                              </span>
                              <span>
                                <span className="font-semibold text-slate-800">{m.cio_delivered ?? 0}</span> delivered
                              </span>
                              <span>
                                <span className="font-semibold text-slate-800">{pct(m.cio_opened ?? 0)}</span> opened
                              </span>
                              <span>
                                <span className="font-semibold text-slate-800">{pct(m.cio_clicked ?? 0)}</span> clicked
                              </span>
                              <span>
                                <span className="font-semibold text-slate-800">{m.cio_converted ?? 0}</span> converted
                              </span>
                              <span className="text-slate-400">last 90 days</span>
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {cioContent.emails.length === 0 ? (
                      <p className="text-xs text-slate-400">
                        No email actions found in this campaign.
                      </p>
                    ) : (
                      cioContent.emails.map((em) => (
                        <div key={em.id} className="rounded border border-slate-200">
                          <div className="border-b border-slate-100 px-3 py-2">
                            <p className="text-sm font-medium text-slate-800">
                              {em.subject ?? em.name ?? `Email ${em.id}`}
                            </p>
                            {em.from && <p className="text-xs text-slate-400">From: {em.from}</p>}
                          </div>
                          {em.body ? (
                            <iframe
                              sandbox=""
                              srcDoc={em.body}
                              title={em.subject ?? `Email ${em.id}`}
                              className="h-72 w-full rounded-b bg-white"
                            />
                          ) : (
                            <p className="px-3 py-2 text-xs italic text-slate-400">
                              Body not available via the API.
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {!item.cio_campaign_id && emailish && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Mail className="h-3.5 w-3.5" /> Email content (live from Customer.io)
                </p>
                {cioCampaigns === null ? (
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading campaigns…
                  </p>
                ) : cioCampaigns.length === 0 ? (
                  <p className="text-xs text-amber-600">
                    Customer.io API not available — you can still set a campaign ID via Edit.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-500">
                      Not linked to a campaign yet — pick the campaign that sends this email and
                      its live content will show here:
                    </p>
                    <select
                      className="w-full rounded border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) onSave(item.id, { cio_campaign_id: e.target.value });
                      }}
                    >
                      <option value="">Select a Customer.io campaign…</option>
                      {cioCampaigns.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                          {c.state ? ` · ${c.state}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
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
              <label className={labelClass}>Source / accuracy note</label>
              <textarea
                className={`${inputClass} resize-none`}
                rows={2}
                placeholder="Where does this info come from? How was it verified?"
                value={form.source_note}
                onChange={(e) => set("source_note", e.target.value)}
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
                <label className={labelClass}>Customer.io campaign</label>
                {cioCampaigns && cioCampaigns.length > 0 ? (
                  <select
                    className={inputClass}
                    value={form.cio_campaign_id}
                    onChange={(e) => set("cio_campaign_id", e.target.value)}
                  >
                    <option value="">— not linked —</option>
                    {/* keep an unknown manually-entered id selectable */}
                    {form.cio_campaign_id &&
                      !cioCampaigns.some((c) => String(c.id) === form.cio_campaign_id) && (
                        <option value={form.cio_campaign_id}>
                          {form.cio_campaign_id} (manual)
                        </option>
                      )}
                    {cioCampaigns.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                        {c.state ? ` · ${c.state}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={inputClass}
                    placeholder={
                      cioCampaigns === null ? "Loading campaigns…" : "campaign id (API unavailable)"
                    }
                    value={form.cio_campaign_id}
                    onChange={(e) => set("cio_campaign_id", e.target.value)}
                  />
                )}
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
