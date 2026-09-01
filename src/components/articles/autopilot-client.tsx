"use client";

// "Autopilot": publish N articles a day to wrenchlane.com without a human in the
// loop.
//
// The tab is built around one question, asked in the header: what will happen
// next, and when. Everything else on the page is either a setting that changes
// that answer or the log of what already happened. A scheduler whose next action
// you cannot see is a scheduler nobody trusts enough to leave switched on.
//
// The master switch is deliberately the last thing you reach, under the settings
// rather than above them, and "Run one now" sits beside it so the pipeline can
// be proved before the schedule is armed.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";

interface AutopilotSettings {
  enabled: boolean;
  perDay: number;
  intervalHours: number;
  startHour: number;
  timeZone: string;
  weekdaysOnly: boolean;
  publishMode: "live" | "stage";
  allowedCategories: string[];
  extraTags: string[];
  statsEvery: number;
  statsCooldownDays: number;
  options: Record<string, unknown>;
}

interface Decision {
  run: boolean;
  reason: string;
  slotsElapsed: number;
  nextSlotHour: number | null;
  slots: number[];
  slotLabels: string[];
}

interface RunRow {
  id: string;
  ran_at: string;
  status: "published" | "staged" | "skipped" | "failed";
  reason: string | null;
  trigger: string;
  url: string | null;
  source_kind: string | null;
  model: string | null;
  duration_ms: number | null;
}

interface Term {
  id: string;
  name: string;
}

interface AutopilotState {
  settings: AutopilotSettings;
  configured: boolean;
  lastCheckedAt: string | null;
  publishedToday: number;
  decision: Decision;
  runs: RunRow[];
  categories: Term[];
  tags: Term[];
  runway: { usable: number; note: string } | null;
}

