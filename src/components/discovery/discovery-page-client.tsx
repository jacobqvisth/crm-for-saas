"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import {
  MapPin,
  Phone,
  Mail,
  Globe,
  Star,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  Loader2,
  X,
  CheckSquare,
  Square,
  CheckCircle,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Shop = {
  id: string;
  name: string;
  google_place_id: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  state: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  domain: string | null;
  primary_email: string | null;
  all_emails: string[] | null;
  all_phones: string[] | null;
  instagram_url: string | null;
  facebook_url: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  source: string;
  status: string;
  crm_company_id: string | null;
  crm_contact_id: string | null;
  scraped_at: string | null;
  email_valid: boolean | null;
  email_check_detail: string | null;
};

type Stats = {
  total: number;
  by_status: Record<string, number>;
  by_country: Record<string, number>;
  with_email: number;
  with_phone: number;
};

type Filters = {
  country_code: string;
  status: string; // "new,enriched" | "new" | "enriched" | "imported" | "skipped" | "all"
  has_email: boolean;
  has_phone: boolean;
  verified_email: boolean;
  search: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  EE: "🇪🇪",
  SE: "🇸🇪",
  FI: "🇫🇮",
  NO: "🇳🇴",
  DK: "🇩🇰",
  LV: "🇱🇻",
  LT: "🇱🇹",
  DE: "🇩🇪",
  FR: "🇫🇷",
  GB: "🇬🇧",
  NL: "🇳🇱",
  PL: "🇵🇱",
  US: "🇺🇸",
};

function countryFlag(code: string): string {
  return COUNTRY_FLAGS[code] ?? "🏳️";
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  enriched: "bg-purple-100 text-purple-700",
  imported: "bg-green-100 text-green-700",
  skipped: "bg-slate-100 text-slate-500",
};

// ─── Detail Popover ────────────────────────────────────────────────────────────

