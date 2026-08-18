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
  Bot,
  Wallet,
  CalendarClock,
  Users,
  MessageSquare,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getElksAccount, listElksNumbers, type ElksAccount } from "@/lib/calls/elks";
import {
  buildNumberRows,
  INBOUND_LABEL,
  type PhoneNumberRow,
  type NumberKind,
} from "@/lib/calls/phone-system";
import {
  isWithinOfficeHours,
  SWITCHBOARD_OUTCOME_LABEL,
  type SwitchboardTarget,
} from "@/lib/switchboard/types";
import { loadTargets } from "@/lib/switchboard/settings";
import type { Tables } from "@/lib/database.types";

export const dynamic = "force-dynamic";

interface Agent {
  name: string;
  email: string | null;
  phone: string | null;
  callerId: string | null; // null = uses shared default
  enabled: boolean;
  failoverName: string | null;
  /** Last-resort number rung after the failover (usually the switchboard AI). */
  fallbackNumber: string | null;
  ringSeconds: number;
  voicemail: boolean;
  /** Their own WebRTC number, i.e. they can take calls in the browser. */
  webrtcNumber: string | null;
}

const KIND_BADGE: Record<NumberKind, { label: string; cls: string; Icon: typeof Smartphone }> = {
  mobile: { label: "Mobile (customer-facing)", cls: "bg-teal-50 text-teal-700 border-teal-200", Icon: Smartphone },
  sip: { label: "SIP / virtual", cls: "bg-slate-50 text-slate-600 border-slate-200", Icon: Server },
  data: { label: "Data / WebSocket", cls: "bg-violet-50 text-violet-700 border-violet-200", Icon: Radio },
};

