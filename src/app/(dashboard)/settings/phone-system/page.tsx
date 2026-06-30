import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronLeft,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Smartphone,
  Server,
  Radio,
  AlertTriangle,
  Info,
  ArrowRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listElksNumbers } from "@/lib/calls/elks";
import {
  buildNumberRows,
  INBOUND_LABEL,
  type PhoneNumberRow,
  type NumberKind,
} from "@/lib/calls/phone-system";

export const dynamic = "force-dynamic";

interface Agent {
  name: string;
  email: string | null;
  phone: string | null;
  callerId: string | null; // null = uses shared default
  enabled: boolean;
}

const KIND_BADGE: Record<NumberKind, { label: string; cls: string; Icon: typeof Smartphone }> = {
  mobile: { label: "Mobile (customer-facing)", cls: "bg-teal-50 text-teal-700 border-teal-200", Icon: Smartphone },
  sip: { label: "SIP / virtual", cls: "bg-slate-50 text-slate-600 border-slate-200", Icon: Server },
  data: { label: "Data / WebSocket", cls: "bg-violet-50 text-violet-700 border-violet-200", Icon: Radio },
};

function inboundCls(type: string): string {
  switch (type) {
    case "crm":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "forward":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "unconfigured":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "result_insurance":
      return "bg-sky-50 text-sky-700 border-sky-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

async function loadData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const workspaceId = membership?.workspace_id ?? null;

  // Members of this workspace + their per-user call settings.
  const agents: Agent[] = [];
  const callerIdToAgents = new Map<string, string[]>();
  const defaultCallerId = process.env.CRM_CALL_FROM_NUMBER?.trim() || null;

  if (workspaceId) {
    const { data: members } = await admin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId);
    const memberIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];

    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name, call_agent_phone, call_caller_id, call_enabled")
      .in("user_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
    const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const emailById = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? null]));

    for (const id of memberIds) {
      const p = profileById.get(id);
      const email = emailById.get(id) ?? null;
      const name = p?.full_name?.trim() || email || "Unknown user";
      const callerId = p?.call_caller_id?.trim() || null;
      // Only surface members who have actually configured a calling phone, plus
      // anyone with a caller ID set — keeps the table about active callers.
      const phone = p?.call_agent_phone?.trim() || null;
      if (!phone && !callerId) continue;
      agents.push({
        name,
        email,
        phone,
        callerId,
        enabled: p?.call_enabled !== false,
      });
      const key = callerId || defaultCallerId;
      if (key) {
        const arr = callerIdToAgents.get(key) ?? [];
        arr.push(name);
        callerIdToAgents.set(key, arr);
      }
    }
  }

  let numbers: PhoneNumberRow[] = [];
  let numbersError: string | null = null;
  try {
    const raw = await listElksNumbers();
    numbers = buildNumberRows(raw, callerIdToAgents, defaultCallerId);
  } catch (err) {
    numbersError = err instanceof Error ? err.message : "Failed to load numbers";
  }

  return { agents, numbers, numbersError, defaultCallerId };
}