const STATUS_STYLE: Record<RunRow["status"], { cls: string; label: string }> = {
  published: { cls: "bg-emerald-50 text-emerald-700", label: "Live" },
  staged: { cls: "bg-amber-50 text-amber-700", label: "Staged" },
  skipped: { cls: "bg-slate-100 text-slate-600", label: "Skipped" },
  failed: { cls: "bg-rose-50 text-rose-700", label: "Failed" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function AutopilotClient() {
  const [state, setState] = useState<AutopilotState | null>(null);
  const [draft, setDraft] = useState<AutopilotSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadingRunway, setLoadingRunway] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (withRunway = false) => {
    try {
      const res = await fetch(`/api/articles/autopilot${withRunway ? "?runway=1" : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Could not load settings (${res.status})`);
        return;
      }
      setState(data as AutopilotState);
      setDraft((data as AutopilotState).settings);
      setError(null);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
      setLoadingRunway(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<AutopilotSettings>) {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/articles/autopilot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? `Could not save (${res.status})`);
        return;
      }
      toast.success("Saved");
      await load();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    // Generation plus a publish is minutes, not seconds, and a silent wait that
    // long reads as a hang.
    const id = toast.loading("Writing and publishing one article. This takes a few minutes.");
    try {
      const res = await fetch("/api/articles/autopilot/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json().catch(() => ({}));
      toast.dismiss(id);
      if (data.status === "published") {
        toast.success(`Live: ${data.title ?? "article"}`, { duration: 9000 });
      } else if (data.status === "staged") {
        toast.success(`Staged in Webflow, not public yet: ${data.title ?? "article"}`, {
          duration: 9000,
        });
      } else {
        toast.error(data.reason ?? `Run failed (${res.status})`, { duration: 10000 });
      }
      await load();
    } catch {
      toast.dismiss(id);
      toast.error("Could not reach the server");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Autopilot
      </div>
    );
  }

  if (error || !state || !draft) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {error ?? "Autopilot is unavailable"}
      </div>
    );
  }

  const { decision } = state;
  const nextLabel =
    decision.nextSlotHour === null
      ? "no more today"
      : `${String(decision.nextSlotHour).padStart(2, "0")}:00`;

  return (
    <div className="space-y-6">
      {/* What happens next, in one sentence. */}
      <div
        className={`rounded-xl border p-5 ${
          draft.enabled ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg ${
                draft.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
              }`}
            >
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {draft.enabled ? "Autopilot is on" : "Autopilot is off"}
              </p>
              <p className="mt-0.5 text-sm text-slate-600">{decision.reason}</p>
              <p className="mt-2 text-xs text-slate-500">
                {state.publishedToday} of {draft.perDay} published today. Slots{" "}
                {decision.slotLabels.join(", ") || "none"} {draft.timeZone}. Next: {nextLabel}.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Scheduler last checked {timeAgo(state.lastCheckedAt)}
                {state.configured ? "" : " . Webflow is not configured, so nothing can publish."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runNow}
              disabled={running || !state.configured}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Write and publish one article right now, ignoring the schedule"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run one now
            </button>
            <button
              type="button"
              onClick={() => save({ enabled: !draft.enabled })}
              disabled={saving || !state.configured}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                draft.enabled ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {draft.enabled ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {draft.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
        </div>
      </div>

      {/* Cadence */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CalendarClock className="h-4 w-4 text-slate-400" /> Cadence
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Articles go out at the start hour and then every interval, that many times a day. The cron
          checks hourly, so a slot missed to an error is caught up at the next hour rather than lost.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Articles per day">
            <input
              type="number"
              min={1}
              max={12}
              value={draft.perDay}
              onChange={(e) => setDraft({ ...draft, perDay: Number(e.target.value) })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Hours between">
            <input
              type="number"
              min={1}
              max={12}
              value={draft.intervalHours}
              onChange={(e) => setDraft({ ...draft, intervalHours: Number(e.target.value) })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="First one at">
            <select
              value={draft.startHour}
              onChange={(e) => setDraft({ ...draft, startHour: Number(e.target.value) })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Field>
          <Field label="Days">
            <select
              value={draft.weekdaysOnly ? "weekdays" : "every"}
              onChange={(e) => setDraft({ ...draft, weekdaysOnly: e.target.value === "weekdays" })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="every">Every day</option>
              <option value="weekdays">Weekdays only</option>
            </select>
          </Field>
        </div>

        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          That is{" "}
          <strong>
            {previewSlots(draft).join(", ") || "no slots (the day runs out before that many fit)"}
          </strong>{" "}
          {draft.timeZone}
          {previewSlots(draft).length < draft.perDay
            ? ` . Only ${previewSlots(draft).length} of ${draft.perDay} fit before midnight; the rest are dropped.`
            : ""}
        </p>
      </section>

      {/* Where it lands on the site */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Where it lands on wrenchlane.com</h3>
        <p className="mt-1 text-xs text-slate-500">
          Autopilot articles go into the same Articles collection as everything else, so they render
          at /en/article/&lt;slug&gt; and appear in the normal index. What separates them is the tag
          below and the categories they are allowed into.
        </p>

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-700">Categories it may file under</p>
            <p className="mt-0.5 text-xs text-slate-500">
              None ticked means the whole taxonomy. Leave Product Updates and Industry &amp; Trends
              out: the first belongs to the Releases tab, the second needs a human opinion.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {state.categories.map((c) => {
                const on = draft.allowedCategories.some(
                  (n) => n.toLowerCase() === c.name.toLowerCase(),
                );
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        allowedCategories: on
                          ? draft.allowedCategories.filter(
                              (n) => n.toLowerCase() !== c.name.toLowerCase(),
                            )
                          : [...draft.allowedCategories, c.name],
                      })
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
              {!state.categories.length ? (
                <span className="text-xs text-slate-400">
                  Webflow is not configured, so the category list cannot be read.
                </span>
              ) : null}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700">Tags always applied</p>
            <p className="mt-0.5 text-xs text-slate-500">
              On top of whatever the classifier picks. `from-our-data` is the marker that makes
              machine-published articles identifiable from outside the CRM. A name that does not
              exist in Webflow is ignored rather than created.
            </p>
            <input
              type="text"
              value={draft.extraTags.join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  extraTags: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="from-our-data"
            />

            <p className="mt-4 text-xs font-medium text-slate-700">Publishing</p>
            <select
              value={draft.publishMode}
              onChange={(e) =>
                setDraft({ ...draft, publishMode: e.target.value as "live" | "stage" })
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="live">Publish live, no review</option>
              <option value="stage">Stage in Webflow, a human presses publish</option>
            </select>
          </div>
        </div>
      </section>

      {/* What it writes about */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Gauge className="h-4 w-4 text-slate-400" /> What it writes about
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Every article is a real diagnostic the platform ran, written as a case study. Every{" "}
          {draft.statsEvery || "N"}th one instead tells a platform-stats story. There is no
          free-topic path on purpose: unattended is exactly when ungrounded writing is most
          dangerous. When the well runs dry it stops rather than lowering the bar.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="A stats story every Nth article">
            <input
              type="number"
              min={0}
              max={50}
              value={draft.statsEvery}
              onChange={(e) => setDraft({ ...draft, statsEvery: Number(e.target.value) })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Days before repeating a stats angle">
            <input
              type="number"
              min={0}
              max={365}
              value={draft.statsCooldownDays}
              onChange={(e) => setDraft({ ...draft, statsCooldownDays: Number(e.target.value) })}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Runway">
            {state.runway ? (
              <p className="text-sm text-slate-700">
                <strong>{state.runway.usable}</strong> unused diagnostics
                <span className="block text-xs text-slate-500">
                  {Math.floor(state.runway.usable / Math.max(draft.perDay, 1))} days at this cadence
                </span>
              </p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLoadingRunway(true);
                  void load(true);
                }}
                disabled={loadingRunway}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingRunway ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Check
              </button>
            )}
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => save(draft)}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </button>
        <button
          type="button"
          onClick={() => setDraft(state.settings)}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Reset
        </button>
      </div>

      {/* The log */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Recent runs</h3>
        <p className="mt-1 text-xs text-slate-500">
          Routine skips are not logged; they would be twenty rows a day of &quot;next slot at
          14:00&quot;. Anything that published, failed, or ran out of things to write about is here.
        </p>

        {state.runs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Nothing yet.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {state.runs.map((r) => {
              const style = STATUS_STYLE[r.status];
              return (
                <div key={r.id} className="flex items-start gap-3 py-2.5">
                  <span
                    className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${style.cls}`}
                  >
                    {style.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-700">{r.reason}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {new Date(r.ran_at).toLocaleString()} . {r.trigger}
                      {r.model ? ` . ${r.model}` : ""}
                      {r.duration_ms ? ` . ${Math.round(r.duration_ms / 1000)}s` : ""}
                    </p>
                  </div>
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {draft.publishMode === "live" && draft.enabled ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Articles go live on wrenchlane.com with nobody reading them first. Every claim is tagged
          with its provenance in the Library, so an article that made an unsourced assertion can be
          found after the fact, but it will already be public.
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

/** The slot list for the settings currently in the form, before saving. */
function previewSlots(s: Pick<AutopilotSettings, "perDay" | "intervalHours" | "startHour">): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.perDay; i += 1) {
    const hour = s.startHour + i * s.intervalHours;
    if (hour > 23) break;
    out.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return out;
}
