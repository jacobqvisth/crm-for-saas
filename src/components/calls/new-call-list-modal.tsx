"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Sparkles, ListPlus } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { FilterBuilder } from "@/components/lists/filter-builder";
import { buildFilterQuery, type ListFilter } from "@/lib/lists/filter-query";

type Preset = {
  key: string;
  label: string;
  hint: string;
  name: string;
  description: string;
  filters: ListFilter[];
};

// The free trial runs ~14 days from signup, so "signed up 13–17 days ago and
// still on Free" ≈ the cohort whose trial just closed without converting.
const PRESETS: Preset[] = [
  {
    key: "trial_ended",
    label: "Free trial just ended",
    hint: "Signed up ~14 days ago, still on Free",
    name: "Trial just ended",
    description: "Signed up 13–17 days ago and still on the Free plan — trial window just closed without converting.",
    filters: [
      { field: "signed_up_at", operator: "older_than_days", value: 13 },
      { field: "signed_up_at", operator: "within_last_days", value: 17 },
      { field: "user_plan_type", operator: "equals", value: "free" },
    ],
  },
  {
    key: "trialing",
    label: "In trial right now",
    hint: "Paid-plan trial in progress — call before it lapses",
    name: "Trialing now",
    description: "Users currently trialing a paid plan.",
    filters: [{ field: "user_subscription_status", operator: "equals", value: "trialing" }],
  },
  {
    key: "new_signups",
    label: "New signups",
    hint: "Signed up within the last 7 days",
    name: "New signups (7 days)",
    description: "App users who signed up within the last 7 days.",
    filters: [{ field: "signed_up_at", operator: "within_last_days", value: 7 }],
  },
  {
    key: "engaged_free",
    label: "Engaged free users",
    hint: "≥ 3 diagnoses but not paying",
    name: "Engaged free users",
    description: "Free-plan users with at least 3 diagnoses — getting value but not paying yet.",
    filters: [
      { field: "user_plan_type", operator: "equals", value: "free" },
      { field: "diagnostics_total", operator: "gte", value: 3 },
    ],
  },
  {
    key: "gone_quiet",
    label: "Gone quiet",
    hint: "Used the app, inactive 14+ days",
    name: "Gone quiet",
    description: "Free users who logged in at least twice but haven't been active for 14+ days.",
    filters: [
      { field: "user_plan_type", operator: "equals", value: "free" },
      { field: "login_count", operator: "gte", value: 2 },
      { field: "last_active_at", operator: "older_than_days", value: 14 },
    ],
  },
  {
    key: "paying",
    label: "Paying customers",
    hint: "Active subscription — check-in / feedback calls",
    name: "Paying customers check-in",
    description: "Users with an active paid subscription.",
    filters: [{ field: "user_subscription_status", operator: "equals", value: "active" }],
  },
];

const PHONE_FILTER: ListFilter = { field: "phone", operator: "is_not_null", value: null };

export function NewCallListModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [smart, setSmart] = useState(true);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListFilter[]>([]);
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const effectiveFilters = useMemo(
    () => (phoneOnly ? [...filters, PHONE_FILTER] : filters),
    [filters, phoneOnly],
  );

  // Live "how many contacts match" preview, debounced.
  useEffect(() => {
    if (!smart || !workspaceId || effectiveFilters.length === 0) {
      setPreviewCount(null);
      return;
    }
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const { count, error } = await buildFilterQuery(
          supabase,
          workspaceId,
          effectiveFilters,
          "id",
          { count: "exact", head: true },
        );
        if (error) throw error;
        setPreviewCount(count ?? 0);
      } catch {
        setPreviewCount(null);
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart, workspaceId, JSON.stringify(effectiveFilters)]);

  const applyPreset = (p: Preset) => {
    setActivePreset(p.key);
    setSmart(true);
    setName(p.name);
    setDescription(p.description);
    setFilters(p.filters.map((f) => ({ ...f })));
  };

  const create = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (smart && filters.length === 0) {
      toast.error("Add at least one filter, or switch to an empty list");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/calls/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          isDynamic: smart,
          filters: smart ? effectiveFilters : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create list");
      toast.success("Call list created");
      onCreated(json.list.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create list");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">New call list</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Smart presets
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p)}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${
                    activePreset === p.key
                      ? "border-indigo-400 bg-indigo-50"
                      : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                  }`}
                >
                  <div className="text-sm font-medium text-slate-900">{p.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="List name"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />

          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={smart}
                onChange={() => setSmart(true)}
                className="text-indigo-600"
              />
              Smart list (filters)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={!smart}
                onChange={() => {
                  setSmart(false);
                  setActivePreset(null);
                }}
                className="text-indigo-600"
              />
              Empty list (add contacts manually)
            </label>
          </div>

          {smart && (
            <>
              <div className="rounded-lg border border-slate-200 p-3">
                <FilterBuilder
                  filters={filters}
                  onChange={(f) => {
                    setFilters(f);
                    setActivePreset(null);
                  }}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={phoneOnly}
                  onChange={(e) => setPhoneOnly(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Only contacts with a phone number
              </label>
              <p className="text-xs text-slate-500">
                Smart lists stay up to date automatically — contacts flow in and out as they match the
                filters (e.g. tomorrow&apos;s &ldquo;signed up 14 days ago&rdquo; cohort appears by itself).
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <div className="text-sm text-slate-600">
            {smart &&
              (previewing ? (
                <span className="text-slate-400">Counting…</span>
              ) : previewCount !== null ? (
                <span>
                  <span className="font-semibold text-slate-900">{previewCount}</span>{" "}
                  {previewCount === 1 ? "contact matches" : "contacts match"} right now
                </span>
              ) : filters.length === 0 ? (
                <span className="text-slate-400">Pick a preset or add filters</span>
              ) : null)}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800">
              Cancel
            </button>
            <button
              onClick={create}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <ListPlus className="h-4 w-4" />
              {saving ? "Creating…" : "Create list"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
