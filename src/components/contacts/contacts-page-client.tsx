'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search, Plus, Upload, ChevronLeft, ChevronRight,
  Trash2, ListPlus, ShieldCheck, CheckCircle, XCircle, Phone,
} from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { countryFlag, LANGUAGE_LABELS, SUPPORTED_OUTBOUND_COUNTRIES, COUNTRY_NAMES } from '@/lib/countries';
import { LeadStatusBadge } from '@/components/ui/badge';
import { SlideOver } from '@/components/ui/slide-over';
import { Modal } from '@/components/ui/modal';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';
import type { ContactFilters } from '@/lib/contacts-filter';

type Contact = Tables<'contacts'> & { company_name?: string | null };

const PAGE_SIZE = 50;

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'customer', 'churned'] as const;

const LEAD_STATUS_TABS = [
  { label: 'All', value: '' },
  { label: 'New', value: 'new' },
  { label: 'Contacted', value: 'contacted' },
  { label: 'Qualified', value: 'qualified' },
  { label: 'Customer', value: 'customer' },
  { label: 'Churned', value: 'churned' },
];

const ALL_SOURCES = ['discovery', 'csv', 'manual', 'prospeo'] as const;

const SOURCE_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  csv: 'CSV Import',
  manual: 'Manual',
  prospeo: 'Prospeo',
};

type LocalFilters = {
  search: string;
  lead_status: string;
  status: string;
  company_id: string;
  country_code: string;
  email_status: string;
  has_phone: boolean;
  source: string;
  language: string;
};

const DEFAULT_FILTERS: LocalFilters = {
  search: '',
  lead_status: '',
  status: '',
  company_id: '',
  country_code: '',
  email_status: '',
  has_phone: false,
  source: '',
  language: '',
};