function inboundCls(type: string): string {
  switch (type) {
    case "crm":
    case "forward":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "switchboard":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "unconfigured":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "result_insurance":
      return "bg-sky-50 text-sky-700 border-sky-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

/** 46elks reports money in 1/10000 of the currency unit (300000 = 30 SEK). */
function money(units: number | null | undefined, currency = "SEK"): string {
  if (units === null || units === undefined) return "—";
  return `${(units / 10000).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

const DAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
      .select(
        "user_id, full_name, call_agent_phone, call_caller_id, call_enabled, call_failover_user_id, call_fallback_number, call_ring_seconds, call_voicemail_enabled, call_webrtc_number",
      )
      .in("user_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
    const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const emailById = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? null]));
    const nameFor = (id: string | null | undefined): string | null => {
      if (!id) return null;
      const p = profileById.get(id);
      return p?.full_name?.trim() || emailById.get(id) || null;
    };

    for (const id of memberIds) {
      const p = profileById.get(id);
      const email = emailById.get(id) ?? null;
      const name = p?.full_name?.trim() || email || "Unknown user";
      const callerId = p?.call_caller_id?.trim() || null;
      const phone = p?.call_agent_phone?.trim() || null;
      if (!phone && !callerId) continue;
      agents.push({
        name,
        email,
        phone,
        callerId,
        enabled: p?.call_enabled !== false,
        failoverName: nameFor(p?.call_failover_user_id),
        fallbackNumber: p?.call_fallback_number?.trim() || null,
        ringSeconds: p?.call_ring_seconds ?? 25,
        voicemail: p?.call_voicemail_enabled !== false,
        webrtcNumber: p?.call_webrtc_number?.trim() || null,
      });
      const key = callerId || defaultCallerId;
      if (key) {
        const arr = callerIdToAgents.get(key) ?? [];
        arr.push(name);
        callerIdToAgents.set(key, arr);
      }
    }
  }

  // Switchboard: settings, who it may transfer to, and how recent calls ended.
  let switchboard: Tables<"switchboard_settings"> | null = null;
  let targets: SwitchboardTarget[] = [];
  let recentCalls: Array<Tables<"switchboard_calls">> = [];
  if (workspaceId) {
    const { data } = await admin
      .from("switchboard_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    switchboard = data ?? null;
    targets = await loadTargets(admin, workspaceId);
    const { data: calls } = await admin
      .from("switchboard_calls")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10);
    recentCalls = calls ?? [];
  }

  let numbers: PhoneNumberRow[] = [];
  let rawByNumber = new Map<string, { expires?: string; cost?: number; name?: string }>();
  let numbersError: string | null = null;
  let account: ElksAccount | null = null;
  try {
    const raw = await listElksNumbers();
    numbers = buildNumberRows(raw, callerIdToAgents, defaultCallerId);
    rawByNumber = new Map(
      raw.map((n) => [n.number, { expires: n.expires, cost: n.cost, name: n.name }]),
    );
  } catch (err) {
    numbersError = err instanceof Error ? err.message : "Failed to load numbers";
  }
  try {
    account = await getElksAccount();
  } catch {
    account = null;
  }

  return {
    agents,
    numbers,
    rawByNumber,
    numbersError,
    defaultCallerId,
    switchboard,
    targets,
    recentCalls,
    account,
  };
}

export default async function PhoneSystemPage() {
  const {
    agents,
    numbers,
    rawByNumber,
    numbersError,
    defaultCallerId,
    switchboard,
    targets,
    recentCalls,
    account,
  } = await loadData();

  const mobileCount = numbers.filter((n) => n.kind === "mobile").length;
  const spareMobiles = numbers.filter(
    (n) => n.kind === "mobile" && n.assignedTo.length === 0 && !n.isDefaultCallerId,
  );
  const monthlyNumberCost = numbers.reduce(
    (sum, n) => sum + (rawByNumber.get(n.number)?.cost ?? 0),
    0,
  );
  const balanceUnits = account?.balance ?? null;
  const lowBalance = balanceUnits !== null && balanceUnits < monthlyNumberCost;

  const switchboardOn = Boolean(switchboard?.enabled && switchboard?.number);
  const openNow = switchboard ? isWithinOfficeHours(new Date(), switchboard) : false;
  const reachable = targets.filter((t) => t.enabled && t.phone);

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
        Everything about how phone calls work here: the three ways a call can happen, the numbers on
        the account, and where an incoming call ends up. Telephony runs on <strong>46elks</strong>;
        the two AI voices run on <strong>ElevenLabs</strong> and reach us over a SIP bridge.
      </p>

      {/* Account health */}
      <section className="mb-10">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Account health</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className={`bg-white border rounded-lg p-4 ${lowBalance ? "border-amber-300" : "border-slate-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              <Wallet className={`w-4 h-4 ${lowBalance ? "text-amber-600" : "text-slate-400"}`} />
              <p className="text-xs font-medium text-slate-500">46elks balance</p>
            </div>
            <p className="text-xl font-semibold text-slate-900">
              {money(balanceUnits, account?.currency ?? "SEK")}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Numbers cost {money(monthlyNumberCost, account?.currency ?? "SEK")} a month.
              {lowBalance ? " Not enough to cover the next renewal." : ""}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="w-4 h-4 text-slate-400" />
              <p className="text-xs font-medium text-slate-500">Numbers</p>
            </div>
            <p className="text-xl font-semibold text-slate-900">{numbers.length}</p>
            <p className="text-xs text-slate-500 mt-1">{mobileCount} can be shown to customers.</p>
          </div>
          <div className={`bg-white border rounded-lg p-4 ${switchboardOn ? "border-indigo-200" : "border-slate-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              <Bot className={`w-4 h-4 ${switchboardOn ? "text-indigo-600" : "text-slate-400"}`} />
              <p className="text-xs font-medium text-slate-500">Switchboard</p>
            </div>
            <p className="text-xl font-semibold text-slate-900">{switchboardOn ? "Live" : "Off"}</p>
            <p className="text-xs text-slate-500 mt-1">
              {switchboard?.number ? switchboard.number : "No number set yet."}
            </p>
          </div>
        </div>
        {lowBalance && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Top up 46elks.</strong> When the account runs dry it refuses calls with a
              <code className="mx-1 bg-amber-100 px-1 rounded">creditslow</code> error, and that
              failure is <strong>silent</strong> from the caller&apos;s side. On a published
              switchboard number that means callers hear nothing at all.
            </p>
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="mb-10">
        <h2 className="text-base font-semibold text-slate-900 mb-3">The three kinds of call</h2>
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <PhoneOutgoing className="w-4 h-4 text-teal-600" />
              <p className="text-sm font-medium text-slate-900">1. You call a customer</p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Click <strong>Call</strong> in the CRM. 46elks rings <em>your</em> phone first, then
              bridges you to the customer and records it. The customer sees your{" "}
              <strong>caller ID</strong>, which must be a 46elks number, never your private one. Each
              person sets their own phone and caller ID in{" "}
              <Link href="/settings/calls" className="text-teal-600 underline">Calling settings</Link>.
              Everyone calls independently, so the whole team can be on calls at the same time. The
              only shared piece is <em>&ldquo;talk from the computer&rdquo;</em>, which one person at
              a time can use.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Bot className="w-4 h-4 text-fuchsia-600" />
              <p className="text-sm font-medium text-slate-900">
                2. The AI agent calls a customer (outbound)
              </p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              A queue of approved calls, worked through by an ElevenLabs voice agent that dials the
              contact and talks to them. Configured on the{" "}
              <Link href="/call-agent" className="text-teal-600 underline">Call Agent</Link> page. It
              runs on its own line and one call at a time, so it never competes with a person for a
              phone or a number.
            </p>
          </div>

          <div className="bg-white border border-indigo-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <PhoneIncoming className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-medium text-slate-900">
                3. Someone calls us (the switchboard)
              </p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              Our published number is answered by <strong>{switchboard?.persona_name ?? "the receptionist"}</strong>,
              an AI receptionist. It handles what it can itself, and puts the caller through to a
              person when they ask for one. The caller stays on the <em>same</em> call throughout:
              they are never rung back and never hear a second dial tone.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="bg-slate-100 border border-slate-200 rounded px-2 py-1">Customer dials the växel</span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 rounded px-2 py-1">
                {switchboard?.persona_name ?? "Receptionist"} answers, asks what they need
              </span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 rounded px-2 py-1">
                Can it answer? It just answers
              </span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-2 py-1">
                Asked for a person? Rings them ({switchboard?.ring_seconds ?? 25}s)
              </span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span className="bg-slate-100 border border-slate-200 rounded px-2 py-1">
                No answer → failover → {switchboard?.voicemail_enabled === false ? "message" : "voicemail"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              Under the hood: our handler answers 46elks with a <code className="bg-slate-100 px-1 rounded">connect</code>{" "}
              into the ElevenLabs SIP endpoint plus a chained{" "}
              <code className="bg-slate-100 px-1 rounded">next</code>. When the receptionist ends its
              own leg, 46elks asks us what to do next and we return the ring-and-failover tree. That
              is why the transfer keeps the original call alive.
            </p>
          </div>
        </div>
      </section>

      {/* Switchboard detail */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900">Switchboard</h2>
          <span className={`text-xs ${switchboardOn ? "text-emerald-600" : "text-slate-400"}`}>
            {switchboardOn ? (openNow ? "Live, office open" : "Live, office closed") : "Not answering"}
          </span>
        </div>

        {!switchboard ? (
          <p className="text-sm text-slate-400">
            Not set up yet. It appears here once the switchboard has been configured.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="bg-white border border-slate-200 rounded-lg p-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <Field label="Published number" value={switchboard.number ?? "not set"} mono />
              <Field label="Receptionist" value={switchboard.persona_name} />
              <Field
                label="Speaks"
                value={switchboard.languages_enabled.join(", ").toUpperCase()}
              />
              <Field
                label="Staffed hours"
                value={`${String(switchboard.open_hour).padStart(2, "0")}:00 to ${String(switchboard.close_hour).padStart(2, "0")}:00, ${switchboard.open_days.map((d) => DAY_LABEL[d]).join(" ")}`}
              />
              <Field label="Rings each person for" value={`${switchboard.ring_seconds} seconds`} />
              <Field
                label="Longest call allowed"
                value={`${Math.round(switchboard.max_call_seconds / 60)} minutes`}
              />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs font-medium text-slate-700 mb-2">
                What {switchboard.persona_name} is allowed to do alone
              </p>
              <div className="flex flex-wrap gap-2">
                <Capability on={switchboard.answer_questions} label="Answer product questions from the knowledge base" />
                <Capability on={switchboard.take_messages} label="Take a message" />
                <Capability on={switchboard.book_callbacks} label="Agree a callback time" />
              </div>
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                It may quote prices that are written in the{" "}
                <Link href="/settings/ai-knowledge" className="text-teal-600 underline">knowledge base</Link>{" "}
                word for word, but it may never negotiate, discount, or promise a date or a feature.
                Those always go to a person.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <p className="text-xs font-medium text-slate-700">
                  Who it can put callers through to
                </p>
              </div>
              {targets.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Nobody yet, so every call will be handled by the receptionist or end in a message.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="pb-1.5 font-medium">Ask for</th>
                        <th className="pb-1.5 font-medium">Also recognised as</th>
                        <th className="pb-1.5 font-medium">Rings</th>
                        <th className="pb-1.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {targets.map((t) => (
                        <tr key={t.id} className="text-slate-700">
                          <td className="py-1.5 font-medium">{t.label}</td>
                          <td className="py-1.5 text-slate-500">
                            {t.aliases.length ? t.aliases.join(", ") : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-1.5 font-mono">
                            {t.phone ?? <span className="font-sans text-amber-600">no phone set</span>}
                            {t.phone_from_profile && (
                              <span className="ml-1.5 font-sans text-[10px] text-slate-400">
                                from their profile
                              </span>
                            )}
                          </td>
                          <td className="py-1.5">
                            {!t.enabled ? (
                              <span className="text-slate-400">off</span>
                            ) : t.phone ? (
                              <span className="text-emerald-600">reachable</span>
                            ) : (
                              <span className="text-amber-600">cannot be rung</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-2">
                A person&apos;s number comes from their own{" "}
                <Link href="/settings/calls" className="text-teal-600 underline">Calling settings</Link>,
                so it only has to be set in one place. {reachable.length} of {targets.length} can be
                rung right now.
              </p>
            </div>

            {recentCalls.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-xs font-medium text-slate-700">Recent calls to the switchboard</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="pb-1.5 font-medium">When</th>
                        <th className="pb-1.5 font-medium">Caller</th>
                        <th className="pb-1.5 font-medium">Asked for</th>
                        <th className="pb-1.5 font-medium">How it ended</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentCalls.map((c) => (
                        <tr key={c.id} className="text-slate-700">
                          <td className="py-1.5 whitespace-nowrap text-slate-500">
                            {new Date(c.created_at).toLocaleString("sv-SE", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-1.5">
                            {c.caller_name ?? <span className="font-mono">{c.caller_number ?? "unknown"}</span>}
                          </td>
                          <td className="py-1.5 text-slate-500">
                            {c.requested_label ?? <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-1.5">
                            {c.outcome
                              ? (SWITCHBOARD_OUTCOME_LABEL[c.outcome] ?? c.outcome)
                              : <span className="text-slate-400">{c.status}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Numbers */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900">
            Numbers on the 46elks account{numbers.length ? ` (${numbers.length})` : ""}
          </h2>
          {!!monthlyNumberCost && (
            <span className="text-xs text-slate-400">
              {money(monthlyNumberCost, account?.currency ?? "SEK")} / month
            </span>
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
                  <th className="px-3 py-2 font-medium">An incoming call goes to</th>
                  <th className="px-3 py-2 font-medium">Used as caller ID by</th>
                  <th className="px-3 py-2 font-medium">Renews</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {numbers.map((n) => {
                  const badge = KIND_BADGE[n.kind];
                  const raw = rawByNumber.get(n.number);
                  const days = daysUntil(raw?.expires);
                  const inboundText =
                    n.inbound.type === "forward"
                      ? `Forwards to ${n.inbound.to}`
                      : n.inbound.type === "webhook"
                        ? `Webhook (${n.inbound.host})`
                        : INBOUND_LABEL[n.inbound.type];
                  const isSwitchboard = n.number === switchboard?.number;
                  return (
                    <tr key={n.number} className="text-slate-700">
                      <td className="px-3 py-2.5 font-mono text-[13px] whitespace-nowrap">
                        {n.number}
                        {isSwitchboard && (
                          <span className="ml-2 text-[10px] font-sans font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                            växel
                          </span>
                        )}
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
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                        {days === null ? (
                          <span className="text-slate-300">—</span>
                        ) : days < 0 ? (
                          <span className="text-amber-600">overdue by {Math.abs(days)}d</span>
                        ) : (
                          <span className="text-slate-500">in {days}d</span>
                        )}
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
            Only <strong>Mobile</strong> numbers can be dialled by a customer or shown as a caller ID.
            The <strong>+4600…</strong> numbers are 46elks infrastructure (SIP and WebSocket
            endpoints); a customer dialling one hears a wrong-number tone, so they can never be the
            växel or a caller ID.
            {spareMobiles.length > 0 && (
              <>
                {" "}
                Spare mobile numbers:{" "}
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
        <h2 className="text-base font-semibold text-slate-900 mb-3">People &amp; their call settings</h2>
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
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Rings this phone</th>
                  <th className="px-3 py-2 font-medium">Caller ID shown to customer</th>
                  <th className="px-3 py-2 font-medium">If no answer</th>
                  <th className="px-3 py-2 font-medium">On this computer</th>
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
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      ring {a.ringSeconds}s
                      {a.failoverName ? ` → ${a.failoverName}` : ""}
                      {a.fallbackNumber ? ` → ${a.fallbackNumber}` : ""}
                      {a.voicemail ? " → voicemail" : ""}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {a.webrtcNumber ? (
                        <span className="font-mono text-slate-600">{a.webrtcNumber}</span>
                      ) : (
                        <span className="text-slate-400">not set up</span>
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
        <p className="text-xs text-slate-400 mt-2">
          Everyone should have their <strong>own</strong> caller ID. Two people sharing one number
          cannot both be reached on it, because an incoming call has only that number to work out who
          to ring.
        </p>
      </section>

      {/* Limitations */}
      <section>
        <h2 className="text-base font-semibold text-slate-900 mb-3">Known limits</h2>
        <div className="space-y-3">
          <Limit icon="info">
            <strong className="text-slate-800">Your personal number is never shown.</strong> 46elks
            only allows a caller ID that is a number on the account, so customers always see a
            Wrenchlane number rather than your private one.
          </Limit>
          <Limit icon="warn">
            <strong className="text-slate-800">
              A transfer cannot be announced out loud on the phone.
            </strong>{" "}
            Spoken warm-transfer (&ldquo;I have Erik calling about a Volvo&rdquo;) only works on
            ElevenLabs&apos; native Twilio integration, not over a SIP trunk like ours. Instead, the
            moment the receptionist decides to transfer we post the caller&apos;s CRM details to
            Slack, which arrives before the phone stops ringing and carries more than a whisper
            could. It needs <code className="bg-slate-100 px-1 rounded">SLACK_SWITCHBOARD_WEBHOOK_URL</code>{" "}
            set; without it the transfer still works, just with no heads-up.
          </Limit>
          <Limit icon="warn">
            <strong className="text-slate-800">
              Two people talking to the receptionist at the same instant.
            </strong>{" "}
            The provider does not tell us which phone call a given conversation belongs to, so we
            match on the call that is currently live. If two callers are mid-conversation with the
            receptionist in the same moment, the newer one wins. Fine for an internal line; if call
            volume ever makes this real, the fix is a per-call SIP identifier.
          </Limit>
          <Limit icon="info">
            <strong className="text-slate-800">
              Talking from the computer needs one WebRTC number per person.
            </strong>{" "}
            On 46elks a WebRTC number <em>is</em> its SIP account, and an account holds a single
            registration, so two people cannot share one: their browsers would race for the incoming
            leg. Each person therefore gets their own number, shown in the table above. 46elks
            support has to create these, they cannot be bought through the API. Anyone without one
            simply uses the phone bridge, which has no such limit.
          </Limit>
          <Limit icon="info">
            <strong className="text-slate-800">
              A forwarded call cannot show both &ldquo;business call&rdquo; and &ldquo;which
              customer&rdquo;.
            </strong>{" "}
            One call carries one caller ID. Either you see the business number (so you know it is
            work, and can save it as a contact to label it) or the customer&apos;s number (so you know
            who, but not that it is work). Showing both with the CRM name needs a dedicated calling
            app using CallKit on iOS or ConnectionService on Android, which is a much larger build.
          </Limit>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className={`text-slate-900 font-medium ${mono ? "font-mono text-[13px]" : ""}`}>{value}</p>
    </div>
  );
}

function Capability({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`text-[11px] border rounded px-2 py-1 ${
        on
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-slate-50 text-slate-400 border-slate-200 line-through"
      }`}
    >
      {label}
    </span>
  );
}

function Limit({ icon, children }: { icon: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex gap-3">
      {icon === "warn" ? (
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
      ) : (
        <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
      )}
      <p className="text-xs text-slate-600 leading-relaxed">{children}</p>
    </div>
  );
}
