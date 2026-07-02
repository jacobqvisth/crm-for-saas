"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X, Phone, Mail, Building2, MapPin, Wrench, Clock, CreditCard, BadgeCheck,
  ExternalLink, Tag, FileText, Loader2, Copy, Check,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";
import { CallNowButton } from "@/components/calls/call-now";
import { countryNameFromIso } from "@/lib/geo/country";
import type { QueueRow } from "@/app/(dashboard)/calls/lists/[id]/page";

type RecentActivity = {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  created_at: string | null;
};

function fmtRel(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return null;
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          toast.success("Copied");
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 px-5 py-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

export function ContactCallPanel({
  row,
  listId,
  onClose,
  onLog,
  onCallLogged,
}: {
  row: QueueRow;
  listId: string;
  onClose: () => void;
  onLog: () => void;
  onCallLogged: () => void;
}) {
  const supabase = createClient();
  const [recent, setRecent] = useState<RecentActivity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecent(null);
    (async () => {
      const { data } = await supabase
        .from("activities")
        .select("id, type, subject, body, outcome, created_at")
        .eq("contact_id", row.contactId)
        .in("type", ["call", "note", "meeting"])
        .order("created_at", { ascending: false })
        .limit(6);
      if (!cancelled) setRecent((data ?? []) as RecentActivity[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.contactId, supabase]);

  // Dedupe phones: primary first, then any extras not equal to it.
  const phones = [
    ...(row.phone ? [row.phone] : []),
    ...row.allPhones.filter((p) => p !== row.phone),
  ];
  const emails = [
    ...(row.email ? [row.email] : []),
    ...row.allEmails.filter((e) => e !== row.email),
  ];
  const location = [row.city, row.country ? countryNameFromIso(row.countryCode) ?? row.country : null]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-slate-900">{row.name}</h2>
              {row.isCustomer ? (
                <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                  Customer
                </span>
              ) : row.leadStatus ? (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {row.leadStatus}
                </span>
              ) : null}
            </div>
            {(row.title || row.companyName) && (
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {[row.title, row.companyName].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <CallNowButton
            target={{
              contactId: row.contactId,
              contactName: row.name,
              phone: row.phone ?? phones[0] ?? null,
              companyId: row.companyId,
              companyName: row.companyName,
              listId,
            }}
            onLogged={onCallLogged}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          />
          <button
            onClick={onLog}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Phone className="h-4 w-4" /> Log
          </button>
          <Link
            href={`/contacts/${row.contactId}`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Open full profile"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Phones */}
          <Section title="Phone numbers">
            {phones.length === 0 ? (
              <p className="text-sm text-slate-400">No phone number on file.</p>
            ) : (
              <ul className="space-y-1.5">
                {phones.map((p, i) => (
                  <li key={`${p}-${i}`} className="flex items-center gap-2">
                    <Phone className="h-4 w-4 shrink-0 text-teal-600" />
                    <a href={`tel:${p}`} className="text-sm font-medium text-slate-800 hover:text-teal-700">
                      {p}
                    </a>
                    {i === 0 && row.phone && (
                      <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">
                        Primary
                      </span>
                    )}
                    <CopyButton value={p} />
                  </li>
                ))}
              </ul>
            )}
            {row.companyPhone && !phones.includes(row.companyPhone) && (
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                <a href={`tel:${row.companyPhone}`} className="hover:text-teal-700">
                  {row.companyPhone}
                </a>
                <span className="text-xs text-slate-400">(company)</span>
              </div>
            )}
          </Section>

          {/* Emails */}
          <Section title="Email">
            {emails.length === 0 ? (
              <p className="text-sm text-slate-400">No email on file.</p>
            ) : (
              <ul className="space-y-1.5">
                {emails.map((e, i) => (
                  <li key={`${e}-${i}`} className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                    <a href={`mailto:${e}`} className="truncate text-sm text-slate-700 hover:text-teal-700">
                      {e}
                    </a>
                    <CopyButton value={e} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Company & location */}
          {(row.companyName || location) && (
            <Section title="Company & location">
              {row.companyName && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                  {row.companyId ? (
                    <Link href={`/companies/${row.companyId}`} className="text-slate-800 hover:text-teal-700">
                      {row.companyName}
                    </Link>
                  ) : (
                    <span className="text-slate-800">{row.companyName}</span>
                  )}
                </div>
              )}
              {location && (
                <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-600">
                  <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                  {location}
                </div>
              )}
            </Section>
          )}

          {/* App usage (customers only) */}
          {row.isCustomer && (
            <Section title="App usage">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                {row.planType && (
                  <div className="flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="text-slate-700">{row.planType}</span>
                  </div>
                )}
                {row.subscriptionStatus && (
                  <div className="flex items-center gap-1.5">
                    <BadgeCheck className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="text-slate-700">{row.subscriptionStatus}</span>
                  </div>
                )}
                {row.diagnosticsTotal != null && (
                  <div className="flex items-center gap-1.5">
                    <Wrench className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="text-slate-700">
                      {row.diagnosticsTotal} diag
                      {row.diagnosticsLast30d != null && (
                        <span className="text-slate-400"> ({row.diagnosticsLast30d}/30d)</span>
                      )}
                    </span>
                  </div>
                )}
                {row.lastActiveAt && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="text-slate-700">Active {fmtRel(row.lastActiveAt)}</span>
                  </div>
                )}
              </dl>
              {row.appRole && (
                <p className="mt-2 text-xs text-slate-400">Role: {row.appRole}</p>
              )}
            </Section>
          )}

          {/* Tags */}
          {row.tags.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {row.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                  >
                    <Tag className="h-3 w-3" /> {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Touch history */}
          <Section title="History">
            <div className="space-y-1 text-sm text-slate-600">
              {row.lastContactedAt && (
                <p>
                  Last contacted{" "}
                  <span className="font-medium text-slate-800">{fmtRel(row.lastContactedAt)}</span>
                </p>
              )}
              {row.lastCall?.outcome && (
                <p>
                  Last call:{" "}
                  <span className="font-medium text-slate-800">
                    {CALL_OUTCOME_LABEL[row.lastCall.outcome as CallOutcome] ?? row.lastCall.outcome}
                  </span>
                  {row.lastCall.created_at && <span className="text-slate-400"> · {fmtRel(row.lastCall.created_at)}</span>}
                  {row.lastCall.agentName && <span className="text-slate-400"> · by {row.lastCall.agentName}</span>}
                </p>
              )}
              {!row.lastContactedAt && !row.lastCall && (
                <p className="text-slate-400">Never contacted.</p>
              )}
            </div>

            {recent === null ? (
              <div className="mt-3 flex justify-center text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : recent.length > 0 ? (
              <ul className="mt-3 space-y-2 border-l border-slate-100 pl-3">
                {recent.map((a) => (
                  <li key={a.id} className="text-xs">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      {a.type === "call" ? (
                        <Phone className="h-3 w-3 text-teal-500" />
                      ) : a.type === "meeting" ? (
                        <Clock className="h-3 w-3 text-indigo-500" />
                      ) : (
                        <FileText className="h-3 w-3 text-slate-400" />
                      )}
                      <span className="font-medium capitalize text-slate-700">{a.type}</span>
                      {a.outcome && (
                        <span className="text-slate-500">
                          · {CALL_OUTCOME_LABEL[a.outcome as CallOutcome] ?? a.outcome}
                        </span>
                      )}
                      {a.created_at && (
                        <span className="ml-auto text-slate-400">
                          {format(new Date(a.created_at), "MMM d")}
                        </span>
                      )}
                    </div>
                    {(a.body || a.subject) && (
                      <p className="mt-0.5 line-clamp-2 text-slate-500">{a.body || a.subject}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          {/* Notes */}
          {row.notes && (
            <Section title="Notes">
              <p className="whitespace-pre-wrap text-sm text-slate-600">{row.notes}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
