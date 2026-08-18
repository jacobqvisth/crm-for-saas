'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  RadioTower,
} from 'lucide-react';
import type { Database } from '@/lib/database.types';

type Finding = Database['public']['Tables']['security_findings']['Row'];
type Scan = Database['public']['Tables']['security_scans']['Row'];

type ScanDetail = { name: string; ok: boolean; detail?: string };

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type FindingStatus = 'open' | 'fixed' | 'accepted_risk' | 'wont_fix';

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const STATUS_RANK: Record<string, number> = {
  open: 0,
  fixed: 1,
  accepted_risk: 2,
  wont_fix: 3,
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  info: 0,
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

const SEVERITY_PILL_CLASSES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
  info: 'bg-sky-100 text-sky-700',
};

const SEVERITY_DOT_CLASSES: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-slate-400',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  fixed: 'Fixed',
  accepted_risk: 'Accepted risk',
  wont_fix: "Won't fix",
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Auth',
  idor: 'IDOR',
  xss: 'XSS',
  injection: 'Injection',
  secrets: 'Secrets',
  headers: 'Headers',
  deps: 'Dependencies',
  cron: 'Cron',
  rls: 'RLS',
  config: 'Config',
  external: 'External',
  other: 'Other',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

function gradeFromScore(score: number): { letter: string; className: string } {
  if (score >= 90) return { letter: 'A', className: 'text-emerald-600' };
  if (score >= 80) return { letter: 'B', className: 'text-emerald-600' };
  if (score >= 70) return { letter: 'C', className: 'text-amber-600' };
  if (score >= 55) return { letter: 'D', className: 'text-red-600' };
  return { letter: 'F', className: 'text-red-600' };
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const severityDiff = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (severityDiff !== 0) return severityDiff;
    const statusDiff = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
    if (statusDiff !== 0) return statusDiff;
    return new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime();
  });
}

