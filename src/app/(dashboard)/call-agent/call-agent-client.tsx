"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  Pause,
  PhoneCall,
  PhoneOutgoing,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { CallDetailDrawer } from "@/components/calls/call-now";
import type { CallAgentSettings } from "@/lib/call-agent/types";

type JobRow = {
  id: string;
  contact_id: string;
  campaign_key: string | null;
  objective: string | null;
  status: string;
  scheduled_for: string;
  attempts: number;
  skip_reason: string | null;
  error: string | null;
  call_session_id: string | null;
  enqueued_at: string;
  finished_at: string | null;
  contacts: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    language: string | null;
    country_code: string | null;
    user_plan_type: string | null;
  } | null;
  companies: { id: string; name: string | null } | null;
};

type Voice = { voice_id: string; name: string; labels: Record<string, string>; preview_url: string | null };
type ListRow = { id: string; name: string; purpose?: string | null; is_dynamic?: boolean };

const STATUS_TONE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-700",
  queued: "bg-indigo-100 text-indigo-700",
  processing: "bg-indigo-100 text-indigo-700",
  calling: "bg-emerald-100 text-emerald-700",
  done: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  skipped: "bg-slate-100 text-slate-600",
  dismissed: "bg-slate-100 text-slate-500",
};

const TABS = ["Overview", "Queue", "Calls", "Settings"] as const;
type Tab = (typeof TABS)[number];

function contactName(j: JobRow): string {
  return (
    [j.contacts?.first_name, j.contacts?.last_name].filter(Boolean).join(" ").trim() ||
    j.contacts?.phone ||
    "Unknown contact"
  );
}

