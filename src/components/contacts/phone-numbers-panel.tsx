'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Star, Trash2, Plus, Loader2, Sparkles, ExternalLink, X, Check, Pencil, Tag, Info, Ban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { PhoneInputControl, PhoneDisplay } from '@/components/contacts/phone-field';
import { normalizePhone } from '@/lib/calls/phone';
import type { Tables } from '@/lib/database.types';

export type PhoneNumber = Tables<'phone_numbers'>;

/** Shape returned by POST /api/enrich/find-phone. */
type FoundPhone = {
  number: string;
  raw: string;
  label: string | null;
  source: 'website' | 'web-search';
  sourceUrl: string | null;
  confidence: string;
};

/** The primary pool number string + the full list, surfaced to the parent so
 *  the Call button can default to (and choose between) these. */
export type PhonePoolState = { numbers: PhoneNumber[]; primary: string | null };

interface Props {
  workspaceId: string;
  /** 'contact' loads the contact's number + the shared company pool; 'company'
   *  loads the whole company pool. */
  scope: 'contact' | 'company';
  contactId?: string | null;
  companyId?: string | null;
  /** Used as the default label for new numbers added on a contact. */
  contactName?: string | null;
  /** ISO alpha-2 hint for the phone input + national-number expansion. */
  defaultCountry?: string | null;
  /** Show the AI "Find numbers" button (contact scope only). */
  enableFind?: boolean;
  /** Fires whenever the pool changes so the parent can refresh the dialer. */
  onChange?: (state: PhonePoolState) => void;
}