export default function SecurityPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | FindingStatus>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [findingsRes, scansRes] = await Promise.all([
        fetch('/api/settings/security/findings'),
        fetch('/api/settings/security/scans'),
      ]);
      if (findingsRes.ok) {
        const data = await findingsRes.json();
        setFindings(data.findings || []);
      }
      if (scansRes.ok) {
        const data = await scansRes.json();
        setScans(data.scans || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = async (finding: Finding, status: FindingStatus) => {
    const previous = finding.status;
    setFindings((prev) =>
      prev.map((f) =>
        f.id === finding.id
          ? { ...f, status, fixed_at: status === 'fixed' ? new Date().toISOString() : null }
          : f,
      ),
    );

    const res = await fetch('/api/settings/security/findings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: finding.id, status }),
    });

    if (!res.ok) {
      setFindings((prev) => prev.map((f) => (f.id === finding.id ? { ...f, status: previous } : f)));
      toast.error('Failed to update finding');
      return;
    }

    toast.success('Finding updated');
  };

  const openFindings = useMemo(() => findings.filter((f) => f.status === 'open'), [findings]);
  const fixedFindings = useMemo(() => findings.filter((f) => f.status !== 'open'), [findings]);

  const score = useMemo(() => {
    const penalty = openFindings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity as Severity] ?? 0), 0);
    return Math.max(0, Math.min(100, 100 - penalty));
  }, [openFindings]);

  const grade = gradeFromScore(score);

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of openFindings) {
      if (f.severity in counts) counts[f.severity] += 1;
    }
    return counts;
  }, [openFindings]);

  const filteredFindings = useMemo(() => {
    return sortFindings(
      findings.filter((f) => {
        if (statusFilter !== 'all' && f.status !== statusFilter) return false;
        if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
        if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
        return true;
      }),
    );
  }, [findings, statusFilter, severityFilter, categoryFilter]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/settings" className="text-sm text-indigo-600 hover:text-indigo-700">
          &larr; Settings
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-1">
        <ShieldAlert className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Hacker Rating</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Security posture of the CRM — audit findings, fixes, and automated daily checks.
      </p>

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Grade hero card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 flex items-center gap-6">
            <div className={`text-6xl font-bold leading-none ${grade.className}`}>{grade.letter}</div>
            <div>
              <p className={`text-2xl font-semibold ${grade.className}`}>{score} / 100</p>
              <p className="text-sm text-slate-500 mt-1">
                {openFindings.length} open &middot; {fixedFindings.length} resolved
              </p>
            </div>
          </div>

          {/* Severity tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
              <div key={sev} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${SEVERITY_DOT_CLASSES[sev]}`} />
                  <p className="text-xs text-slate-500">{SEVERITY_LABELS[sev]}</p>
                </div>
                <p className="text-2xl font-bold text-slate-900">{severityCounts[sev]}</p>
              </div>
            ))}
          </div>

          {/* Findings */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
            <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-200 bg-slate-50">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | FindingStatus)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="fixed">Fixed</option>
                <option value="accepted_risk">Accepted risk</option>
                <option value="wont_fix">Won&apos;t fix</option>
              </select>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as 'all' | Severity)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="info">Info</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All categories</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
              <span className="ml-auto text-xs text-slate-500">
                {filteredFindings.length} finding{filteredFindings.length === 1 ? '' : 's'}
              </span>
            </div>

            {filteredFindings.length === 0 ? (
              <div className="py-16 text-center">
                <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No findings match these filters</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredFindings.map((finding) => (
                  <FindingRow key={finding.id} finding={finding} onStatusChange={handleStatusChange} />
                ))}
              </div>
            )}
          </div>

          {/* Automated scans */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-slate-200 bg-slate-50">
              <RadioTower className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">Automated scans</h2>
            </div>

            {scans.length === 0 ? (
              <div className="py-16 text-center px-6">
                <p className="text-sm text-slate-500">
                  No automated scans have run yet. The daily security-scan cron and the CI static scan will
                  populate this.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {scans.map((scan) => (
                  <ScanRow
                    key={scan.id}
                    scan={scan}
                    expanded={expandedScanId === scan.id}
                    onToggle={() => setExpandedScanId((prev) => (prev === scan.id ? null : scan.id))}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FindingRow({
  finding,
  onStatusChange,
}: {
  finding: Finding;
  onStatusChange: (finding: Finding, status: FindingStatus) => void;
}) {
  const deemphasized = finding.status !== 'open';

  return (
    <div className={`p-4 ${deemphasized ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                SEVERITY_PILL_CLASSES[finding.severity] || 'bg-slate-100 text-slate-700'
              }`}
            >
              {SEVERITY_LABELS[finding.severity] || finding.severity}
            </span>
            <span className="text-xs text-slate-400">{CATEGORY_LABELS[finding.category] || finding.category}</span>
            {deemphasized && (
              <span className="text-xs text-slate-400">&middot; {STATUS_LABELS[finding.status]}</span>
            )}
          </div>
          <h3 className={`text-sm font-semibold text-slate-900 ${deemphasized ? 'line-through' : ''}`}>
            {finding.title}
          </h3>
          {finding.affected_path && (
            <p className="text-xs font-mono text-slate-400 truncate mt-0.5">{finding.affected_path}</p>
          )}
          <p className="text-sm text-slate-600 mt-1.5">{finding.description}</p>
          {finding.remediation && (
            <p className="text-sm text-slate-500 mt-1">
              <span className="font-medium text-slate-600">Fix:</span> {finding.remediation}
            </p>
          )}
        </div>
        <select
          value={finding.status}
          onChange={(e) => onStatusChange(finding, e.target.value as FindingStatus)}
          className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0"
        >
          <option value="open">Open</option>
          <option value="fixed">Fixed</option>
          <option value="accepted_risk">Accepted risk</option>
          <option value="wont_fix">Won&apos;t fix</option>
        </select>
      </div>
    </div>
  );
}

function ScanRow({ scan, expanded, onToggle }: { scan: Scan; expanded: boolean; onToggle: () => void }) {
  const details: ScanDetail[] = Array.isArray(scan.details) ? (scan.details as unknown as ScanDetail[]) : [];
  const severityCounts = (scan.severity_counts as Record<string, number> | null) || {};
  const scanTypeLabel = scan.scan_type === 'live_probe' ? 'Live probe' : scan.scan_type === 'ci_static' ? 'CI static' : scan.scan_type;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        )}
        {scan.passed ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
        )}
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 shrink-0">
          {scanTypeLabel}
        </span>
        <span className="text-sm text-slate-600 flex-1">
          {formatDistanceToNow(new Date(scan.ran_at), { addSuffix: true })}
        </span>
        {Object.entries(severityCounts).length > 0 && (
          <span className="text-xs text-slate-400">
            {Object.entries(severityCounts)
              .map(([sev, count]) => `${count} ${sev}`)
              .join(', ')}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 pl-11 space-y-1.5">
          {details.length === 0 ? (
            <p className="text-xs text-slate-400">No detail entries recorded for this scan.</p>
          ) : (
            details.map((d, idx) => (
              <div key={`${d.name}-${idx}`} className="flex items-center gap-2 text-sm">
                {d.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                )}
                <span className="text-slate-700">{d.name}</span>
                {d.detail && <span className="text-slate-400">, {d.detail}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6 h-28 animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 h-20 animate-pulse" />
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-64 animate-pulse" />
    </div>
  );
}
