'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, Sparkles, ChevronDown, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import type { Rep } from '@/lib/reps/list';

export type OwnerState = {
  primaryOwnerId: string | null;
  secondaryOwnerId: string | null;
  ownerAuto: boolean;
  ownerUpdatedAt: string | null;
  primaryOwnerSource: string | null;
};

interface RepOwnerControlProps {
  entityType: 'contact' | 'company';
  entityId: string;
  value: OwnerState;
  onChange?: (next: OwnerState) => void;
}

// Circled-number shorthand: ① ② ③ … (falls back to "#n" past 20).
function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + (n - 1)) : `#${n}`;
}

const SOURCE_LABEL: Record<string, string> = {
  email_sent: 'sent an email',
  email_received: 'got a reply',
  call: 'logged a call',
  meeting: 'logged a meeting',
  note: 'added a note',
  field_visit: 'visited',
  manual: 'set manually',
};

export function RepOwnerControl({ entityType, entityId, value, onChange }: RepOwnerControlProps) {
  const [reps, setReps] = useState<Rep[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Draft state while the popover is open
  const [draftAuto, setDraftAuto] = useState(value.ownerAuto);
  const [draftPrimary, setDraftPrimary] = useState(value.primaryOwnerId);
  const [draftSecondary, setDraftSecondary] = useState(value.secondaryOwnerId);

  useEffect(() => {
    let active = true;
    fetch('/api/reps')
      .then((r) => (r.ok ? r.json() : { reps: [] }))
      .then((d) => { if (active) setReps(d.reps ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const repByUser = useMemo(() => {
    const m = new Map<string, Rep>();
    // Map every user_id a rep owns → the rep, so a stored owner id resolves even
    // if it isn't the canonical one.
    for (const r of reps) for (const uid of r.userIds) m.set(uid, r);
    return m;
  }, [reps]);

  function repLabel(userId: string | null): { num: string; name: string } | null {
    if (!userId) return null;
    const rep = repByUser.get(userId);
    if (rep) return { num: circled(rep.number), name: rep.name };
    return { num: '•', name: 'Unknown rep' };
  }

  const primary = repLabel(value.primaryOwnerId);
  const secondary = repLabel(value.secondaryOwnerId);

  function openPopover() {
    setDraftAuto(value.ownerAuto);
    setDraftPrimary(value.primaryOwnerId);
    setDraftSecondary(value.secondaryOwnerId);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/${entityType === 'contact' ? 'contacts' : 'companies'}/${entityId}/owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          draftAuto
            ? { auto: true }
            : { auto: false, primaryOwnerId: draftPrimary, secondaryOwnerId: draftSecondary },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Could not update owner');
        return;
      }
      const updated = data[entityType] ?? {};
      onChange?.({
        primaryOwnerId: updated.primary_owner_id ?? null,
        secondaryOwnerId: updated.secondary_owner_id ?? null,
        ownerAuto: updated.owner_auto ?? draftAuto,
        ownerUpdatedAt: updated.owner_updated_at ?? null,
        primaryOwnerSource: updated.primary_owner_source ?? null,
      });
      toast.success(draftAuto ? 'Switched to auto-assign' : 'Owner locked');
      setOpen(false);
    } catch {
      toast.error('Could not update owner');
    } finally {
      setSaving(false);
    }
  }

  const sourceLabel = value.primaryOwnerSource
    ? SOURCE_LABEL[value.primaryOwnerSource] ?? value.primaryOwnerSource
    : null;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={openPopover}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
        aria-label="Edit rep ownership"
      >
        {value.ownerAuto ? (
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" aria-label="Auto-assigned" />
        ) : (
          <Lock className="w-3.5 h-3.5 text-amber-500" aria-label="Locked" />
        )}
        {primary ? (
          <span className="inline-flex items-center gap-1 text-slate-700">
            <span className="text-slate-400">P</span>
            <span>{primary.num} {primary.name}</span>
          </span>
        ) : (
          <span className="text-slate-400">Unassigned</span>
        )}
        {secondary && (
          <span className="inline-flex items-center gap-1 text-slate-500 pl-1 border-l border-slate-200">
            <span className="text-slate-400">S</span>
            <span>{secondary.num} {secondary.name}</span>
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-80 bg-white rounded-lg border border-slate-200 shadow-xl z-40 p-3">
            <div className="text-sm font-semibold text-slate-900 mb-1">Rep ownership</div>
            <p className="text-[11px] text-slate-500 mb-3 leading-snug">
              <strong>P</strong> = Primary rep, <strong>S</strong> = Secondary. The number (①②) is each rep&apos;s shorthand.
            </p>

            {/* Auto vs Locked toggle */}
            <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg mb-3">
              <button
                type="button"
                onClick={() => setDraftAuto(true)}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md ${
                  draftAuto ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" /> Auto
              </button>
              <button
                type="button"
                onClick={() => setDraftAuto(false)}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md ${
                  !draftAuto ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Lock className="w-3.5 h-3.5" /> Locked
              </button>
            </div>

            {draftAuto ? (
              <div className="text-xs text-slate-600 space-y-2">
                <p className="leading-snug">
                  Auto-assigns by latest contact: <strong>Primary</strong> = whoever contacted this {entityType} most
                  recently, <strong>Secondary</strong> = the next most recent. Updates itself as you and the team keep working.
                </p>
                <div className="rounded-md bg-slate-50 p-2">
                  {primary ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Primary</span>
                      <span className="font-medium text-slate-800">{primary.num} {primary.name}</span>
                      {sourceLabel && <span className="text-slate-400">· {sourceLabel}</span>}
                    </div>
                  ) : (
                    <div className="text-slate-400">No contact recorded yet — unassigned.</div>
                  )}
                  {secondary && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-slate-400">Secondary</span>
                      <span className="font-medium text-slate-700">{secondary.num} {secondary.name}</span>
                    </div>
                  )}
                  {value.ownerUpdatedAt && (
                    <div className="text-[10px] text-slate-400 mt-1">
                      Updated {formatDistanceToNow(new Date(value.ownerUpdatedAt), { addSuffix: true })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px] text-slate-500 leading-snug">
                  Locked to the reps you pick — auto-assignment won&apos;t change them until you switch back to Auto.
                </p>
                <RepSelect
                  label="Primary rep"
                  reps={reps}
                  value={draftPrimary}
                  onChange={(v) => { setDraftPrimary(v); if (v && v === draftSecondary) setDraftSecondary(null); }}
                />
                <RepSelect
                  label="Secondary rep"
                  reps={reps.filter((r) => r.userId !== draftPrimary)}
                  value={draftSecondary}
                  onChange={setDraftSecondary}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RepSelect({
  label, reps, value, onChange,
}: {
  label: string;
  reps: Rep[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">— Unassigned —</option>
        {reps.map((r) => (
          <option key={r.userId} value={r.userId}>
            {r.number}: {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
