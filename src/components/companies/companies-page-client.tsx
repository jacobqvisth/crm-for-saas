'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search, X, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { SlideOver } from '@/components/ui/slide-over';
import toast from 'react-hot-toast';
import type { Tables } from '@/lib/database.types';

type CompanyWithCounts = Tables<'companies'> & { contacts_count: number; deals_count: number };

const PAGE_SIZE = 50;

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing',
  'Retail', 'Real Estate', 'Media', 'Consulting', 'Legal', 'Other',
];

export function CompaniesPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [companies, setCompanies] = useState<CompanyWithCounts[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddCompany, setShowAddCompany] = useState(false);

  const page = Number(searchParams.get('page') || '1');
  const search = searchParams.get('search') || '';
  const sort = searchParams.get('sort') || 'name';

  const [searchInput, setSearchInput] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const updateParams = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    if (!('page' in updates)) params.set('page', '1');
    router.push(`/companies?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchInput !== search) {
        updateParams({ search: searchInput });
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput, search, updateParams]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    async function fetchCompanies() {
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('companies')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId!)
        .range(from, to);

      if (search) {
        query = query.or(`name.ilike.%${search}%,domain.ilike.%${search}%`);
      }

      if (sort === 'name') {
        query = query.order('name', { ascending: true });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      const { data, count, error } = await query;
      if (cancelled) return;
      if (error) {
        toast.error('Failed to load companies');
        setLoading(false);
        return;
      }

      // Fetch contact and deal counts
      const companyIds = (data || []).map(c => c.id);
      let contactCounts: Record<string, number> = {};
      let dealCounts: Record<string, number> = {};

      if (companyIds.length > 0) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('company_id')
          .eq('workspace_id', workspaceId!)
          .in('company_id', companyIds);

        if (contacts) {
          contactCounts = contacts.reduce((acc, c) => {
            if (c.company_id) acc[c.company_id] = (acc[c.company_id] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
        }

        const { data: deals } = await supabase
          .from('deals')
          .select('company_id')
          .eq('workspace_id', workspaceId!)
          .in('company_id', companyIds);

        if (deals) {
          dealCounts = deals.reduce((acc, d) => {
            if (d.company_id) acc[d.company_id] = (acc[d.company_id] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
        }
      }

      const mapped: CompanyWithCounts[] = (data || []).map(c => ({
        ...c,
        contacts_count: contactCounts[c.id] || 0,
        deals_count: dealCounts[c.id] || 0,
      }));

      setCompanies(mapped);
      setTotalCount(count || 0);
      setLoading(false);
    }

    fetchCompanies();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, page, search, sort]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
          <p className="text-sm text-slate-500 mt-1">Manage your company records</p>
        </div>
        <button
          onClick={() => setShowAddCompany(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          Add Company
        </button>
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or domain..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); updateParams({ search: '' }); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => updateParams({ sort: e.target.value })}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="name">Sort by Name</option>
          <option value="created_at">Sort by Created</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Domain</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Industry</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Contacts</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Deals</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-28 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-8 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-8 bg-slate-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-200 rounded" /></td>
                  </tr>
                ))
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <p className="text-slate-500 font-medium">No companies yet</p>
                    <p className="text-slate-400 text-sm mt-1">Add your first company to get started</p>
                    <button
                      onClick={() => setShowAddCompany(true)}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                    >
                      <Plus className="w-4 h-4" />
                      Add Company
                    </button>
                  </td>
                </tr>
              ) : (
                companies.map((company, i) => (
                  <tr
                    key={company.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/companies/${company.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                        {company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {company.domain ? (
                        <span className="text-indigo-600">{company.domain}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{company.industry || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{company.contacts_count}</td>
                    <td className="px-4 py-3 text-slate-600">{company.deals_count}</td>
                    <td className="px-4 py-3 text-slate-500">{format(new Date(company.created_at), 'MMM d, yyyy')}</td>
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
                onClick={() => updateParams({ page: String(page - 1) })}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => updateParams({ page: String(page + 1) })}
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

      {/* Add Company Slide-Over */}
      <SlideOver open={showAddCompany} onClose={() => setShowAddCompany(false)} title="Add Company">
        <AddCompanyForm
          workspaceId={workspaceId}
          onSuccess={() => {
            setShowAddCompany(false);
            updateParams({});
          }}
        />
      </SlideOver>
    </div>
  );
}

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
          onChange={(e) => { setForm(f => ({ ...f, name: e.target.value })); setErrors({}); }}
          className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.name ? 'border-red-300' : 'border-slate-300'}`}
        />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Domain</label>
        <input
          type="text"
          value={form.domain}
          onChange={(e) => setForm(f => ({ ...f, domain: e.target.value }))}
          placeholder="example.com"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
        <select
          value={form.industry}
          onChange={(e) => setForm(f => ({ ...f, industry: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select industry</option>
          {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Employee Count</label>
        <input
          type="number"
          value={form.employee_count}
          onChange={(e) => setForm(f => ({ ...f, employee_count: e.target.value }))}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Annual Revenue</label>
        <input
          type="number"
          value={form.annual_revenue}
          onChange={(e) => setForm(f => ({ ...f, annual_revenue: e.target.value }))}
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