export default async function PhoneSystemPage() {
  const { agents, numbers, numbersError, defaultCallerId } = await loadData();

  const mobileCount = numbers.filter((n) => n.kind === "mobile").length;
  const spareMobiles = numbers.filter(
    (n) => n.kind === "mobile" && n.assignedTo.length === 0 && !n.isDefaultCallerId,
  );

  return (
    <div className="p-6 max-w-4xl mx-auto pb-16">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/settings" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <Phone className="w-5 h-5 text-teal-600" />
        <h1 className="text-2xl font-bold text-slate-900">Phone System</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        How calling works in the CRM — the numbers on the account, who calls from what, and where
        inbound calls go. Telephony runs on 46elks.
      </p>

      {/* How it works */}
      <section className="mb-10">
        <h2 className="text-base font-semibold text-slate-900 mb-3">How a call works</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <PhoneOutgoing className="w-4 h-4 text-teal-600" />
              <p className="text-sm font-medium text-slate-900">Outbound (working today)</p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Click <strong>Call</strong> → 46elks rings <em>your</em> phone first, then bridges you to
              the contact and records it. The customer sees your <strong>caller ID</strong> — which
              must be a 46elks number (your personal number can never be shown). Each agent sets their
              own phone + caller ID in <Link href="/settings/calls" className="text-teal-600 underline">Calling settings</Link>.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <PhoneIncoming className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-medium text-slate-900">Inbound / callbacks</p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Dedicated agent numbers (those routed to <em>This CRM&apos;s inbound handler</em> below)
              now ring the owning agent&apos;s phone on a callback, <strong>record + transcribe</strong>
              the call, and log it to the contact timeline — same pipeline as outbound. Other numbers
              still route elsewhere (see the table). No-answer failover between agents is the next step.
            </p>
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900">
            Numbers on the 46elks account{numbers.length ? ` (${numbers.length})` : ""}
          </h2>
          {!!mobileCount && (
            <span className="text-xs text-slate-400">{mobileCount} customer-facing mobile</span>
          )}
        </div>

        {numbersError ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            Couldn&apos;t load live numbers from 46elks ({numbersError}). Check ELKS_API_USERNAME /
            ELKS_API_PASSWORD.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Inbound (callback) goes to</th>
                  <th className="px-3 py-2 font-medium">Used as caller ID by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {numbers.map((n) => {
                  const badge = KIND_BADGE[n.kind];
                  const inboundText =
                    n.inbound.type === "forward"
                      ? `Forwards to ${n.inbound.to}`
                      : n.inbound.type === "webhook"
                        ? `Webhook (${n.inbound.host})`
                        : INBOUND_LABEL[n.inbound.type];
                  return (
                    <tr key={n.number} className="text-slate-700">
                      <td className="px-3 py-2.5 font-mono text-[13px] whitespace-nowrap">
                        {n.number}
                        {n.isDefaultCallerId && (
                          <span className="ml-2 text-[10px] font-sans font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                            shared default
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-[11px] border rounded px-1.5 py-0.5 ${badge.cls}`}>
                          <badge.Icon className="w-3 h-3" />
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block text-[11px] border rounded px-1.5 py-0.5 ${inboundCls(n.inbound.type)}`}>
                          {inboundText}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">
                        {n.assignedTo.length ? n.assignedTo.join(", ") : <span className="text-slate-300">— spare —</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!numbersError && (
          <p className="text-xs text-slate-400 mt-2">
            Only <strong>Mobile</strong> numbers can be shown to customers as caller ID. SIP / Data
            numbers are 46elks infrastructure.
            {spareMobiles.length > 0 && (
              <>
                {" "}
                Spare mobile numbers available to dedicate to an agent:{" "}
                <span className="font-mono text-slate-500">
                  {spareMobiles.map((n) => n.number).join(", ")}
                </span>
                .
              </>
            )}
          </p>
        )}
      </section>

      {/* Agents */}
      <section className="mb-10">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Agents &amp; their settings</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-slate-400">
            No one has set up calling yet. Each member configures their phone in{" "}
            <Link href="/settings/calls" className="text-teal-600 underline">Calling settings</Link>.
          </p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Rings this phone</th>
                  <th className="px-3 py-2 font-medium">Caller ID shown to customer</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((a) => (
                  <tr key={a.email ?? a.name} className="text-slate-700">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">{a.name}</div>
                      {a.email && <div className="text-xs text-slate-400">{a.email}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[13px]">
                      {a.phone ?? <span className="text-slate-300 font-sans">not set</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[13px]">
                      {a.callerId ?? (
                        <span className="font-sans text-slate-500">
                          shared default{defaultCallerId ? ` (${defaultCallerId})` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[11px] border rounded px-1.5 py-0.5 ${
                          a.enabled
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-500 border-slate-200"
                        }`}
                      >
                        {a.enabled ? "Calling on" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Callback routing plan */}
      <section className="mb-10">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Planned: inbound call routing</h2>
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <p className="text-sm text-slate-600">
            To make callbacks reach the right person (with no-answer failover), each agent number&apos;s
            inbound would point at a new CRM handler that returns a 46elks hunt-group:
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="bg-slate-100 border border-slate-200 rounded px-2 py-1">Customer calls the number</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="bg-teal-50 border border-teal-200 text-teal-700 rounded px-2 py-1">Ring Jacob (25s)</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="bg-teal-50 border border-teal-200 text-teal-700 rounded px-2 py-1">No answer → ring Hans (25s)</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="bg-slate-100 border border-slate-200 rounded px-2 py-1">Still no answer → voicemail + log missed call</span>
          </div>
          <p className="text-xs text-slate-500">
            This uses 46elks <code className="bg-slate-100 px-1 rounded">connect</code> with a{" "}
            <code className="bg-slate-100 px-1 rounded">timeout</code> and a chained next action. The
            handler would also log every inbound call to the contact timeline. Not built yet — design
            only.
          </p>
        </div>
      </section>

      {/* Limitations */}
      <section>
        <h2 className="text-base font-semibold text-slate-900 mb-3">Known limitations</h2>
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex gap-3">
            <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-800">Your personal number is never shown.</strong> 46elks
              only allows a caller ID that is a number on the account. Customers see a Wrenchlane
              number, not your private one.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-800">On a normal phone you can&apos;t see both
              &ldquo;business call&rdquo; and &ldquo;which customer&rdquo;.</strong> A forwarded call
              shows one caller ID. Either present the business number (you know it&apos;s work — save
              it as a contact like &ldquo;Wrenchlane Line&rdquo; so it&apos;s labelled) or present the
              customer&apos;s number (you know who, but it looks like any call). Showing both, with the
              CRM contact name, requires a dedicated calling app (CallKit on iOS / ConnectionService on
              Android) — a larger Phase-2 build that would move calls onto a VoIP/SIP stack.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