export function PhoneNumbersPanel({
  workspaceId,
  scope,
  contactId = null,
  companyId = null,
  contactName = null,
  defaultCountry = null,
  enableFind = false,
  onChange,
}: Props) {
  const supabase = createClient();
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newNum, setNewNum] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<FoundPhone[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const emit = useCallback((rows: PhoneNumber[]) => {
    const primary = rows.find((r) => r.is_primary)?.number ?? rows[0]?.number ?? null;
    onChangeRef.current?.({ numbers: rows, primary });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('phone_numbers').select('*').eq('workspace_id', workspaceId);
    if (scope === 'company') {
      if (!companyId) { setNumbers([]); setLoading(false); return; }
      q = q.eq('company_id', companyId);
    } else if (companyId) {
      // Contact at a company → the full shared pool plus its own attributed rows.
      q = q.or(`company_id.eq.${companyId},contact_id.eq.${contactId}`);
    } else if (contactId) {
      q = q.is('company_id', null).eq('contact_id', contactId);
    } else {
      setNumbers([]); setLoading(false); return;
    }
    const { data } = await q
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    const rows = data ?? [];
    setNumbers(rows);
    emit(rows);
    setLoading(false);
  }, [supabase, workspaceId, scope, companyId, contactId, emit]);

  useEffect(() => { load(); }, [load]);

  // The "owner" columns to stamp on a number added through this panel.
  const ownerCols = () =>
    scope === 'company'
      ? { company_id: companyId, contact_id: null as string | null }
      : { company_id: companyId, contact_id: contactId };

  /** Mirror the primary number back to the legacy columns so list views, CSV
   *  export, and the dialer default keep working. */
  const syncMirrors = async (row: { company_id: string | null; contact_id: string | null; number: string }) => {
    const tasks: PromiseLike<unknown>[] = [];
    if (row.company_id) {
      tasks.push(supabase.from('companies').update({ phone: row.number }).eq('id', row.company_id));
    }
    if (row.contact_id) {
      tasks.push(supabase.from('contacts').update({ phone: row.number }).eq('id', row.contact_id));
    }
    await Promise.all(tasks);
  };

  const add = async (rawNumber: string | null, label: string | null, source = 'manual') => {
    if (!rawNumber) { toast.error('Enter a number'); return; }
    const e164 = normalizePhone(rawNumber, defaultCountry) ?? rawNumber.trim();
    if (numbers.some((n) => n.number === e164)) { toast('Already saved'); return; }
    setBusy(true);
    const firstOne = numbers.length === 0;
    const { error } = await supabase.from('phone_numbers').insert({
      workspace_id: workspaceId,
      ...ownerCols(),
      number: e164,
      label: (label?.trim() || (scope === 'contact' ? contactName : null)) || null,
      country_code: defaultCountry,
      is_primary: firstOne,
      source,
    });
    setBusy(false);
    if (error) { toast.error('Failed to add number'); return; }
    if (firstOne) await syncMirrors({ ...ownerCols(), number: e164 });
    toast.success('Number added');
    setNewNum(null); setNewLabel(''); setShowAdd(false);
    await load();
  };

  const setPrimary = async (row: PhoneNumber) => {
    setBusy(true);
    // Clear the current primary across this number's pool, then set it here.
    let clear = supabase.from('phone_numbers').update({ is_primary: false })
      .eq('workspace_id', workspaceId).eq('is_primary', true);
    if (row.company_id) clear = clear.eq('company_id', row.company_id);
    else if (row.contact_id) clear = clear.is('company_id', null).eq('contact_id', row.contact_id);
    await clear;
    await supabase.from('phone_numbers').update({ is_primary: true }).eq('id', row.id);
    await syncMirrors(row);
    setBusy(false);
    toast.success('Primary number set');
    await load();
  };

  const saveLabel = async (row: PhoneNumber) => {
    const label = labelDraft.trim() || null;
    setEditingLabelId(null);
    if (label === (row.label ?? null)) return;
    await supabase.from('phone_numbers').update({ label }).eq('id', row.id);
    await load();
  };

  const remove = async (row: PhoneNumber) => {
    setBusy(true);
    await supabase.from('phone_numbers').delete().eq('id', row.id);
    setBusy(false);
    await load();
  };

  /** Mark a found number as "not correct" so future searches never surface it.
   *  Persists to the record's custom_fields.rejected_phones and drops it from
   *  the picker locally. */
  const rejectFound = async (p: FoundPhone) => {
    if (rejecting) return;
    setRejecting(p.number);
    try {
      const res = await fetch('/api/enrich/reject-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          contactId: contactId ?? undefined,
          companyId: contactId ? undefined : companyId ?? undefined,
          number: p.number,
          countryCode: defaultCountry,
        }),
      });
      if (!res.ok) { toast.error('Could not save'); return; }
      toast.success("Marked as not correct — won't suggest it again");
      setFound((prev) => {
        const next = (prev ?? []).filter((x) => x.number !== p.number);
        return next.length ? next : null;
      });
    } catch {
      toast.error('Could not save');
    } finally {
      setRejecting(null);
    }
  };

  const handleFind = async () => {
    if (!enableFind || !contactId || finding) return;
    setFinding(true);
    const toastId = toast.loading('Searching for phone numbers…');
    try {
      const res = await fetch('/api/enrich/find-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, contactId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Search failed', { id: toastId }); return; }
      // If the contact had no website, the finder discovered + saved one first.
      if (data.websiteAdded) {
        toast.success(`Found website ${data.websiteAdded}`);
      }
      if (data.found && data.phones?.length) {
        toast.success(`Found ${data.phones.length} number${data.phones.length === 1 ? '' : 's'}`, { id: toastId });
        setFound(data.phones as FoundPhone[]);
      } else {
        toast.error(data.reasoning || 'No phone numbers found', { id: toastId });
      }
    } catch {
      toast.error('Search failed', { id: toastId });
    } finally {
      setFinding(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          <label className="block text-xs font-medium text-slate-500">Phone Numbers</label>
          {enableFind && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowInfo((v) => !v)}
                onBlur={() => setTimeout(() => setShowInfo(false), 150)}
                title="How does 'Find numbers' work?"
                className="flex items-center text-slate-400 hover:text-slate-600"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              {showInfo && (
                <div className="absolute left-0 top-6 z-20 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg">
                  <p className="mb-1.5 font-semibold text-slate-700">How “Find numbers” works</p>
                  <ol className="list-decimal space-y-1 pl-4">
                    <li>
                      <span className="font-medium text-slate-700">Find the website first.</span> Uses
                      the site saved on this contact and its company. If none is saved, it finds one
                      from the email domain or a web search and saves it to the profile.
                    </li>
                    <li>
                      <span className="font-medium text-slate-700">Scrape the site.</span> Reads the
                      homepage and contact/about pages for <code>tel:</code> links and listed numbers.
                    </li>
                    <li>
                      <span className="font-medium text-slate-700">AI web search.</span> Looks the
                      business up by name, town and trade across its own site and directories
                      (hitta.se, eniro, Google Business).
                    </li>
                    <li>
                      <span className="font-medium text-slate-700">Clean up.</span> Normalises to
                      +46 format, de-dupes, drops numbers already saved, and shows the rest for you to
                      add.
                    </li>
                  </ol>
                  <p className="mt-2 text-[11px] text-slate-400">
                    No third-party data brokers — just the public web.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        {enableFind && (
          <button
            onClick={handleFind}
            disabled={finding}
            title="Find the website, scrape it, and web-search for phone numbers"
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 text-slate-600 disabled:opacity-50"
          >
            {finding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {finding ? 'Searching…' : 'Find numbers'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
      ) : numbers.length === 0 ? (
        <p className="text-sm text-slate-400 px-1 py-1.5">No phone numbers yet</p>
      ) : (
        <ul className="space-y-1.5">
          {numbers.map((row) => (
            <li
              key={row.id}
              className="group flex items-start gap-2 rounded-lg border border-slate-200 px-2 py-1.5"
            >
              <button
                onClick={() => !row.is_primary && setPrimary(row)}
                disabled={busy}
                title={row.is_primary ? 'Primary number' : 'Set as primary'}
                className="mt-0.5 flex-shrink-0 disabled:opacity-50"
              >
                <Star
                  className={`w-3.5 h-3.5 ${row.is_primary ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-900">
                  <PhoneDisplay value={row.number} defaultCountry={row.country_code ?? defaultCountry} />
                </div>
                {editingLabelId === row.id ? (
                  <input
                    value={labelDraft}
                    autoFocus
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onBlur={() => saveLabel(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveLabel(row);
                      if (e.key === 'Escape') setEditingLabelId(null);
                    }}
                    placeholder="Label (e.g. Stockholm, Mobile)"
                    className="mt-0.5 w-full text-xs px-1.5 py-0.5 border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                ) : (
                  <button
                    onClick={() => { setEditingLabelId(row.id); setLabelDraft(row.label ?? ''); }}
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600"
                  >
                    <Tag className="w-3 h-3" />
                    {row.label || <span className="italic text-slate-400">Add label</span>}
                    <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60" />
                  </button>
                )}
              </div>
              <button
                onClick={() => remove(row)}
                disabled={busy}
                title="Remove number"
                className="mt-0.5 flex-shrink-0 text-slate-300 hover:text-red-500 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add row */}
      {showAdd ? (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-2">
          <PhoneInputControl
            value={newNum}
            defaultCountry={defaultCountry}
            onChange={setNewNum}
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (Stockholm, Mobile, …) — optional"
            className="w-full text-xs px-2 py-1 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => add(newNum, newLabel)}
              disabled={busy || !newNum}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Check className="w-3 h-3" /> Add
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewNum(null); setNewLabel(''); }}
              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> Add number
        </button>
      )}

      {/* Found-numbers picker */}
      {found && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Found {found.length} number{found.length === 1 ? '' : 's'}
            </span>
            <button onClick={() => setFound(null)} className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="space-y-1.5">
            {found.map((p) => {
              const saved = numbers.some((n) => n.number === p.number);
              return (
                <li key={p.number} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-900">
                      <PhoneDisplay value={p.number} defaultCountry={defaultCountry} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {p.label && <span className="font-medium text-slate-600">{p.label}</span>}
                      <span className={`px-1.5 py-0.5 rounded ${
                        p.confidence === 'high' ? 'bg-green-100 text-green-700'
                          : p.confidence === 'medium' ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>{p.confidence}</span>
                      {p.sourceUrl ? (
                        <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-700">
                          {p.source === 'website' ? 'website' : 'web'}<ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span>{p.source === 'website' ? 'website' : 'web search'}</span>
                      )}
                    </div>
                  </div>
                  {saved ? (
                    <span className="text-xs font-medium text-green-600 flex-shrink-0">Saved</span>
                  ) : (
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        onClick={() => add(p.number, p.label, p.source)}
                        disabled={busy || rejecting === p.number}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => rejectFound(p)}
                        disabled={busy || rejecting === p.number}
                        title="Not correct — this number isn't for this contact. Won't be suggested again."
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 text-slate-500 border border-slate-200 rounded hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50"
                      >
                        {rejecting === p.number ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                        Not correct
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
