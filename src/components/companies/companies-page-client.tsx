'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Search, Plus, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Columns3, Building2, Globe, Phone, Trash2,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { countryFlag, SUPPORTED_OUTBOUND_COUNTRIES, COUNTRY_NAMES } from '@/lib/countries';
import { SlideOver } from '@/components/ui/slide-over';
import { Modal } from '@/components/ui/modal';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import type { CompanyFilters } from '@/lib/companies-filter';
import toast from 'react-hot-toast';
import {
  COLUMN_BY_ID, DEFAULT_COLUMN_IDS, loadColumnIds, saveColumnIds,
  type ColumnId, type Company,
} from './column-config';
import { ColumnCustomizer } from './column-customizer';
import { loadListState, saveListState } from '@/lib/list-state';

const LIST_STATE_KEY = 'crm-companies-list-state';

type PersistedListState = {
  filters?: LocalFilters;
  sort?: { key: SortKey; dir: SortDir };
  page?: number;
  scrollY?: number;
};

const PAGE_SIZE = 50;

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing',
  'Retail', 'Real Estate', 'Media', 'Consulting', 'Legal', 'Other',
];

const ALL_SOURCES = ['discovery', 'csv', 'manual', 'wl-app', 'lemlist', 'scb', 'apollo'] as const;

const SOURCE_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  csv: 'CSV Import',
  manual: 'Manual',
  'wl-app': 'WL App',
  lemlist: 'Lemlist',
  scb: 'SCB Registry',
  apollo: 'Apollo',
};

const LIFECYCLE_OPTIONS: MultiSelectOption[] = [
  { value: 'lead',         label: 'Lead' },
  { value: 'mql',          label: 'MQL' },
  { value: 'sql',          label: 'SQL' },
  { value: 'trial',        label: 'Trial' },
  { value: 'freemium',     label: 'Freemium' },
  { value: 'paying',       label: 'Paying' },
  { value: 'churned',      label: 'Churned' },
  { value: 'reactivation', label: 'Reactivation' },
];

const CUSTOMER_STATUS_OPTIONS: MultiSelectOption[] = [
  { value: 'trialing', label: 'Trialing' },
  { value: 'active',   label: 'Active' },
  { value: 'paused',   label: 'Paused' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'churned',  label: 'Churned' },
];

const PLAN_OPTIONS: MultiSelectOption[] = [
  { value: 'free',          label: 'Free' },
  { value: 'small_monthly', label: 'Small monthly' },
  { value: 'small_yearly',  label: 'Small yearly' },
  { value: 'large_monthly', label: 'Large monthly' },
  { value: 'large_yearly',  label: 'Large yearly' },
];

const PLAN_LABELS: Record<string, string> = Object.fromEntries(
  PLAN_OPTIONS.map((o) => [o.value, o.label]),
);

const HAS_ACCOUNT_OPTIONS: MultiSelectOption[] = [
  { value: 'yes', label: 'App workshop' },
  { value: 'no',  label: 'Prospect (no account)' },
];

type LocalFilters = {
  search: string;
  country_code: string[];
  source: string[];
  industry: string[];
  lifecycle_stage: string[];
  customer_status: string[];
  plan: string[];
  has_account: string[];
  tags: string[];
  has_phone: boolean;
  has_domain: boolean;
};

const DEFAULT_FILTERS: LocalFilters = {
  search: '',
  country_code: [],
  source: [],
  industry: [],
  lifecycle_stage: [],
  customer_status: [],
  plan: [],
  has_account: [],
  tags: [],
  has_phone: false,
  has_domain: false,
};

type SortKey = 'name' | 'domain' | 'country' | 'industry' | 'created_at' | 'last_active_at';
type SortDir = 'asc' | 'desc';
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'created_at', dir: 'desc' };
const TEXT_DEFAULT_DIR: SortDir = 'asc';