function ShopDetailPopover({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 left-0 top-6 w-80 bg-white border border-slate-200 rounded-xl shadow-lg p-4 text-sm"
    >
      <div className="flex items-start justify-between mb-3">
        <span className="font-semibold text-slate-900 leading-snug">{shop.name}</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-2 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {shop.address && (
        <p className="text-slate-600 mb-2 flex gap-1.5">
          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
          {shop.address}
        </p>
      )}

      {shop.category && (
        <p className="text-slate-500 mb-2 text-xs">{shop.category}</p>
      )}

      {shop.all_emails && shop.all_emails.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium text-slate-500 mb-1">All emails</p>
          {shop.all_emails.map((e) => (
            <a key={e} href={`mailto:${e}`} className="block text-indigo-600 hover:underline truncate">
              {e}
            </a>
          ))}
        </div>
      )}

      {shop.all_phones && shop.all_phones.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium text-slate-500 mb-1">All phones</p>
          {shop.all_phones.map((p) => (
            <a key={p} href={`tel:${p}`} className="block text-indigo-600 hover:underline">
              {p}
            </a>
          ))}
        </div>
      )}

      <div className="flex gap-3 mt-3 pt-3 border-t border-slate-100">
        {shop.instagram_url && (
          <a
            href={shop.instagram_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-pink-600 hover:underline flex items-center gap-1"
          >
            Instagram <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {shop.facebook_url && (
          <a
            href={shop.facebook_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            Facebook <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {shop.google_place_id && (
          <a
            href={`https://www.google.com/maps/place/?q=place_id:${shop.google_place_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-600 hover:underline flex items-center gap-1"
          >
            Maps <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Row Actions Menu ─────────────────────────────────────────────────────────

function RowActions({
  shop,
  onPromote,
  onSkip,
}: {
  shop: Shop;
  onPromote: (ids: string[]) => void;
  onSkip: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-40 bg-white border border-slate-200 rounded-lg shadow-md w-44 py-1 text-sm">
          <button
            onClick={() => { setOpen(false); onPromote([shop.id]); }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700"
          >
            Promote to CRM
          </button>
          <button
            onClick={() => { setOpen(false); onSkip([shop.id]); }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700"
          >
            Skip
          </button>
          {shop.google_place_id && (
            <a
              href={`https://www.google.com/maps/place/?q=place_id:${shop.google_place_id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 px-3 py-2 hover:bg-slate-50 text-slate-700"
            >
              View on Google Maps <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function DiscoveryPageClient() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingShops, setLoadingShops] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    country_code: "",
    status: "", // empty = default (new + enriched)
    has_email: false,
    has_phone: false,
    verified_email: false,
    search: "",
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedShop, setExpandedShop] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Debounce search
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [filters.search]);

  // ── Fetch stats once
  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/discovery/stats");
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setStats(data);
      } catch {
        toast.error("Failed to load stats");
      } finally {
        setLoadingStats(false);
      }
    }
    fetchStats();
  }, []);

  // ── Fetch shops whenever filters/page change
  const fetchShops = useCallback(async () => {
    setLoadingShops(true);
    setSelectedIds(new Set());
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", String(PER_PAGE));
      if (filters.country_code) params.set("country_code", filters.country_code);
      if (filters.status) params.set("status", filters.status);
      if (filters.has_email) params.set("has_email", "true");
      if (filters.has_phone) params.set("has_phone", "true");
      if (filters.verified_email) params.set("verified_email", "true");
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/discovery/shops?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setShops(data.shops);
      setTotal(data.total);
    } catch {
      toast.error("Failed to load shops");
    } finally {
      setLoadingShops(false);
    }
  }, [page, filters.country_code, filters.status, filters.has_email, filters.has_phone, filters.verified_email, debouncedSearch]);

  useEffect(() => {
    fetchShops();
  }, [fetchShops]);

  // Reset page when filters change
  const prevFilters = useRef(filters);
  useEffect(() => {
    if (prevFilters.current !== filters) {
      setPage(1);
      prevFilters.current = filters;
    }
  }, [filters]);

  // ── Actions
  const handlePromote = useCallback(async (ids: string[]) => {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/discovery/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_ids: ids }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      toast.success(
        `Promoted ${data.promoted} shop${data.promoted !== 1 ? "s" : ""}` +
        (data.skipped_duplicates > 0 ? ` · ${data.skipped_duplicates} duplicate${data.skipped_duplicates !== 1 ? "s" : ""} skipped` : "") +
        (data.skipped_invalid_email > 0 ? ` · ${data.skipped_invalid_email} invalid email${data.skipped_invalid_email !== 1 ? "s" : ""} skipped` : "")
      );
      setSelectedIds(new Set());
      fetchShops();
    } catch {
      toast.error("Promote failed");
    } finally {
      setBulkLoading(false);
    }
  }, [fetchShops]);

  const handleSkip = useCallback(async (ids: string[]) => {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/discovery/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_ids: ids }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      toast.success(`Skipped ${data.skipped} shop${data.skipped !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      fetchShops();
    } catch {
      toast.error("Skip failed");
    } finally {
      setBulkLoading(false);
    }
  }, [fetchShops]);

  // ── Selection
  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === shops.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(shops.map((s) => s.id)));
    }
  };

  const allSelected = shops.length > 0 && selectedIds.size === shops.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  // ── Country options from stats
  const countryOptions = stats
    ? Object.keys(stats.by_country).sort()
    : [];

  // ── Status tab config
  const statusTabs = [
    { label: "New + Enriched", value: "" },
    { label: "New", value: "new" },
    { label: "Enriched", value: "enriched" },
    { label: "Imported", value: "imported" },
    { label: "Skipped", value: "skipped" },
    { label: "All", value: "all" },
  ];

  const from = (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, total);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* ── Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-indigo-600" />
              Shop Discovery
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Review scraped shops and promote them to your CRM
            </p>
          </div>

          {/* Stats bar */}
          {!loadingStats && stats && (
            <div className="flex items-center gap-4 text-sm text-slate-600">
              <span>
                <span className="font-semibold text-slate-900">{stats.total.toLocaleString()}</span>{" "}
                total shops
              </span>
              <span className="text-slate-300">·</span>
              <span>
                <span className="font-semibold text-slate-900">{stats.with_email.toLocaleString()}</span>{" "}
                with email
              </span>
              <span className="text-slate-300">·</span>
              <span>
                <span className="font-semibold text-slate-900">{stats.with_phone.toLocaleString()}</span>{" "}
                with phone
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 p-6 space-y-5">
        {/* ── Filter bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          {/* Status tabs */}
          <div className="flex flex-wrap gap-1">
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilters((f) => ({ ...f, status: tab.value }))}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.status === tab.value
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab.label}
                {stats && tab.value !== "" && tab.value !== "all" && stats.by_status[tab.value] != null && (
                  <span className="ml-1 opacity-70">
                    ({stats.by_status[tab.value] ?? 0})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Row 2: country, email, phone, search */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Country */}
            <select
              value={filters.country_code}
              onChange={(e) => setFilters((f) => ({ ...f, country_code: e.target.value }))}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All countries</option>
              {countryOptions.map((cc) => (
                <option key={cc} value={cc}>
                  {countryFlag(cc)} {cc}
                </option>
              ))}
            </select>

            {/* Has email */}
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.has_email}
                onChange={(e) => setFilters((f) => ({ ...f, has_email: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Has email
            </label>

            {/* Has phone */}
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.has_phone}
                onChange={(e) => setFilters((f) => ({ ...f, has_phone: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Has phone
            </label>

            {/* Verified email */}
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.verified_email}
                onChange={(e) => setFilters((f) => ({ ...f, verified_email: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Verified email
            </label>

            {/* Search */}
            <div className="flex-1 min-w-48">
              <input
                type="text"
                placeholder="Search name, city, domain…"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* ── Stats cards */}
        {!loadingShops && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Showing", value: total.toLocaleString() },
              {
                label: "With email",
                value: shops.filter((s) => s.primary_email).length.toLocaleString() + " on page",
              },
              {
                label: "With phone",
                value: shops.filter((s) => s.phone).length.toLocaleString() + " on page",
              },
              {
                label: "Already imported",
                value: shops.filter((s) => s.status === "imported").length.toLocaleString() + " on page",
              },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white border border-slate-200 rounded-xl px-4 py-3"
              >
                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{card.label}</p>
                <p className="text-xl font-semibold text-slate-900 mt-0.5">{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loadingShops ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading shops…
            </div>
          ) : shops.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <MapPin className="w-10 h-10 mb-3 text-slate-300" />
              <p className="text-sm">No shops match your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <button onClick={toggleAll} className="text-slate-400 hover:text-slate-600">
                        {allSelected ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600" />
                        ) : someSelected ? (
                          <CheckSquare className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Name</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">City</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Country</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Phone</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Email</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Website</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Category</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Rating</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Status</th>
                    <th className="w-12 px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shops.map((shop) => (
                    <tr
                      key={shop.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        selectedIds.has(shop.id) ? "bg-indigo-50" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-3">
                        <button
                          onClick={() => toggleRow(shop.id)}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          {selectedIds.has(shop.id) ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      {/* Name + popover */}
                      <td className="px-3 py-3 max-w-[200px]">
                        <div className="relative">
                          <button
                            onClick={() =>
                              setExpandedShop((prev) =>
                                prev === shop.id ? null : shop.id
                              )
                            }
                            className="font-medium text-slate-900 hover:text-indigo-600 text-left truncate max-w-full block"
                          >
                            {shop.name}
                          </button>
                          {expandedShop === shop.id && (
                            <ShopDetailPopover
                              shop={shop}
                              onClose={() => setExpandedShop(null)}
                            />
                          )}
                        </div>
                      </td>

                      {/* City */}
                      <td className="px-3 py-3 text-slate-600">
                        {shop.city ?? <span className="text-slate-300">—</span>}
                      </td>

                      {/* Country */}
                      <td className="px-3 py-3 text-slate-600">
                        {shop.country_code ? (
                          <span title={shop.country ?? shop.country_code}>
                            {countryFlag(shop.country_code)} {shop.country_code}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Phone */}
                      <td className="px-3 py-3">
                        {shop.phone ? (
                          <a
                            href={`tel:${shop.phone}`}
                            className="flex items-center gap-1 text-indigo-600 hover:underline"
                          >
                            <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate max-w-[130px]">{shop.phone}</span>
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Email */}
                      <td className="px-3 py-3 max-w-[180px]">
                        {shop.primary_email ? (
                          shop.email_valid === false ? (
                            <span className="flex items-center gap-1 text-slate-500">
                              <span
                                title={
                                  shop.email_check_detail === "domain_not_found"
                                    ? "Domain does not exist"
                                    : shop.email_check_detail === "no_mx_records"
                                    ? "No mail server found"
                                    : shop.email_check_detail === "invalid_format"
                                    ? "Invalid email format"
                                    : shop.email_check_detail ?? "Invalid"
                                }
                              >
                                <XCircle className="w-3 h-3 flex-shrink-0 text-red-400" />
                              </span>
                              <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{shop.primary_email}</span>
                            </span>
                          ) : (
                            <a
                              href={`mailto:${shop.primary_email}`}
                              className="flex items-center gap-1 text-indigo-600 hover:underline"
                            >
                              {shop.email_valid === true && (
                                <CheckCircle className="w-3 h-3 flex-shrink-0 text-emerald-500" />
                              )}
                              <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{shop.primary_email}</span>
                            </a>
                          )
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Website */}
                      <td className="px-3 py-3 max-w-[150px]">
                        {shop.website ? (
                          <a
                            href={shop.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-indigo-600 hover:underline"
                          >
                            <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{stripProtocol(shop.website)}</span>
                            <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-50" />
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-3">
                        {shop.category ? (
                          <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full truncate max-w-[120px] block">
                            {shop.category}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Rating */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {shop.rating != null ? (
                          <span className="flex items-center gap-1 text-slate-600">
                            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                            {shop.rating}
                            {shop.review_count != null && (
                              <span className="text-slate-400 text-xs">
                                · {shop.review_count}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-3">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                            STATUS_COLORS[shop.status] ?? "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {shop.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-3">
                        <RowActions
                          shop={shop}
                          onPromote={handlePromote}
                          onSkip={handleSkip}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loadingShops && total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
              <span>
                Showing {from}–{to} of {total.toLocaleString()} shops
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
            <span className="font-medium">
              {selectedIds.size} shop{selectedIds.size !== 1 ? "s" : ""} selected
            </span>
            <div className="w-px h-5 bg-slate-600" />
            <button
              onClick={() => handlePromote(Array.from(selectedIds))}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Promote to CRM
            </button>
            <button
              onClick={() => handleSkip(Array.from(selectedIds))}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-slate-400 hover:text-white transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