export default function CallAgentClient() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [settings, setSettings] = useState<CallAgentSettings | null>(null);
  const [webhooks, setWebhooks] = useState<{ post_call: string; initiation: string } | null>(null);
  const [callerId, setCallerId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ sessionId: string; job: JobRow } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, jRes] = await Promise.all([
        fetch("/api/call-agent/settings"),
        fetch("/api/call-agent/jobs?limit=200"),
      ]);
      const sJson = await sRes.json();
      const jJson = await jRes.json();
      if (!sRes.ok) throw new Error(sJson.error ?? "Failed to load settings");
      if (!jRes.ok) throw new Error(jJson.error ?? "Failed to load jobs");
      setSettings(sJson.settings);
      setWebhooks(sJson.webhooks);
      setCallerId(sJson.caller_id);
      setJobs(jJson.jobs ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchSettings = useCallback(
    async (updates: Record<string, unknown>, quiet = false) => {
      const res = await fetch("/api/call-agent/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Update failed");
        return false;
      }
      setSettings(json.settings);
      if (!quiet) toast.success("Saved");
      return true;
    },
    [],
  );

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const done = jobs.filter((j) => j.status === "done");
    const doneToday = done.filter((j) => (j.finished_at ?? "").startsWith(today));
    const open = jobs.filter((j) =>
      ["pending_approval", "queued", "processing", "calling"].includes(j.status),
    );
    return {
      doneToday: doneToday.length,
      doneTotal: done.length,
      open: open.length,
      pending: jobs.filter((j) => j.status === "pending_approval").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    };
  }, [jobs]);

  if (loading && !settings) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!settings) return null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Call Agent</h1>
            <p className="text-sm text-slate-500">
              {settings.persona_name} calls app users, asks how Wrenchlane is working, and helps
              them get further
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => patchSettings({ enabled: !settings.enabled })}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              settings.enabled
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            }`}
          >
            {settings.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {settings.enabled ? "Agent is ON, click to pause" : "Agent is OFF, click to start"}
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t
                ? "border-b-2 border-indigo-600 text-indigo-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
            {t === "Queue" && stats.pending > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                {stats.pending}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <Overview settings={settings} stats={stats} jobs={jobs} onOpen={(j) => j.call_session_id && setDrawer({ sessionId: j.call_session_id, job: j })} />
      )}
      {tab === "Queue" && (
        <Queue jobs={jobs} reload={load} settingsMode={settings.mode} />
      )}
      {tab === "Calls" && (
        <CallLog
          jobs={jobs}
          onOpen={(j) => j.call_session_id && setDrawer({ sessionId: j.call_session_id, job: j })}
        />
      )}
      {tab === "Settings" && (
        <SettingsTab
          settings={settings}
          webhooks={webhooks}
          callerId={callerId}
          patchSettings={patchSettings}
          reload={load}
        />
      )}

      {drawer && (
        <CallDetailDrawer
          sessionId={drawer.sessionId}
          target={{
            contactId: drawer.job.contact_id,
            contactName: contactName(drawer.job),
            phone: drawer.job.contacts?.phone ?? null,
            companyId: drawer.job.companies?.id ?? null,
            companyName: drawer.job.companies?.name ?? null,
          }}
          contactHref={`/contacts/${drawer.job.contact_id}`}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Overview({
  settings,
  stats,
  jobs,
  onOpen,
}: {
  settings: CallAgentSettings;
  stats: { doneToday: number; doneTotal: number; open: number; pending: number; failed: number };
  jobs: JobRow[];
  onOpen: (j: JobRow) => void;
}) {
  const recent = jobs.filter((j) => j.status === "done").slice(0, 8);
  const cards = [
    { label: "Calls today", value: `${stats.doneToday} / ${settings.daily_cap}` },
    { label: "Completed calls", value: String(stats.doneTotal) },
    { label: "In queue", value: String(stats.open) },
    { label: "Awaiting approval", value: String(stats.pending) },
    { label: "Failed", value: String(stats.failed) },
  ];
  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-2xl font-semibold text-slate-900">{c.value}</div>
            <div className="text-xs text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
        <PhoneCall className="h-4 w-4" /> Latest completed calls
      </div>
      {recent.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
          No completed calls yet. Provision the agent in Settings, then place a test call.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {recent.map((j) => (
            <li
              key={j.id}
              className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-slate-50"
              onClick={() => onOpen(j)}
            >
              <div>
                <div className="text-sm font-medium text-slate-800">{contactName(j)}</div>
                <div className="text-xs text-slate-500">
                  {j.companies?.name ?? ""}
                  {j.campaign_key ? ` · ${j.campaign_key}` : ""}
                </div>
              </div>
              <div className="text-xs text-slate-400">
                {j.finished_at ? formatDistanceToNow(new Date(j.finished_at), { addSuffix: true }) : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Queue({
  jobs,
  reload,
  settingsMode,
}: {
  jobs: JobRow[];
  reload: () => void;
  settingsMode: string;
}) {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [listId, setListId] = useState("");
  const [objective, setObjective] = useState("");
  const [enqueueing, setEnqueueing] = useState(false);

  useEffect(() => {
    fetch("/api/call-agent/lists")
      .then((r) => r.json())
      .then((j) => setLists(j.lists ?? []))
      .catch(() => {});
  }, []);

  const open = jobs.filter((j) =>
    ["pending_approval", "queued", "processing", "calling", "skipped", "failed"].includes(j.status),
  );

  const act = async (id: string, action: string) => {
    const res = await fetch(`/api/call-agent/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (!res.ok) toast.error(json.error ?? `${action} failed`);
    reload();
  };

  const enqueue = async () => {
    if (!listId) return;
    setEnqueueing(true);
    try {
      const res = await fetch("/api/call-agent/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId,
          campaignKey: lists.find((l) => l.id === listId)?.name ?? "list",
          objective: objective || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Enqueue failed");
      toast.success(
        `${json.enqueued} queued${json.skipped?.length ? `, ${json.skipped.length} skipped (no phone / excluded / already queued)` : ""}`,
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enqueue failed");
    } finally {
      setEnqueueing(false);
    }
  };

  return (
    <div>
      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
          <Sparkles className="h-4 w-4" /> Queue calls from a calling list
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Pick a list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.purpose && l.purpose !== "calling" ? ` (${l.purpose} list)` : ""}
                {l.is_dynamic ? " · dynamic" : ""}
              </option>
            ))}
          </select>
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Objective (optional): e.g. learn why they stopped logging in"
            className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={enqueue}
            disabled={!listId || enqueueing}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {enqueueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOutgoing className="h-4 w-4" />}
            Queue calls
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {settingsMode === "approve_each"
            ? "Approve-each mode: every queued call waits for your approval below before the agent dials."
            : "Autonomous mode: queued calls dial automatically within calling hours and the daily cap."}
        </p>
      </div>

      {open.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
          Queue is empty.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {open.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">
                    {contactName(j)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[j.status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {j.status.replace("_", " ")}
                  </span>
                </div>
                <div className="truncate text-xs text-slate-500">
                  {j.contacts?.phone ?? "no phone"}
                  {j.companies?.name ? ` · ${j.companies.name}` : ""}
                  {j.campaign_key ? ` · ${j.campaign_key}` : ""}
                  {j.skip_reason ? ` · skipped: ${j.skip_reason}` : ""}
                  {j.error ? ` · error: ${j.error}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {j.status === "pending_approval" && (
                  <button
                    onClick={() => act(j.id, "approve")}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </button>
                )}
                {["failed", "skipped"].includes(j.status) && (
                  <button
                    onClick={() => act(j.id, "retry")}
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Retry
                  </button>
                )}
                {["pending_approval", "queued", "skipped", "failed"].includes(j.status) && (
                  <button
                    onClick={() => act(j.id, "dismiss")}
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CallLog({ jobs, onOpen }: { jobs: JobRow[]; onOpen: (j: JobRow) => void }) {
  const finished = jobs.filter((j) => ["done", "failed"].includes(j.status));
  if (finished.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
        No calls yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {finished.map((j) => (
        <li
          key={j.id}
          className={`flex items-center justify-between px-4 py-3 ${j.call_session_id ? "cursor-pointer hover:bg-slate-50" : ""}`}
          onClick={() => j.call_session_id && onOpen(j)}
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-800">{contactName(j)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[j.status] ?? "bg-slate-100 text-slate-600"}`}
              >
                {j.status}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              {j.companies?.name ?? ""}
              {j.campaign_key ? ` · ${j.campaign_key}` : ""}
              {j.error ? ` · ${j.error}` : ""}
            </div>
          </div>
          <div className="text-xs text-slate-400">
            {j.finished_at ? formatDistanceToNow(new Date(j.finished_at), { addSuffix: true }) : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function SettingsTab({
  settings,
  webhooks,
  callerId,
  patchSettings,
  reload,
}: {
  settings: CallAgentSettings;
  webhooks: { post_call: string; initiation: string } | null;
  callerId: string | null;
  patchSettings: (u: Record<string, unknown>, quiet?: boolean) => Promise<boolean>;
  reload: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [testContactId, setTestContactId] = useState("");
  const [form, setForm] = useState({
    persona_name: settings.persona_name,
    daily_cap: settings.daily_cap,
    max_attempts_per_contact: settings.max_attempts_per_contact,
    min_days_between_calls: settings.min_days_between_calls,
    call_start_hour: settings.call_start_hour,
    call_end_hour: settings.call_end_hour,
    greeting_note: settings.greeting_note ?? "",
    mode: settings.mode,
    voice_default: settings.voice_ids.default ?? "",
  });

  useEffect(() => {
    if (settings.has_api_key) {
      fetch("/api/call-agent/voices")
        .then((r) => r.json())
        .then((j) => setVoices(j.voices ?? []))
        .catch(() => {});
    }
  }, [settings.has_api_key]);

  const saveKey = async () => {
    if (!apiKey.trim()) return;
    if (await patchSettings({ api_key: apiKey.trim() })) setApiKey("");
  };

  const saveForm = async () => {
    await patchSettings({
      persona_name: form.persona_name,
      daily_cap: Number(form.daily_cap),
      max_attempts_per_contact: Number(form.max_attempts_per_contact),
      min_days_between_calls: Number(form.min_days_between_calls),
      call_start_hour: Number(form.call_start_hour),
      call_end_hour: Number(form.call_end_hour),
      greeting_note: form.greeting_note || null,
      mode: form.mode,
      voice_ids: form.voice_default ? { default: form.voice_default } : {},
    });
  };

  const provision = async () => {
    setProvisioning(true);
    try {
      const res = await fetch("/api/call-agent/provision", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        const failing = (json.steps ?? [])
          .filter((s: { ok: boolean }) => !s.ok)
          .map((s: { step: string; detail?: string }) => `${s.step}: ${s.detail ?? "failed"}`)
          .join("; ");
        throw new Error(failing || json.error || "Provisioning failed");
      }
      toast.success("Agent provisioned and synced with ElevenLabs");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Provisioning failed");
    } finally {
      setProvisioning(false);
    }
  };

  const testCall = async () => {
    if (!testContactId.trim()) return;
    const res = await fetch("/api/call-agent/test-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: testContactId.trim() }),
    });
    const json = await res.json();
    if (!res.ok || json.outcome !== "dialed") {
      toast.error(json.reason ?? json.error ?? "Test call failed");
    } else {
      toast.success("Dialing! The contact's phone should ring shortly.");
      reload();
    }
  };

  const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-slate-600";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Settings2 className="h-4 w-4" /> Provider (ElevenLabs)
          </h2>
          <div className="mb-3">
            <label className={label}>
              API key {settings.has_api_key && <span className="text-emerald-600">· configured</span>}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.has_api_key ? "Replace key…" : "sk_…"}
                className={input}
              />
              <button
                onClick={saveKey}
                disabled={!apiKey.trim()}
                className="shrink-0 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
          <button
            onClick={provision}
            disabled={!settings.has_api_key || provisioning}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {provisioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            {settings.provider_agent_ids.default ? "Re-sync agent (prompt, knowledge, voice)" : "Provision agent on ElevenLabs"}
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Creates/updates the agent, uploads the AI knowledge base, imports the caller ID
            {callerId ? ` (${callerId})` : ""} as a SIP number and registers the briefing webhook.
            Run again after editing Settings → AI knowledge.
          </p>
          {settings.provider_agent_ids.default && (
            <p className="mt-1 break-all text-xs text-slate-400">
              agent_id: {settings.provider_agent_ids.default}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Persona and voice</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Persona name</label>
              <input
                value={form.persona_name}
                onChange={(e) => setForm({ ...form, persona_name: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Voice</label>
              <select
                value={form.voice_default}
                onChange={(e) => setForm({ ...form, voice_default: e.target.value })}
                className={input}
              >
                <option value="">Default (Sarah, multilingual)</option>
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {v.labels.accent ? ` (${v.labels.accent})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className={label}>Extra instructions for the agent (optional)</label>
            <textarea
              value={form.greeting_note}
              onChange={(e) => setForm({ ...form, greeting_note: e.target.value })}
              rows={3}
              className={input}
              placeholder="e.g. This week, ask specifically about the new DTC lookup."
            />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Test call</h2>
          <div className="flex gap-2">
            <input
              value={testContactId}
              onChange={(e) => setTestContactId(e.target.value)}
              placeholder="Contact ID (create a contact card with your own number)"
              className={input}
            />
            <button
              onClick={testCall}
              disabled={!testContactId.trim() || !settings.provider_agent_ids.default}
              className="shrink-0 flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <PhoneCall className="h-4 w-4" /> Call now
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Bypasses exclusions, calling hours and the daily cap. Use your own contact card.
          </p>
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Guardrails</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Mode</label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as CallAgentSettings["mode"] })}
                className={input}
              >
                <option value="approve_each">Approve each call</option>
                <option value="autonomous">Autonomous</option>
              </select>
            </div>
            <div>
              <label className={label}>Daily cap</label>
              <input
                type="number"
                min={1}
                value={form.daily_cap}
                onChange={(e) => setForm({ ...form, daily_cap: Number(e.target.value) })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Max attempts per contact</label>
              <input
                type="number"
                min={1}
                value={form.max_attempts_per_contact}
                onChange={(e) => setForm({ ...form, max_attempts_per_contact: Number(e.target.value) })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Days between calls to same contact</label>
              <input
                type="number"
                min={0}
                value={form.min_days_between_calls}
                onChange={(e) => setForm({ ...form, min_days_between_calls: Number(e.target.value) })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Calling hours start (contact local time)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={form.call_start_hour}
                onChange={(e) => setForm({ ...form, call_start_hour: Number(e.target.value) })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Calling hours end</label>
              <input
                type="number"
                min={1}
                max={24}
                value={form.call_end_hour}
                onChange={(e) => setForm({ ...form, call_end_hour: Number(e.target.value) })}
                className={input}
              />
            </div>
          </div>
          <button
            onClick={saveForm}
            className="mt-4 w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900"
          >
            Save settings
          </button>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Webhooks</h2>
          <p className="mb-2 text-xs text-slate-500">
            The briefing webhook is registered automatically at provisioning. The post-call
            webhook must be added once in the ElevenLabs dashboard (Agents → Settings →
            Webhooks) with this URL — until then, a background worker collects results with a
            couple of minutes delay, so nothing is lost either way.
          </p>
          {webhooks && (
            <div className="space-y-2">
              <div>
                <label className={label}>Post-call webhook URL</label>
                <input readOnly value={webhooks.post_call} className={`${input} bg-slate-50 text-xs`} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <label className={label}>Briefing (initiation) webhook URL</label>
                <input readOnly value={webhooks.initiation} className={`${input} bg-slate-50 text-xs`} onFocus={(e) => e.target.select()} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