export function CompaniesPageClient() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddCompany, setShowAddCompany] = useState(false);

  // Bulk action state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkLifecycle, setBulkLifecycle] = useState('');
  const [bulkCustomerStatus, setBulkCustomerStatus] = useState('');

  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);

  // Header stats (workspace-level, not filtered)
  const [statsTotal, setStatsTotal] = useState(0);
  const [statsWithDomain, setStatsWithDomain] = useState(0);
  const [statsWithPhone, setStatsWithPhone] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);
  const [pendingDuplicates, setPendingDuplicates] = useState(0);

  // Filters / sort / page hydrated from sessionStorage so back-nav from a
  // company detail returns to the same filtered view.
  const [filters, setFilters] = useState<LocalFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [pendingScrollY, setPendingScrollY] = useState<number | null>(null);

  // Column visibility + order — persisted to localStorage per workspace
  const [columnIds, setColumnIds] = useState<ColumnId[]>(DEFAULT_COLUMN_IDS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    setColumnIds(loadColumnIds(workspaceId));
    const saved = loadListState<PersistedListState>(LIST_STATE_KEY, workspaceId, {});
    if (saved.filters) setFilters({ ...DEFAULT_FILTERS, ...saved.filters });
    if (saved.sort) setSort(saved.sort);
    if (saved.page && saved.page > 0) setPage(saved.page);
    if (typeof saved.scrollY === 'number') setPendingScrollY(saved.scrollY);
    setHydrated(true);
  }, [workspaceId]);
  const handleColumnsChange = (next: ColumnId[]) => {
    setColumnIds(next);
    saveColumnIds(workspaceId ?? null, next);
  };

  const handleSortClick = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: key === 'created_at' || key === 'last_active_at' ? 'desc' : TEXT_DEFAULT_DIR };
    });
  };

  // Debounced search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters.search]);

  // Reset page when filters change (skipped during hydration so a restored
  // page isn't blown away by restoring filters).
  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (!hydrated) {
      prevFiltersRef.current = filters;
      return;
    }
    if (prevFiltersRef.current !== filters) {
      setPage(1);
      prevFiltersRef.current = filters;
    }
  }, [filters, hydrated]);

  // Persist filters / sort / page to sessionStorage.
  useEffect(() => {
    if (!hydrated || !workspaceId) return;
    const existing = loadListState<PersistedListState>(LIST_STATE_KEY, workspaceId, {});
    saveListState<PersistedListState>(LIST_STATE_KEY, workspaceId, {
      ...existing,
      filters,
      sort,
      page,
    });
  }, [hydrated, workspaceId, filters, sort, page]);

  // Save scrollY on unmount.
  useEffect(() => {
    if (!hydrated || !workspaceId) return;
    return () => {
      const existing = loadListState<PersistedListState>(LIST_STATE_KEY, workspaceId, {});
      saveListState<PersistedListState>(LIST_STATE_KEY, workspaceId, {
        ...existing,
        scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
      });
    };
  }, [hydrated, workspaceId]);

  // Fetch companies
  const fetchCompanies = useCallback(async () => {
    if (!workspaceId || !hydrated) return;
    setLoading(true);
    setSelectAllMatching(false);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('companies')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .range(from, to);

    if (debouncedSearch) {
      query = query.or(
        `name.ilike.%${debouncedSearch}%,domain.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%`
      );
    }

    if (filters.country_code.length === 1) query = query.eq('country_code', filters.country_code[0]);
    else if (filters.country_code.length > 1) query = query.in('country_code', filters.country_code);

    if (filters.source.length === 1) query = query.eq('source', filters.source[0]);
    else if (filters.source.length > 1) query = query.in('source', filters.source);

    if (filters.industry.length === 1) query = query.eq('industry', filters.industry[0]);
    else if (filters.industry.length > 1) query = query.in('industry', filters.industry);

    if (filters.lifecycle_stage.length === 1) query = query.eq('lifecycle_stage', filters.lifecycle_stage[0]);
    else if (filters.lifecycle_stage.length > 1) query = query.in('lifecycle_stage', filters.lifecycle_stage);

    if (filters.customer_status.length === 1) query = query.eq('customer_status', filters.customer_status[0]);
    else if (filters.customer_status.length > 1) query = query.in('customer_status', filters.customer_status);

    if (filters.plan.length === 1) query = query.eq('plan', filters.plan[0]);
    else if (filters.plan.length > 1) query = query.in('plan', filters.plan);

    if (filters.has_account.length === 1) {
      if (filters.has_account[0] === 'yes') query = query.not('wl_workshop_id', 'is', null);
      else if (filters.has_account[0] === 'no') query = query.is('wl_workshop_id', null);
    }

    if (filters.tags.length > 0) query = query.overlaps('tags', filters.tags);

    if (filters.has_phone) query = query.not('phone', 'is', null).neq('phone', '');
    if (filters.has_domain) query = query.not('domain', 'is', null).neq('domain', '');

    const ascending = sort.dir === 'asc';
    switch (sort.key) {
      case 'name':
        query = query.order('name', { ascending, nullsFirst: false });
        break;
      case 'domain':
        query = query.order('domain', { ascending, nullsFirst: false });
        break;
      case 'country':
        query = query.order('country', { ascending, nullsFirst: false });
        break;
      case 'industry':
        query = query.order('industry', { ascending, nullsFirst: false });
        break;
      case 'last_active_at':
        query = query.order('last_active_at', { ascending, nullsFirst: false });
        break;
      case 'created_at':
      default:
        query = query.order('created_at', { ascending });
        break;
    }

    const { data, count, error } = await query;
    if (error) {
      toast.error('Failed to load companies');
      setLoading(false);
      return;
    }

    // Fetch contact and deal counts for this page
    const companyIds = (data || []).map((c) => c.id);
    let contactCounts: Record<string, number> = {};
    let dealCounts: Record<string, number> = {};

    if (companyIds.length > 0) {
      const [{ data: contacts }, { data: deals }] = await Promise.all([
        supabase
          .from('contacts')
          .select('company_id')
          .eq('workspace_id', workspaceId)
          .in('company_id', companyIds),
        supabase
          .from('deals')
          .select('company_id')
          .eq('workspace_id', workspaceId)
          .in('company_id', companyIds),
      ]);
      if (contacts) {
        contactCounts = contacts.reduce((acc, c) => {
          if (c.company_id) acc[c.company_id] = (acc[c.company_id] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }
      if (deals) {
        dealCounts = deals.reduce((acc, d) => {
          if (d.company_id) acc[d.company_id] = (acc[d.company_id] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }
    }

    const mapped: Company[] = (data || []).map((c) => ({
      ...c,
      contacts_count: contactCounts[c.id] || 0,
      deals_count: dealCounts[c.id] || 0,
    }));

    setCompanies(mapped);
    setTotalCount(count || 0);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceId, hydrated, page, debouncedSearch,
    filters.country_code, filters.source, filters.industry,
    filters.lifecycle_stage, filters.customer_status, filters.plan, filters.has_account,
    filters.tags, filters.has_phone, filters.has_domain, sort,
  ]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // Restore scroll position once after the first data load completes.
  useEffect(() => {
    if (pendingScrollY == null || loading || typeof window === 'undefined') return;
    window.scrollTo(0, pendingScrollY);
    setPendingScrollY(null);
  }, [pendingScrollY, loading]);

  // Workspace-level stats (unfiltered, fetched once)
  useEffect(() => {
    if (!workspaceId) return;
    async function fetchStats() {
      setLoadingStats(true);
      const [totalRes, domainRes, phoneRes] = await Promise.all([
        supabase.from('companies').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId!),
        supabase.from('companies').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId!).not('domain', 'is', null).neq('domain', ''),
        supabase.from('companies').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId!).not('phone', 'is', null).neq('phone', ''),
      ]);
      setStatsTotal(totalRes.count ?? 0);
      setStatsWithDomain(domainRes.count ?? 0);
      setStatsWithPhone(phoneRes.count ?? 0);
      setLoadingStats(false);

      const { count: dupCount } = await supabase
        .from('company_merge_candidates')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId!)
        .eq('status', 'pending');
      setPendingDuplicates(dupCount ?? 0);
    }
    fetchStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Distinct countries — seed with SUPPORTED_OUTBOUND_COUNTRIES,
  // then union with country_codes actually present on companies.
  useEffect(() => {
    if (!workspaceId) return;
    const seen = new Set<string>();
    const list: { code: string; name: string }[] = [];
    for (const c of SUPPORTED_OUTBOUND_COUNTRIES) {
      seen.add(c.code);
      list.push({ code: c.code, name: c.name });
    }
    supabase.from('companies').select('country_code, country').eq('workspace_id', workspaceId).not('country_code', 'is', null)
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

  // Distinct sources
  useEffect(() => {
    if (!workspaceId) return;
    supabase.from('companies').select('source').eq('workspace_id', workspaceId).not('source', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        const seen = new Set<string>();
        for (const row of data) { if (row.source) seen.add(row.source); }
        const ordered: string[] = [...ALL_SOURCES].filter((s) => seen.has(s));
        for (const s of seen) if (!ordered.includes(s)) ordered.push(s);
        setSources(ordered.length > 0 ? ordered : [...ALL_SOURCES]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Distinct industries — paginated (free-form column)
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    async function fetchIndustries() {
      const seen = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('companies')
          .select('industry')
          .eq('workspace_id', workspaceId!)
          .not('industry', 'is', null)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const row of data) { if (row.industry) seen.add(row.industry); }
        if (data.length < PAGE) break;
      }
      if (!cancelled) setIndustries([...seen].sort((a, b) => a.localeCompare(b)));
    }
    fetchIndustries();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Distinct tags — paginated
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    async function fetchTags() {
      const seen = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('companies')
          .select('tags')
          .eq('workspace_id', workspaceId!)
          .not('tags', 'is', null)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const row of data) {
          for (const t of row.tags ?? []) if (t) seen.add(t);
        }
        if (data.length < PAGE) break;
      }
      if (!cancelled) setTagOptions([...seen].sort((a, b) => a.localeCompare(b)));
    }
    fetchTags();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasActiveFilters =
    filters.search !== '' ||
    filters.country_code.length > 0 ||
    filters.source.length > 0 ||
    filters.industry.length > 0 ||
    filters.lifecycle_stage.length > 0 ||
    filters.customer_status.length > 0 ||
    filters.plan.length > 0 ||
    filters.has_account.length > 0 ||
    filters.tags.length > 0 ||
    filters.has_phone || filters.has_domain;

  const allSelected = companies.length > 0 && selectedIds.size === companies.length;
  const effectiveCount = selectAllMatching ? totalCount : selectedIds.size;

  // Build filter object for "select all matching" bulk calls — mirrors the
  // query in fetchCompanies so the server resolves the same set the user sees.
  const hasAccountValue: CompanyFilters['has_account'] =
    filters.has_account.length === 1 && (filters.has_account[0] === 'yes' || filters.has_account[0] === 'no')
      ? filters.has_account[0]
      : undefined;
  const currentFilters: CompanyFilters = {
    search: filters.search || undefined,
    country_code:    filters.country_code.length    ? filters.country_code    : undefined,
    source:          filters.source.length          ? filters.source          : undefined,
    industry:        filters.industry.length        ? filters.industry        : undefined,
    lifecycle_stage: filters.lifecycle_stage.length ? filters.lifecycle_stage : undefined,
    customer_status: filters.customer_status.length ? filters.customer_status : undefined,
    plan:            filters.plan.length            ? filters.plan            : undefined,
    has_account: hasAccountValue,
    tags:            filters.tags.length            ? filters.tags            : undefined,
    has_phone: filters.has_phone || undefined,
    has_domain: filters.has_domain || undefined,
  };

  const toggleSelect = (id: string) => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectAllMatching(false);
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(companies.map((c) => c.id)));
  };

  // ── Bulk actions ─────────────────────────────────────────────────────────────

  const handleBulkFieldUpdate = async (field: 'lifecycle_stage' | 'customer_status', value: string) => {
    if (!workspaceId || effectiveCount === 0) return;
    const body = selectAllMatching
      ? { filters: currentFilters, workspaceId, field, value }
      : { companyIds: Array.from(selectedIds), workspaceId, field, value };
    const res = await fetch('/api/companies/bulk-update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed to update companies'); return; }
    toast.success(`Updated ${data.updated} companies`);
    setSelectedIds(new Set()); setSelectAllMatching(false);
    setBulkLifecycle(''); setBulkCustomerStatus('');
    fetchCompanies();
  };

  const handleBulkDelete = async () => {
    if (!workspaceId || effectiveCount === 0) return;
    const body = selectAllMatching
      ? { filters: currentFilters, workspaceId }
      : { companyIds: Array.from(selectedIds), workspaceId };
    const res = await fetch('/api/companies/bulk-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed to delete companies'); return; }
    toast.success(`Deleted ${data.deleted} companies`);
    setSelectedIds(new Set()); setSelectAllMatching(false); setShowDeleteConfirm(false);
    fetchCompanies();
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Companies</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage your company records and track engagement</p>
          </div>
          <div className="flex items-center gap-6">
            {!loadingStats && (
              <div className="flex items-center gap-4 text-sm text-slate-600">
                <span>
                  <span className="font-semibold text-slate-900">{statsTotal.toLocaleString()}</span> companies
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  <span className="font-semibold text-slate-900">{statsWithDomain.toLocaleString()}</span> with domain
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  <span className="font-semibold text-slate-900">{statsWithPhone.toLocaleString()}</span> with phone
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              {pendingDuplicates > 0 && (
                <Link
                  href="/companies/duplicates"
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
                  title="Review fuzzy-matched duplicates"
                >
                  Review {pendingDuplicates} duplicate{pendingDuplicates === 1 ? '' : 's'}
                </Link>
              )}
              <button
                onClick={() => setColumnsOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                aria-label="Customize columns"
                title="Customize columns"
              >
                <Columns3 className="w-4 h-4" />
                Columns
              </button>
              <button
                onClick={() => setShowAddCompany(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" />
                Add Company
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-5">
        {/* Filter card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <MultiSelect
              values={filters.country_code}
              onChange={(v) => setFilters((f) => ({ ...f, country_code: v }))}
              options={countries.map((c) => ({
                value: c.code,
                label: `${c.name} (${c.code})`,
                prefix: countryFlag(c.code),
              }))}
              allLabel="countries"
            />
            <MultiSelect
              values={filters.industry}
              onChange={(v) => setFilters((f) => ({ ...f, industry: v }))}
              options={industries.map((i) => ({ value: i, label: i }))}
              allLabel="industries"
            />
            <MultiSelect
              values={filters.source}
              onChange={(v) => setFilters((f) => ({ ...f, source: v }))}
              options={(sources.length > 0 ? sources : [...ALL_SOURCES]).map((s) => ({
                value: s,
                label: SOURCE_LABELS[s] ?? s,
              }))}
              allLabel="sources"
            />
            <MultiSelect
              values={filters.lifecycle_stage}
              onChange={(v) => setFilters((f) => ({ ...f, lifecycle_stage: v }))}
              options={LIFECYCLE_OPTIONS}
              allLabel="lifecycle stages"
            />
            <MultiSelect
              values={filters.customer_status}
              onChange={(v) => setFilters((f) => ({ ...f, customer_status: v }))}
              options={CUSTOMER_STATUS_OPTIONS}
              allLabel="customer statuses"
            />
            <MultiSelect
              values={filters.plan}
              onChange={(v) => setFilters((f) => ({ ...f, plan: v }))}
              options={PLAN_OPTIONS}
              allLabel="plans"
            />
            <MultiSelect
              values={filters.has_account}
              onChange={(v) => setFilters((f) => ({ ...f, has_account: v.slice(-1) }))}
              options={HAS_ACCOUNT_OPTIONS}
              allLabel="account types"
            />
            <MultiSelect
              values={filters.tags}
              onChange={(v) => setFilters((f) => ({ ...f, tags: v }))}
              options={tagOptions.map((t) => ({ value: t, label: t }))}
              allLabel="tags"
            />

            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none ml-2">
              <input
                type="checkbox"
                checked={filters.has_phone}
                onChange={(e) => setFilters((f) => ({ ...f, has_phone: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Has phone
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.has_domain}
                onChange={(e) => setFilters((f) => ({ ...f, has_domain: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Has domain
            </label>
          </div>

          {/* Search + Clear all */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, domain, or phone..."
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
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
                  {columnIds.map((id) => {
                    const col = COLUMN_BY_ID[id];
                    if (!col) return null;
                    if (col.sortable) {
                      return (
                        <SortableTh
                          key={id}
                          sortKey={id as SortKey}
                          label={col.label}
                          sort={sort}
                          onClick={handleSortClick}
                        />
                      );
                    }
                    return (
                      <th key={id} className="text-left px-4 py-3 font-medium text-slate-600">
                        {col.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Select-all-matching banner */}
                {!loading && allSelected && !selectAllMatching && totalCount > companies.length && (
                  <tr>
                    <td colSpan={columnIds.length + 1} className="bg-indigo-50 border-b border-indigo-100 text-center py-2.5 text-sm text-slate-600">
                      All {companies.length} companies on this page are selected.{' '}
                      <button
                        onClick={() => setSelectAllMatching(true)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium underline"
                      >
                        Select all {totalCount.toLocaleString()} companies matching current filters
                      </button>
                    </td>
                  </tr>
                )}
                {!loading && selectAllMatching && (
                  <tr>
                    <td colSpan={columnIds.length + 1} className="bg-indigo-100 border-b border-indigo-200 text-center py-2.5 text-sm text-slate-700">
                      All {totalCount.toLocaleString()} companies matching current filters are selected.{' '}
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
                      {columnIds.map((id) => (
                        <td key={id} className="px-4 py-3"><div className="h-4 w-24 bg-slate-200 rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : companies.length === 0 ? (
                  <tr>
                    <td colSpan={columnIds.length + 1} className="px-4 py-16 text-center">
                      <p className="text-slate-500 font-medium">No companies found</p>
                      <p className="text-slate-400 text-sm mt-1">
                        {hasActiveFilters ? 'Try adjusting your filters' : 'Add your first company to get started'}
                      </p>
                      {!hasActiveFilters && (
                        <button
                          onClick={() => setShowAddCompany(true)}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                        >
                          <Plus className="w-4 h-4" />
                          Add Company
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  companies.map((company) => (
                    <tr key={company.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(company.id)}
                          onChange={() => toggleSelect(company.id)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      {columnIds.map((id) => (
                        <td key={id} className="px-4 py-3">
                          {renderCell(id, company)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalCount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
              <p className="text-sm text-slate-600">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
          <span className="text-sm font-medium">{effectiveCount.toLocaleString()} companies selected</span>
          <div className="h-5 w-px bg-slate-600" />
          <select
            value={bulkLifecycle}
            onChange={(e) => { if (e.target.value) handleBulkFieldUpdate('lifecycle_stage', e.target.value); }}
            className="text-sm bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white"
          >
            <option value="">Set Lifecycle Stage</option>
            {LIFECYCLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={bulkCustomerStatus}
            onChange={(e) => { if (e.target.value) handleBulkFieldUpdate('customer_status', e.target.value); }}
            className="text-sm bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white"
          >
            <option value="">Set Customer Status</option>
            {CUSTOMER_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-600 rounded-lg hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Companies">
        <p className="text-sm text-slate-600 mb-4">
          Are you sure you want to delete {effectiveCount.toLocaleString()} compan{effectiveCount === 1 ? 'y' : 'ies'}? This action cannot be undone.
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

      <ColumnCustomizer
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        visibleIds={columnIds}
        onChange={handleColumnsChange}
      />

      <SlideOver open={showAddCompany} onClose={() => setShowAddCompany(false)} title="Add Company">
        <AddCompanyForm
          workspaceId={workspaceId}
          onSuccess={() => { setShowAddCompany(false); fetchCompanies(); }}
        />
      </SlideOver>
    </div>
  );
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function renderCell(id: ColumnId, company: Company): React.ReactNode {
  switch (id) {
    case 'name':
      return (
        <Link href={`/companies/${company.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
          {company.name || '—'}
        </Link>
      );
    case 'domain':
      return company.domain ? (
        <span className="text-indigo-600">{company.domain}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'website':
      return company.website ? (
        <a
          href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
        >
          <Globe className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate max-w-[180px]">{company.website}</span>
        </a>
      ) : <span className="text-slate-400">—</span>;
    case 'phone':
      return company.phone ? (
        <a href={`tel:${company.phone}`} className="flex items-center gap-1 text-indigo-600 hover:underline">
          <Phone className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate max-w-[130px]">{company.phone}</span>
        </a>
      ) : <span className="text-slate-400">—</span>;
    case 'city':
      return company.city ? (
        <span className="text-slate-700">{company.city}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'country':
      return company.country_code ? (
        <span className="text-sm text-slate-600">
          {countryFlag(company.country_code)} {company.country ?? company.country_code}
        </span>
      ) : <span className="text-slate-400">—</span>;
    case 'industry':
      return company.industry ? (
        <span className="text-slate-700">{company.industry}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'category':
      return company.category ? (
        <span className="text-xs text-slate-600 capitalize">{company.category}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'contacts_count':
      return <span className="text-slate-600">{company.contacts_count}</span>;
    case 'deals_count':
      return <span className="text-slate-600">{company.deals_count}</span>;
    case 'lifecycle_stage':
      return company.lifecycle_stage ? (
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
          company.lifecycle_stage === 'paying'       ? 'bg-emerald-100 text-emerald-700' :
          company.lifecycle_stage === 'freemium'     ? 'bg-teal-100 text-teal-700' :
          company.lifecycle_stage === 'trial'        ? 'bg-amber-100 text-amber-700' :
          company.lifecycle_stage === 'churned'      ? 'bg-red-100 text-red-700' :
          company.lifecycle_stage === 'reactivation' ? 'bg-purple-100 text-purple-700' :
                                                       'bg-slate-100 text-slate-700'
        }`}>{company.lifecycle_stage}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'customer_status':
      return company.customer_status ? (
        <span className="text-xs text-slate-700 capitalize">{company.customer_status}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'plan': {
      const plan = company.plan;
      if (plan) {
        const label = PLAN_LABELS[plan] ?? plan;
        return (
          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
            plan === 'free'                                     ? 'bg-slate-100 text-slate-700' :
            plan === 'small_monthly' || plan === 'small_yearly' ? 'bg-blue-100 text-blue-700' :
            plan === 'large_monthly' || plan === 'large_yearly' ? 'bg-indigo-100 text-indigo-700' :
                                                                  'bg-slate-100 text-slate-700'
          }`}>{label}</span>
        );
      }
      return company.wl_workshop_id
        ? <span className="text-xs text-slate-500 italic">No plan</span>
        : <span className="text-slate-400">—</span>;
    }
    case 'has_account':
      return company.wl_workshop_id ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-violet-100 text-violet-700">
          <Building2 className="w-3 h-3" />
          App workshop
        </span>
      ) : <span className="text-xs text-slate-400">prospect</span>;
    case 'source':
      return company.source ? (
        <span className="text-xs text-slate-600">{SOURCE_LABELS[company.source] ?? company.source}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'tags': {
      const tags = (company.tags as string[] | null) || [];
      if (tags.length === 0) return <span className="text-slate-400">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((t, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-700">
              {t}
            </span>
          ))}
          {tags.length > 3 && <span className="text-[10px] text-slate-400">+{tags.length - 3}</span>}
        </div>
      );
    }
    case 'last_active_at':
      return company.last_active_at ? (
        <span className="text-xs text-slate-500" title={company.last_active_at}>
          {formatDistanceToNow(new Date(company.last_active_at), { addSuffix: true })}
        </span>
      ) : <span className="text-slate-400">—</span>;
    case 'created_at':
      return company.created_at ? (
        <span className="text-slate-500">{format(new Date(company.created_at), 'MMM d, yyyy')}</span>
      ) : <span className="text-slate-400">—</span>;
    case 'updated_at':
      return company.updated_at ? (
        <span className="text-xs text-slate-500" title={company.updated_at}>
          {formatDistanceToNow(new Date(company.updated_at), { addSuffix: true })}
        </span>
      ) : <span className="text-slate-400">—</span>;
    default:
      return null;
  }
}

// ── Sortable column header ────────────────────────────────────────────────────

function SortableTh({
  sortKey, label, sort, onClick,
}: {
  sortKey: SortKey;
  label: string;
  sort: { key: SortKey; dir: SortDir };
  onClick: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : null;
  return (
    <th
      className="text-left px-4 py-3 font-medium text-slate-600"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`group inline-flex items-center gap-1 hover:text-slate-900 ${
          active ? 'text-slate-900' : 'text-slate-600'
        }`}
      >
        {label}
        {Icon ? (
          <Icon className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
        )}
      </button>
    </th>
  );
}

// ── Add Company Form ──────────────────────────────────────────────────────────

function AddCompanyForm({
  workspaceId,
  onSuccess,
}: {
  workspaceId: string | null;
  onSuccess: () => void;
}) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    domain: '',
    industry: '',
    employee_count: '',
    annual_revenue: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Company name is required';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .insert({
        workspace_id: workspaceId,
        name: form.name.trim(),
        domain: form.domain.trim() || null,
        industry: form.industry || null,
        employee_count: form.employee_count ? parseInt(form.employee_count) : null,
        annual_revenue: form.annual_revenue ? parseFloat(form.annual_revenue) : null,
      });

    if (error) {
      toast.error('Failed to create company');
      setSaving(false);
      return;
    }

    toast.success('Company created');
    setSaving(false);
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setErrors({}); }}
          className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.name ? 'border-red-300' : 'border-slate-300'}`}
        />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Domain</label>
        <input
          type="text"
          value={form.domain}
          onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
          placeholder="example.com"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
        <select
          value={form.industry}
          onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select industry</option>
          {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Employee Count</label>
        <input
          type="number"
          value={form.employee_count}
          onChange={(e) => setForm((f) => ({ ...f, employee_count: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Annual Revenue</label>
        <input
          type="number"
          value={form.annual_revenue}
          onChange={(e) => setForm((f) => ({ ...f, annual_revenue: e.target.value }))}
          placeholder="0"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div className="pt-4 border-t border-slate-200">
        <button
          type="submit"
          disabled={saving}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Company'}
        </button>
      </div>
    </form>
  );
}
