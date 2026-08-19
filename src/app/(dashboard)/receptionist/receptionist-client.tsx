"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  Headphones,
  Phone,
  PhoneIncoming,
  ArrowRight,
  Users,
  MessageSquare,
  HelpCircle,
  Settings2,
  BookOpen,
  Activity,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wrench,
} from "lucide-react";
import { formatDuration, formatPercent } from "@/lib/switchboard/stats";
import { SWITCHBOARD_OUTCOME_LABEL } from "@/lib/switchboard/types";
import type { ReceptionistData } from "./page";

type Tab = "overview" | "calls" | "knowledge" | "settings" | "how";

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "how", label: "How it works", icon: Wrench },
];

const DAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ReceptionistClient({ data }: { data: ReceptionistData }) {
  const [tab, setTab] = useState<Tab>("overview");
  const { settings, agent } = data;

  const live = Boolean(settings?.enabled && settings?.number);
  const persona = settings?.persona_name ?? "The receptionist";

  return (
    <div className="p-6 max-w-5xl mx-auto pb-16">
      <div className="flex items-center gap-2 mb-1">
        <Headphones className="w-5 h-5 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">Receptionist</h1>
        <span
          className={`ml-2 text-[11px] border rounded px-2 py-0.5 ${
            live
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-slate-100 text-slate-500 border-slate-200"
          }`}
        >
          {live ? (data.openNow ? "Live, office open" : "Live, office closed") : "Not answering"}
        </span>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        {persona} answers the published company number, handles what {persona} can, and puts callers
        through to a person when they ask for one. Everything on this page is read from the live
        systems rather than from our own notes.
      </p>

      {data.error && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">{data.error}</p>
        </div>
      )}

      {data.balanceLow && (
        <div className="mb-4 bg-rose-50 border border-rose-200 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-800 leading-relaxed">
            <strong>The telephony account is low on credit.</strong> When it runs out, 46elks stops
            creating call legs and the switchboard goes silent with no error anywhere. The caller
            simply hears nothing.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700 font-medium"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview data={data} />}
      {tab === "calls" && <Calls data={data} />}
      {tab === "knowledge" && <Knowledge data={data} />}
      {tab === "settings" && <SettingsTab data={data} />}
      {tab === "how" && <HowItWorks data={data} />}

      {!settings && tab !== "how" && (
        <p className="mt-6 text-sm text-slate-400">
          The switchboard has not been set up in this workspace yet.
        </p>
      )}

      {agent === null && settings?.provider_agent_id && tab === "settings" && (
        <p className="mt-4 text-xs text-amber-700">
          Could not read the live agent configuration, so the values below come from our settings
          table and may not match what is actually answering.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Overview */

function Tile({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "good" | "warn";
}) {
  const ring =
    tone === "good" ? "border-emerald-200" : tone === "warn" ? "border-amber-200" : "border-slate-200";
  return (
    <div className={`bg-white border ${ring} rounded-lg p-4`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-slate-900 mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{hint}</p>}
    </div>
  );
}

function Overview({ data }: { data: ReceptionistData }) {
  const { stats, settings, targets } = data;
  const reachable = targets.filter((t) => t.enabled && t.phone);
  const max = Math.max(1, ...stats.daily.map((d) => d.count));

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-4 gap-3">
        <Tile
          label="Calls answered"
          value={String(stats.total)}
          hint={`${stats.today} today, ${stats.last7} in the last 7 days`}
        />
        <Tile
          label="Handled without a human"
          value={formatPercent(stats.selfServeRate)}
          hint={`${stats.handledAlone} of the calls that reached a conclusion`}
          tone={stats.selfServeRate !== null && stats.selfServeRate > 0.5 ? "good" : "plain"}
        />
        <Tile
          label="Put through to a person"
          value={String(stats.transferred)}
          hint={
            stats.missed > 0
              ? `${stats.missed} more asked for someone who did not answer`
              : "Everyone who was asked for picked up"
          }
          tone={stats.missed > 0 ? "warn" : "plain"}
        />
        <Tile
          label="Typical call"
          value={formatDuration(stats.avgDurationSeconds)}
          hint={
            stats.longestSeconds
              ? `longest so far ${formatDuration(stats.longestSeconds)}`
              : undefined
          }
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-700 mb-2">Calls over the last 14 days</p>
          <div className="flex items-end gap-1 h-20">
            {stats.daily.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className={`w-full rounded-t ${d.count ? "bg-indigo-400" : "bg-slate-100"}`}
                  style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }}
                  title={`${d.day}: ${d.count}`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{stats.daily[0]?.day.slice(5)}</span>
            <span>{stats.daily[stats.daily.length - 1]?.day.slice(5)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-700 mb-2">How calls ended</p>
          {Object.keys(stats.byOutcome).length === 0 ? (
            <p className="text-xs text-slate-400">No calls yet.</p>
          ) : (
            <ul className="space-y-1">
              {Object.entries(stats.byOutcome)
                .sort((a, b) => b[1] - a[1])
                .map(([outcome, count]) => (
                  <li key={outcome} className="flex justify-between text-xs">
                    <span className="text-slate-600">
                      {SWITCHBOARD_OUTCOME_LABEL[outcome] ?? outcome}
                    </span>
                    <span className="text-slate-900 font-medium">{count}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <p className="text-xs font-medium text-slate-700">Who callers ask for</p>
          </div>
          {stats.topRequested.length === 0 ? (
            <p className="text-xs text-slate-400">Nobody has been asked for by name yet.</p>
          ) : (
            <ul className="space-y-1">
              {stats.topRequested.map((r) => (
                <li key={r.label} className="flex justify-between text-xs">
                  <span className="text-slate-600">{r.label}</span>
                  <span className="text-slate-900 font-medium">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <p className="text-xs font-medium text-slate-700">Busiest hours</p>
          </div>
          {stats.busiestHours.length === 0 ? (
            <p className="text-xs text-slate-400">Not enough calls to tell.</p>
          ) : (
            <ul className="space-y-1">
              {stats.busiestHours.map((h) => (
                <li key={h.hour} className="flex justify-between text-xs">
                  <span className="text-slate-600">
                    {String(h.hour).padStart(2, "0")}:00 to {String(h.hour + 1).padStart(2, "0")}:00
                  </span>
                  <span className="text-slate-900 font-medium">{h.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-slate-400 mt-1.5">Stockholm time.</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <PhoneIncoming className="w-3.5 h-3.5 text-slate-400" />
            <p className="text-xs font-medium text-slate-700">Callers</p>
          </div>
          <ul className="space-y-1 text-xs">
            <li className="flex justify-between">
              <span className="text-slate-600">Distinct numbers</span>
              <span className="text-slate-900 font-medium">{stats.uniqueCallers}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-600">Recognised from the CRM</span>
              <span className="text-slate-900 font-medium">{stats.knownCallers}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-600">Messages taken</span>
              <span className="text-slate-900 font-medium">{stats.messagesTaken}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="bg-white border border-indigo-200 rounded-lg p-4">
        <p className="text-xs font-medium text-slate-700 mb-2">What happens on a call</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="bg-slate-100 border border-slate-200 rounded px-2 py-1">
            Customer dials {settings?.number ?? "the växel"}
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 rounded px-2 py-1">
            {settings?.persona_name ?? "The receptionist"} answers and asks what they need
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 rounded px-2 py-1">
            Answers it directly if the knowledge covers it
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-2 py-1">
            Asked for a person? Rings them for {settings?.ring_seconds ?? 25}s
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className="bg-slate-100 border border-slate-200 rounded px-2 py-1">
            No answer? Failover, then {settings?.voicemail_enabled === false ? "a message" : "voicemail"}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          {reachable.length} of {targets.length} people can be reached right now. Outside{" "}
          {String(settings?.open_hour ?? 9).padStart(2, "0")}:00 to{" "}
          {String(settings?.close_hour ?? 17).padStart(2, "0")}:00 nobody is rung and a message is
          taken instead.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Calls */

function Calls({ data }: { data: ReceptionistData }) {
  const [open, setOpen] = useState<string | null>(null);
  const { calls } = data;

  if (!calls.length) {
    return <p className="text-sm text-slate-400">No calls to the switchboard yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Every call, newest first. Click a row for the summary, the message taken, and what the
        receptionist could not answer. Transcripts are collected a minute or two after the call ends.
      </p>
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-500">
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Caller</th>
              <th className="px-3 py-2 font-medium">Asked for</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 font-medium">Length</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {calls.map((c) => {
              const isOpen = open === c.id;
              const hasDetail =
                c.summary || c.message_body || (c.unanswered && c.unanswered.length > 0);
              return (
                <Fragment key={c.id}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : c.id)}
                    className={`text-slate-700 ${hasDetail ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {new Date(c.created_at).toLocaleString("sv-SE", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      {c.caller_name ?? (
                        <span className="font-mono">{c.caller_number ?? "unknown"}</span>
                      )}
                      {c.contact_id && (
                        <Link
                          href={`/contacts/${c.contact_id}`}
                          className="ml-1.5 text-teal-600 underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          in CRM
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {c.requested_label ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {c.outcome ? (
                        SWITCHBOARD_OUTCOME_LABEL[c.outcome] ?? c.outcome
                      ) : (
                        <span className="text-slate-400">{c.status}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {formatDuration(c.duration_seconds)}
                    </td>
                  </tr>
                  {isOpen && hasDetail && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-3 py-3 space-y-2">
                        {c.summary && (
                          <div>
                            <p className="text-[11px] font-medium text-slate-500">Summary</p>
                            <p className="text-xs text-slate-700">{c.summary}</p>
                          </div>
                        )}
                        {c.message_body && (
                          <div>
                            <p className="text-[11px] font-medium text-slate-500">Message taken</p>
                            <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans">
                              {c.message_body}
                            </pre>
                          </div>
                        )}
                        {c.unanswered && c.unanswered.length > 0 && (
                          <div>
                            <p className="text-[11px] font-medium text-amber-700">
                              Could not answer
                            </p>
                            <ul className="list-disc list-inside text-xs text-slate-700">
                              {c.unanswered.map((q, i) => (
                                <li key={i}>{q}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Knowledge */

function Knowledge({ data }: { data: ReceptionistData }) {
  const { knowledgeMd, knowledgeSource, gaps, agent } = data;
  const chars = knowledgeMd.length;

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <Tile label="Knowledge size" value={`${(chars / 1000).toFixed(1)} k chars`} hint={knowledgeSource} />
        <Tile
          label="Open questions"
          value={String(gaps.length)}
          hint="Things callers asked that it could not answer"
          tone={gaps.length > 0 ? "warn" : "good"}
        />
        <Tile
          label="How it is loaded"
          value={agent?.knowledgeDocs[0]?.usageMode === "prompt" ? "Whole document" : "Retrieved"}
          hint={
            agent?.knowledgeDocs[0]?.usageMode === "prompt"
              ? "Injected in full on every turn, so nothing can be missed"
              : "Looked up per question"
          }
        />
      </div>

      {gaps.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
            <p className="text-xs font-medium text-slate-700">
              What callers asked that it could not answer
            </p>
          </div>
          <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
            Taken from real calls. Answering one of these in the knowledge below means the
            receptionist handles it itself next time instead of passing the call on.
          </p>
          <ul className="space-y-1.5">
            {gaps.map((g, i) => (
              <li key={i} className="text-xs text-slate-700 flex gap-2">
                <span className="text-amber-500 shrink-0">•</span>
                <span>
                  {g.question}
                  {g.count > 1 && (
                    <span className="ml-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1">
                      asked {g.count}×
                    </span>
                  )}
                  <span className="ml-1.5 text-[10px] text-slate-400">
                    last {new Date(g.lastSeen).toLocaleDateString("sv-SE")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <p className="text-xs font-medium text-slate-700 mb-1">Everything it knows</p>
        <p className="text-[11px] text-slate-500 mb-3">
          This exact text is given to the receptionist on every call. It is the only product
          knowledge it has, so anything missing here is something it will decline to answer, which is
          deliberate: declining is safer than improvising at a paying workshop.
        </p>
        <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 border border-slate-100 rounded p-3 max-h-[32rem] overflow-y-auto">
          {knowledgeMd}
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Settings */

function SettingsTab({ data }: { data: ReceptionistData }) {
  const { settings, agent, targets, members } = data;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    enabled: settings?.enabled ?? false,
    persona_name: settings?.persona_name ?? "Mark",
    open_hour: settings?.open_hour ?? 9,
    close_hour: settings?.close_hour ?? 17,
    ring_seconds: settings?.ring_seconds ?? 25,
    voicemail_enabled: settings?.voicemail_enabled ?? true,
    answer_questions: settings?.answer_questions ?? true,
    take_messages: settings?.take_messages ?? true,
    book_callbacks: settings?.book_callbacks ?? true,
    max_call_seconds: settings?.max_call_seconds ?? 600,
    greeting_note: settings?.greeting_note ?? "",
  });

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/switchboard/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      setMessage(res.ok ? "Saved. Re-provision to push wording changes to the agent." : body.error);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const provision = async () => {
    setSaving(true);
    setMessage("Provisioning...");
    try {
      const res = await fetch("/api/switchboard/provision", { method: "POST" });
      const body = await res.json();
      setMessage(
        res.ok
          ? "Pushed to the provider."
          : `Some steps failed: ${(body.steps ?? [])
              .filter((s: { ok: boolean }) => !s.ok)
              .map((s: { step: string }) => s.step)
              .join(", ")}`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Provisioning failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* What the provider is actually running */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <p className="text-xs font-medium text-slate-700">Models and voice, read from the provider</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
          <Field label="Reasoning model" value={agent?.llm ?? "unknown"} />
          <Field label="Speech model" value={agent?.ttsModel ?? "unknown"} />
          <Field
            label="Temperature"
            value={agent?.temperature != null ? String(agent.temperature) : "unknown"}
            hint="Low on purpose: it restates known facts rather than inventing"
          />
          <Field label="Voice id" value={agent?.voiceId ?? "unknown"} mono />
          <Field
            label="Speech rate"
            value={agent?.speed != null ? `${agent.speed}×` : "unknown"}
          />
          <Field
            label="Waits before replying"
            value={agent?.turnTimeout != null ? `${agent.turnTimeout} s` : "unknown"}
            hint="Silence before it decides the caller has finished"
          />
          <Field
            label="Longest call"
            value={
              agent?.maxDurationSeconds ? `${Math.round(agent.maxDurationSeconds / 60)} min` : "unknown"
            }
          />
          <Field
            label="Languages"
            value={agent?.languagePresets.length ? agent.languagePresets.join(", ").toUpperCase() : "unknown"}
            hint="Swedish for +46 callers, English for everyone else"
          />
          <Field
            label="Built-in abilities"
            value={agent?.builtInTools.length ? agent.builtInTools.join(", ") : "none"}
            hint="end_call lets it hang up so a transfer can happen; language_detection switches mid-call"
          />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          These come from the provider, not from our settings table, so any drift between what we
          intended and what answers the phone shows up here.
        </p>
      </div>

      {/* Editable behaviour */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-slate-700">Behaviour</p>

        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Answer incoming calls. Turning this off makes the number reject calls rather than ring
          silently.
        </label>

        <div className="grid sm:grid-cols-3 gap-3">
          <TextInput
            label="Name callers hear"
            value={form.persona_name}
            onChange={(v) => setForm({ ...form, persona_name: v })}
          />
          <NumberInput
            label="Opens at"
            value={form.open_hour}
            min={0}
            max={23}
            onChange={(v) => setForm({ ...form, open_hour: v })}
          />
          <NumberInput
            label="Closes at"
            value={form.close_hour}
            min={1}
            max={24}
            onChange={(v) => setForm({ ...form, close_hour: v })}
          />
          <NumberInput
            label="Rings each person for (s)"
            value={form.ring_seconds}
            min={5}
            max={120}
            onChange={(v) => setForm({ ...form, ring_seconds: v })}
          />
          <NumberInput
            label="Longest call (s)"
            value={form.max_call_seconds}
            min={60}
            max={1800}
            onChange={(v) => setForm({ ...form, max_call_seconds: v })}
          />
        </div>

        <div className="space-y-1.5 pt-1">
          <Toggle
            label="May answer product questions from the knowledge"
            checked={form.answer_questions}
            onChange={(v) => setForm({ ...form, answer_questions: v })}
          />
          <Toggle
            label="May take a message"
            checked={form.take_messages}
            onChange={(v) => setForm({ ...form, take_messages: v })}
          />
          <Toggle
            label="May agree a callback time"
            checked={form.book_callbacks}
            onChange={(v) => setForm({ ...form, book_callbacks: v })}
          />
          <Toggle
            label="Take voicemail when nobody answers"
            checked={form.voicemail_enabled}
            onChange={(v) => setForm({ ...form, voicemail_enabled: v })}
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Extra instruction added to its prompt</label>
          <textarea
            value={form.greeting_note ?? ""}
            onChange={(e) => setForm({ ...form, greeting_note: e.target.value })}
            rows={3}
            placeholder="For example: mention that the workshop is closed for holidays until 12 August."
            className="mt-1 w-full text-xs border border-slate-200 rounded p-2"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="text-xs bg-slate-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={provision}
            disabled={saving}
            className="text-xs border border-slate-300 rounded px-3 py-1.5 disabled:opacity-50"
          >
            Push to the provider
          </button>
          {message && <span className="text-xs text-slate-600">{message}</span>}
        </div>
        <p className="text-[11px] text-slate-400">
          Hours, ring time and the toggles take effect on the next call. Anything that changes what it
          says, the name, the extra instruction, the knowledge, needs pushing to the provider.
        </p>
      </div>

      {/* Transfer targets */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <p className="text-xs font-medium text-slate-700">Who it can put callers through to</p>
        </div>
        {targets.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nobody yet, so every call ends with the receptionist or a message.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1.5 font-medium">Ask for</th>
                <th className="pb-1.5 font-medium">Also recognised as</th>
                <th className="pb-1.5 font-medium">Rings</th>
                <th className="pb-1.5 font-medium">State</th>
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
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          A person&apos;s number comes from their own{" "}
          <Link href="/settings/calls" className="text-teal-600 underline">
            calling settings
          </Link>
          , so it only has to be set in one place. Workspace members who could be added:{" "}
          {members.map((m) => m.name).join(", ") || "none"}.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className={`text-slate-900 font-medium ${mono ? "font-mono text-[11px]" : ""}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{hint}</p>}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-xs border border-slate-200 rounded px-2 py-1.5"
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-xs text-slate-500">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full text-xs border border-slate-200 rounded px-2 py-1.5"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* --------------------------------------------------------------- How it works */

function HowItWorks({ data }: { data: ReceptionistData }) {
  const { settings, vaxelRouting, bridgeRouting } = data;
  const persona = settings?.persona_name ?? "The receptionist";

  return (
    <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
      <Section title="The path a call takes">
        <p>
          A customer dials <Mono>{settings?.number ?? "the växel number"}</Mono>. Our carrier, 46elks,
          asks the CRM what to do, and the CRM answers with two instructions at once: connect this
          call to the receptionist, and when that leg ends, come back and ask again. That second
          instruction is what makes transfers work.
        </p>
        <p>
          {persona} then talks to the caller. If they ask for a person, {persona} records who, says
          one line, and hangs up its own leg. 46elks comes back for the second instruction, and the
          CRM answers with a ring list: the person asked for, then their failover, then voicemail.
          The caller is never re-dialled and never hears a second ring.
        </p>
      </Section>

      <Section title="Why the audio goes the long way round">
        <p>
          The obvious route, letting the carrier talk directly to the AI provider over SIP, does not
          work. The call connects and the agent runs, but no audio crosses in either direction. A 32
          second call produced a recording containing a file header and no sound at all, while the
          provider happily logged and billed a successful conversation.
        </p>
        <p>
          So the audio takes a different path: 46elks streams it over a WebSocket to a small bridge,
          which relays it to the provider and back. Both sides speak 16 kHz PCM, so there is nothing
          to convert and nothing to negotiate, which is what was failing over SIP.
        </p>
        <p>
          The bridge holds the agent&apos;s speech briefly and feeds it out on a clock instead of
          forwarding it in bulk. That is what lets an interruption stop the agent quickly: once audio
          is handed to the carrier it cannot be taken back, so anything not yet sent is simply
          dropped when the caller talks over it.
        </p>
      </Section>

      <Section title="What it knows, and what it will not do">
        <p>
          {persona} has one knowledge document, shown in full on the Knowledge tab, and it is given
          the whole thing on every call rather than looking things up. That makes it fast and
          predictable: there is no retrieval step to get wrong.
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>It may quote prices exactly as written, and must name the currency out loud.</li>
          <li>
            It may not convert a price into another currency, because there is no official price in
            kronor and any figure it produced would be one we do not charge.
          </li>
          <li>It may not discount, negotiate, waive a fee, or promise a date or a feature.</li>
          <li>It will say plainly that it is an AI if asked, and never claim to be human.</li>
          <li>
            When it does not know, it says so and offers a person. That is deliberate: declining is
            safer than improvising to a paying workshop.
          </li>
        </ul>
      </Section>

      <Section title="How it recognises callers">
        <p>
          Before it speaks, the CRM looks the caller&apos;s number up against contacts and the shared
          phone pool. If there is a match, {persona} is told who is calling, their company, and a one
          line history, so it can greet them by name. It is told who is reachable right now and
          whether the office is open, so it never offers to transfer to somebody who cannot be rung.
        </p>
      </Section>

      <Section title="Known limits">
        <ul className="list-disc list-inside space-y-1">
          <li>
            A transfer cannot be announced out loud to the person picking up. That feature only
            exists on the provider&apos;s own telephony integration, not over a bridge like ours, so
            the caller&apos;s details are posted to Slack instead, which arrives before the phone
            stops ringing.
          </li>
          <li>
            If two people are talking to {persona} in the same instant, the transfer tool matches on
            the newer call. Fine for an internal line; it would need a per-call identifier at real
            volume.
          </li>
          <li>
            Transcripts arrive a minute or two after a call, not instantly, because the provider
            finishes processing first.
          </li>
          <li>
            The whole thing stops if the telephony account runs out of credit, and it stops silently:
            the caller hears nothing and no error is raised anywhere.
          </li>
        </ul>
      </Section>

      <Section title="Live wiring">
        <div className="space-y-1">
          <p>
            Published number: <Mono>{settings?.number ?? "not set"}</Mono>
          </p>
          <p>
            Audio bridge number: <Mono>{settings?.bridge_number ?? "not set"}</Mono>
          </p>
          <p className="break-all">
            Carrier sends calls to: <Mono>{vaxelRouting ?? "unknown"}</Mono>
          </p>
          <p className="break-all">
            Audio streams to: <Mono>{bridgeRouting ?? "unknown"}</Mono>
          </p>
          <p>
            Agent id: <Mono>{settings?.provider_agent_id ?? "not provisioned"}</Mono>
          </p>
        </div>
        <p className="mt-2 text-slate-500">
          Read live from the carrier and the provider. If any of these say unknown, that is a real
          configuration problem rather than a display bug.
        </p>
      </Section>

      <div className="flex items-center gap-2 pt-1">
        <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
        <p className="text-[11px] text-slate-500">
          The numbers themselves, who owns them and what they cost, are on{" "}
          <Link href="/settings/phone-system" className="text-teal-600 underline">
            Phone System
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-xs font-medium text-slate-800 mb-1.5">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-slate-700">{children}</span>;
}