const DROPDOWN_CLASS =
  'border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export function ContactsPageClient() {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Tables<'companies'>[]>([]);
  const [lists, setLists] = useState<Tables<'contact_lists'>[]>([]);
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);

  // Header stats (workspace-level, not filtered)
  const [statsTotal, setStatsTotal] = useState(0);
  const [statsWithEmail, setStatsWithEmail] = useState(0);
  const [statsWithPhone, setStatsWithPhone] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);

  // All filter state is local — no URL params for filters
  const [filters, setFilters] = useState<LocalFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);

  // Debounced search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters.search]);

  // Reset page when filters change
  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPage(1);
      prevFiltersRef.current = filters;
    }
  }, [filters]);

  // Bulk action state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [bulkLeadStatus, setBulkLeadStatus] = useState('');

  // Build filter object for API calls
  const currentFilters: ContactFilters = {
    search: filters.search || undefined,
    lead_status: filters.lead_status || undefined,
    status: filters.status || undefined,
    company_id: filters.company_id || undefined,
    country_code: filters.country_code || undefined,
    email_status: filters.email_status || undefined,
    has_phone: filters.has_phone || undefined,
    source: filters.source || undefined,
    language: filters.language || undefined,
  };

  // Fetch contacts
  const fetchContacts = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setSelectAllMatching(false);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('contacts')
      .select('*, companies(name)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .range(from, to);

    if (debouncedSearch) {
      query = query.or(
        `first_name.ilike.%${debouncedSearch}%,last_name.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%`
      );
    }
    if (filters.lead_status) {
      query = query.eq('lead_status', filters.lead_status as Contact['lead_status']);
    }
    if (filters.status) {
      query = query.eq('status', filters.status as Contact['status']);
    }
    if (filters.company_id) {
      query = query.eq('company_id', filters.company_id);
    }
    if (filters.country_code) {
      query = query.eq('country_code', filters.country_code);
    }
    if (filters.email_status === 'unverified') {
      query = query.or('email_status.is.null,email_status.eq.unknown');
    } else if (filters.email_status) {
      query = query.eq('email_status', filters.email_status);
    }
    if (filters.has_phone) {
      query = query.not('phone', 'is', null).neq('phone', '');
    }
    if (filters.source) {
      query = query.eq('source', filters.source);
    }
    if (filters.language) {
      query = query.eq('language', filters.language);
    }

    query = query.order('created_at', { ascending: false });

    const { data, count, error } = await query;
    if (error) {
      toast.error('Failed to load contacts');
      setLoading(false);
      return;
    }

    const mapped = (data || []).map((c: Record<string, unknown>) => ({
      ...c,
      company_name: (c.companies as { name: string } | null)?.name ?? null,
    })) as Contact[];

    setContacts(mapped);
    setTotalCount(count || 0);
    setSelectedIds(new Set());
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, page, debouncedSearch, filters.lead_status, filters.status, filters.company_id, filters.country_code, filters.email_status, filters.has_phone, filters.source, filters.language]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Workspace-level stats (unfiltered, fetched once)
  useEffect(() => {
    if (!workspaceId) return;
    async function fetchStats() {
      setLoadingStats(true);
      const [totalRes, emailRes, phoneRes] = await Promise.all([
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId!),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId!).not('email', 'is', null).neq('email', ''),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId!).not('phone', 'is', null).neq('phone', ''),
      ]);
      setStatsTotal(totalRes.count ?? 0);
      setStatsWithEmail(emailRes.count ?? 0);
      setStatsWithPhone(phoneRes.count ?? 0);
      setLoadingStats(false);
    }
    fetchStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch companies for dropdown
  useEffect(() => {
    if (!workspaceId) return;
    supabase.from('companies').select('*').eq('workspace_id', workspaceId).order('name')
      .then(({ data }) => { if (data) setCompanies(data); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch distinct countries — seed with SUPPORTED_OUTBOUND_COUNTRIES so every
  // targeted market is always selectable, then union in any country_code that
  // actually appears in contacts (so unexpected ISO codes auto-show up).
  useEffect(() => {
    if (!workspaceId) return;
    const seen = new Set<string>();
    const list: { code: string; name: string }[] = [];
    for (const c of SUPPORTED_OUTBOUND_COUNTRIES) {
      seen.add(c.code);
      list.push({ code: c.code, name: c.name });
    }
    supabase.from('contacts').select('country_code, country').eq('workspace_id', workspaceId).not('country_code', 'is', null)
      .then(({ data }) => {
        if (data) {
          for (const row of data) {
            const code = row.country_code?.toUpperCase();
            if (code && !seen.has(code)) {
              seen.add(code);
              list.push({ code, name: COUNTRY_NAMES[code] ?? row.country ?? code });
            }
          }
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        setCountries([...list]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch distinct sources
  useEffect(() => {
    if (!workspaceId) return;
    supabase.from('contacts').select('source').eq('workspace_id', workspaceId).not('source', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set<string>();
        for (const row of data) { if (row.source) seen.add(row.source); }
        const found = ALL_SOURCES.filter(s => seen.has(s));
        setSources(found.length > 0 ? found : [...ALL_SOURCES]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch distinct languages
  useEffect(() => {
    if (!workspaceId) return;
    supabase.from('contacts').select('language').eq('workspace_id', workspaceId).not('language', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set<string>();
        for (const row of data) { if (row.language) seen.add(row.language); }
        const order = ['et', 'sv', 'fi', 'lv', 'lt', 'no', 'da'];
        setLanguages(order.filter(l => seen.has(l)));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Fetch lists for bulk action
  useEffect(() => {
    if (!workspaceId) return;
    supabase.from('contact_lists').select('*').eq('workspace_id', workspaceId).order('name')
      .then(({ data }) => { if (data) setLists(data); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const allSelected = contacts.length > 0 && selectedIds.size === contacts.length;
  const effectiveCount = selectAllMatching ? totalCount : selectedIds.size;
  const hasActiveFilters =
    filters.search !== '' || filters.lead_status !== '' || filters.status !== '' ||
    filters.company_id !== '' || filters.country_code !== '' || filters.email_status !== '' ||
    filters.has_phone !== false || filters.source !== '' || filters.language !== '';

  const toggleSelect = (id: string) => {
    setSelectAllMatching(false);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectAllMatching(false);
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(contacts.map(c => c.id)));
  };

  // ── Bulk actions ─────────────────────────────────────────────────────────────

  const handleBulkLeadStatusChange = async (newStatus: string) => {
    if (!workspaceId || effectiveCount === 0) return;
    const body = selectAllMatching
      ? { filters: currentFilters, workspaceId, lead_status: newStatus }
      : { contactIds: Array.from(selectedIds), workspaceId, lead_status: newStatus };
    const res = await fetch('/api/contacts/bulk-update-lead-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed to update contacts'); return; }
    toast.success(`Updated ${data.updated} contacts`);
    setSelectedIds(new Set()); setSelectAllMatching(false); setBulkLeadStatus('');
    fetchContacts();
  };

  const handleBulkDelete = async () => {
    if (!workspaceId || effectiveCount === 0) return;
    const body = selectAllMatching
      ? { filters: currentFilters, workspaceId }
      : { contactIds: Array.from(selectedIds), workspaceId };
    const res = await fetch('/api/contacts/bulk-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed to delete contacts'); return; }
    toast.success(`Deleted ${data.deleted} contacts`);
    setSelectedIds(new Set()); setSelectAllMatching(false); setShowDeleteConfirm(false);
    fetchContacts();
  };

  const handleBulkVerify = async () => {
    if (!workspaceId || effectiveCount === 0) return;
    setVerifying(true);
    try {
      const body = selectAllMatching
        ? { filters: currentFilters, workspaceId }
        : { contactIds: Array.from(selectedIds), workspaceId };
      const res = await fetch('/api/contacts/verify-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Verification failed'); return; }
      const { verified, skipped, errors, capped, totalRequested } = data;
      const cappedNote = capped ? ` (${totalRequested} total — click again for next batch)` : '';
      toast.success(`Verified ${verified}, skipped ${skipped} (cached)${errors > 0 ? `, ${errors} errors` : ''}${cappedNote}`);
      router.refresh();
      setSelectedIds(new Set()); setSelectAllMatching(false); setShowVerifyConfirm(false);
      fetchContacts();
    } catch {
      toast.error('Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleBulkAddToList = async (listId: string) => {
    if (!workspaceId || effectiveCount === 0) return;
    const body = selectAllMatching
      ? { filters: currentFilters, workspaceId, listId }
      : { contactIds: Array.from(selectedIds), workspaceId, listId };
    const res = await fetch('/api/contact-lists/add-contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed to add to list'); return; }
    toast.success(`Added ${data.added} contacts to list`);
    setShowAddToList(false); setSelectedIds(new Set()); setSelectAllMatching(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Contacts</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage your contacts and track engagement</p>
          </div>
          <div className="flex items-center gap-6">
            {/* Stats bar */}
            {!loadingStats && (
              <div className="flex items-center gap-4 text-sm text-slate-600">
                <span>
                  <span className="font-semibold text-slate-900">{statsTotal.toLocaleString()}</span> contacts
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  <span className="font-semibold text-slate-900">{statsWithEmail.toLocaleString()}</span> with email
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  <span className="font-semibold text-slate-900">{statsWithPhone.toLocaleString()}</span> with phone
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Link
                href="/contacts/import"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Upload className="w-4 h-4" />
                Import CSV
              </Link>
              <button
                onClick={() => setShowAddContact(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" />
                Add Contact
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-5">
        {/* Filter card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          {/* Row 1: Lead Status pill tabs */}
          <div className="flex flex-wrap gap-1">
            {LEAD_STATUS_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setFilters(f => ({ ...f, lead_status: tab.value }))}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.lead_status === tab.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Row 2: Dropdowns + toggles */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Country */}
            <select
              value={filters.country_code}
              onChange={e => setFilters(f => ({ ...f, country_code: e.target.value }))}
              className={DROPDOWN_CLASS}
            >
              <option value="">All countries</option>
              {countries.map(c => (
                <option key={c.code} value={c.code}>
                  {countryFlag(c.code)} {c.name} ({c.code})
                </option>
              ))}
            </select>

            {/* Email Status */}
            <select
              value={filters.email_status}
              onChange={e => setFilters(f => ({ ...f, email_status: e.target.value }))}
              className={DROPDOWN_CLASS}
            >
              <option value="">All email statuses</option>
              <option value="valid">✅ Valid</option>
              <option value="risky">⚠️ Risky</option>
              <option value="catch_all">📬 Catch-all</option>
              <option value="invalid">❌ Invalid</option>
              <option value="unverified">— Not verified</option>
            </select>

            {/* Source */}
            <select
              value={filters.source}
              onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}
              className={DROPDOWN_CLASS}
            >
              <option value="">All sources</option>
              {sources.map(s => (
                <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>
              ))}
            </select>

            {/* Language */}
            {languages.length > 0 && (
              <select
                value={filters.language}
                onChange={e => setFilters(f => ({ ...f, language: e.target.value }))}
                className={DROPDOWN_CLASS}
              >
                <option value="">All languages</option>
                {languages.map(l => (
                  <option key={l} value={l}>{LANGUAGE_LABELS[l] ?? l}</option>
                ))}
              </select>
            )}

            {/* Contact Status */}
            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className={DROPDOWN_CLASS}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="bounced">Bounced</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="archived">Archived</option>
            </select>

            {/* Company */}
            <select
              value={filters.company_id}
              onChange={e => setFilters(f => ({ ...f, company_id: e.target.value }))}
              className={DROPDOWN_CLASS}
            >
              <option value="">All companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Has Phone */}
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.has_phone}
                onChange={e => setFilters(f => ({ ...f, has_phone: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Has phone
            </label>
          </div>

          {/* Row 3: Search + Clear all */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Country</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Language</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Lead Status</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
                </tr>
              </thead>
              <tbody>
                {/* Select-all-matching banner */}
                {!loading && allSelected && !selectAllMatching && totalCount > contacts.length && (
                  <tr>
                    <td colSpan={10} className="bg-indigo-50 border-b border-indigo-100 text-center py-2.5 text-sm text-slate-600">
                      All {contacts.length} contacts on this page are selected.{' '}
                      <button
                        onClick={() => setSelectAllMatching(true)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium underline"
                      >
                        Select all {totalCount.toLocaleString()} contacts matching current filters
                      </button>
                    </td>
                  </tr>
                )}
                {!loading && selectAllMatching && (
                  <tr>
                    <td colSpan={10} className="bg-indigo-100 border-b border-indigo-200 text-center py-2.5 text-sm text-slate-700">
                      All {totalCount.toLocaleString()} contacts matching current filters are selected.{' '}
                      <button
                        onClick={() => { setSelectAllMatching(false); setSelectedIds(new Set()); }}
                        className="text-indigo-600 hover:text-indigo-800 font-medium underline"
                      >
                        Clear selection
                      </button>
                    </td>
                  </tr>
                )}

                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100 animate-pulse">
                      <td className="px-4 py-3"><div className="h-4 w-4 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-40 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-28 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-5 w-16 bg-slate-200 rounded-full" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-16 bg-slate-200 rounded" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                    </tr>
                  ))
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-16 text-center">
                      <p className="text-slate-500 font-medium">No contacts found</p>
                      <p className="text-slate-400 text-sm mt-1">
                        {hasActiveFilters ? 'Try adjusting your filters' : 'Add your first contact or import from CSV'}
                      </p>
                      {!hasActiveFilters && (
                        <button
                          onClick={() => setShowAddContact(true)}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                        >
                          <Plus className="w-4 h-4" />
                          Add Contact
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  contacts.map(contact => (
                    <tr key={contact.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleSelect(contact.id)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/contacts/${contact.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                          {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="flex items-center gap-1.5">
                          {contact.email_status === 'invalid' ? (
                            <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
                          ) : contact.email_status === 'valid' ? (
                            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
                          ) : contact.email_status === 'risky' ? (
                            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                          ) : contact.email_status === 'catch_all' ? (
                            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                          ) : null}
                          {contact.email ? (
                            <a href={`mailto:${contact.email}`} className="hover:text-indigo-600 hover:underline">
                              {contact.email}
                            </a>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {contact.phone ? (
                          <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-indigo-600 hover:underline">
                            <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate max-w-[130px]">{contact.phone}</span>
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {contact.company_id && contact.company_name ? (
                          <Link href={`/companies/${contact.company_id}`} className="text-indigo-600 hover:text-indigo-700">
                            {contact.company_name}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {contact.country_code
                          ? `${countryFlag(contact.country_code)} ${contact.country ?? contact.country_code}`
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {contact.language
                          ? (LANGUAGE_LABELS[contact.language] ?? contact.language)
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <LeadStatusBadge status={contact.lead_status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {contact.source
                          ? (SOURCE_LABELS[contact.source] ?? contact.source)
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {format(new Date(contact.created_at), 'MMM d, yyyy')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalCount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
              <p className="text-sm text-slate-600">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {(selectedIds.size > 0 || selectAllMatching) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">{effectiveCount.toLocaleString()} contacts selected</span>
          <div className="h-5 w-px bg-slate-600" />
          <select
            value={bulkLeadStatus}
            onChange={e => { if (e.target.value) handleBulkLeadStatusChange(e.target.value); }}
            className="text-sm bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white"
          >
            <option value="">Change Lead Status</option>
            {LEAD_STATUSES.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddToList(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg hover:bg-slate-700"
          >
            <ListPlus className="w-4 h-4" />
            Add to List
          </button>
          <button
            onClick={() => setShowVerifyConfirm(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg hover:bg-slate-700"
          >
            <ShieldCheck className="w-4 h-4" />
            Verify Emails
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-600 rounded-lg hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}

      {/* Add Contact Slide-Over */}
      <SlideOver open={showAddContact} onClose={() => setShowAddContact(false)} title="Add Contact">
        <AddContactForm
          workspaceId={workspaceId}
          companies={companies}
          onSuccess={() => { setShowAddContact(false); fetchContacts(); }}
        />
      </SlideOver>

      {/* Delete Confirmation Modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Contacts">
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete {effectiveCount.toLocaleString()} contact{effectiveCount > 1 ? 's' : ''}? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </Modal>

      {/* Verify Emails Modal */}
      <Modal open={showVerifyConfirm} onClose={() => setShowVerifyConfirm(false)} title="Verify Email Addresses">
        <p className="text-sm text-slate-600 mb-4">
          This will verify {effectiveCount.toLocaleString()} email address{effectiveCount !== 1 ? 'es' : ''} using MillionVerifier. Already-verified contacts and contacts without an email will be skipped. Capped at 50 per click.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowVerifyConfirm(false)}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleBulkVerify}
            disabled={verifying}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {verifying && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            {verifying ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      </Modal>

      {/* Add to List Modal */}
      <Modal open={showAddToList} onClose={() => setShowAddToList(false)} title="Add to List">
        {lists.length === 0 ? (
          <p className="text-sm text-slate-500">No lists yet. Create a list first.</p>
        ) : (
          <div className="space-y-2">
            {lists.map(list => (
              <button
                key={list.id}
                onClick={() => handleBulkAddToList(list.id)}
                className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm"
              >
                <span className="font-medium text-slate-900">{list.name}</span>
                {list.description && <p className="text-slate-500 text-xs mt-0.5">{list.description}</p>}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Add Contact Form ──────────────────────────────────────────────────────────

function AddContactForm({
  workspaceId,
  companies,
  onSuccess,
}: {
  workspaceId: string | null;
  companies: Tables<'companies'>[];
  onSuccess: () => void;
}) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company_id: '',
    lead_status: 'new' as const,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    const newErrors: Record<string, string> = {};
    if (!form.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = 'Invalid email format';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setSaving(true);
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        workspace_id: workspaceId,
        email: form.email.trim(),
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        phone: form.phone.trim() || null,
        company_id: form.company_id || null,
        lead_status: form.lead_status,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') toast.error('A contact with this email already exists');
      else toast.error('Failed to create contact');
      setSaving(false);
      return;
    }

    await supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'contact_created',
      contact_id: data.id,
      subject: 'Contact created',
    });

    toast.success('Contact created');
    setSaving(false);
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
          <input
            type="text"
            value={form.first_name}
            onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
          <input
            type="text"
            value={form.last_name}
            onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
        <input
          type="email"
          value={form.email}
          onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setErrors({}); }}
          className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.email ? 'border-red-300' : 'border-slate-300'}`}
        />
        {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
        <input
          type="text"
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
        <select
          value={form.company_id}
          onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">No company</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Lead Status</label>
        <select
          value={form.lead_status}
          onChange={e => setForm(f => ({ ...f, lead_status: e.target.value as typeof form.lead_status }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {LEAD_STATUSES.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>
      <div className="pt-4 border-t border-slate-200">
        <button
          type="submit"
          disabled={saving}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Contact'}
        </button>
      </div>
    </form>
  );
}
