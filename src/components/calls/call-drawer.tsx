"use client";

// Presentational call drawer + its shared types/helpers.
//
// Split out of call-now.tsx so both the live-call provider (call-provider.tsx)
// and the past-call viewer (CallDetailDrawer in call-now.tsx) can render the
// same drawer without an import cycle. This file holds NO call lifecycle state —
// it just renders a `Session` plus optional live WebRTC controls.

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Phone,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Mail,
  ListTodo,
  RefreshCw,
  Hash,
  Laptop,
  Mic,
  MicOff,
  PhoneOff,
  Grid3x3,
  Languages,
} from "lucide-react";
import toast from "react-hot-toast";
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";
import { WebrtcState } from "@/lib/calls/webrtc-client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { LANGUAGE_OPTIONS, languageLabel } from "@/lib/i18n/languages";

/** Which leg rings as the agent: their mobile (bridge) or the browser (webrtc). */
export type CallMode = "bridge" | "webrtc";

/** A dialable number for the Call button's picker. */
export type CallNumber = { number: string; label: string | null; isPrimary: boolean };

export type CallNowTarget = {
  contactId: string;
  contactName: string;
  phone: string | null;
  companyId: string | null;
  companyName: string | null;
  listId?: string | null;
};

type SuggestedEmail = {
  recommended: boolean;
  subject: string;
  body: string;
  reason: string;
};
type SuggestedTask = { title: string; due_date: string | null };
type FeedbackItem = {
  category: string;
  severity: string | null;
  title: string | null;
  body: string;
};
type AiJson = {
  summary: string;
  summary_native?: string;
  contact_language?: string;
  key_takeaways: string[];
  sentiment: "positive" | "neutral" | "negative";
  suggested_outcome: CallOutcome;
  suggested_followup_email: SuggestedEmail;
  suggested_tasks: SuggestedTask[];
  feedback_items: FeedbackItem[];
};
type Utterance = { speaker: string; text: string; start_ms: number; end_ms: number };
export type Session = {
  id: string;
  status: string;
  duration_seconds: number | null;
  recording_url: string | null;
  summary: string | null;
  ai_json: AiJson | null;
  transcript: Utterance[] | null;
  error: string | null;
};

export const STATUS_COPY: Record<string, string> = {
  dialing: "Ringing your phone — answer to connect the call…",
  in_progress: "Call in progress…",
  completed: "Call ended — fetching the recording…",
  processing: "AI is transcribing & summarizing the call…",
  processed: "Done",
  failed: "Processing failed",
  no_recording: "No recording was captured for this call",
};

const WEBRTC_COPY: Record<WebrtcState, string> = {
  idle: "",
  connecting: "Connecting your computer…",
  registered: "Connected — placing the call…",
  ringing: "Connecting to the contact…",
  incoming: "Incoming call…",
  in_call: "On call",
  ended: "Call ended",
  error: "Computer call failed",
};

/** In-browser controls for a live computer (WebRTC) call. Shared between the
 *  drawer and the provider that constructs it so the two never drift. */
export type WebrtcControls = {
  state: WebrtcState;
  muted: boolean;
  onToggleMute: () => void;
  onHangup: () => void;
  /** Send a DTMF digit (0-9, *, #) to navigate the far end's phone menu. */
  onSendDtmf: (tone: string) => void;
};

/** Keypad layout for IVR navigation, in phone order. */
const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

const SENTIMENT_TONE: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
  negative: "bg-rose-100 text-rose-700",
};

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function CallDrawer({
  target,
  session,
  onClose,
  onRetry,
  contactHref,
  webrtc,
}: {
  target: CallNowTarget;
  session: Session | null;
  onClose: () => void;
  onRetry: () => void;
  /** When set, shows a "View contact" link in the header (used by the detail drawer). */
  contactHref?: string;
  /** Present for an active computer (WebRTC) call — renders in-browser controls. */
  webrtc?: WebrtcControls;
}) {
  const status = session?.status ?? "dialing";
  const ai = session?.ai_json ?? null;
  const transcript = session?.transcript ?? null;
  const inFlight = ["dialing", "in_progress", "completed", "processing"].includes(status);
  // Show the browser call controls while the WebRTC leg is live.
  const webrtcLive =
    webrtc && ["connecting", "registered", "ringing", "in_call"].includes(webrtc.state);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Phone className="h-4 w-4 text-teal-600" />
              Call · {target.contactName}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {target.companyName ? `${target.companyName} · ` : ""}
              {target.phone}
            </div>
            {contactHref && (
              <Link
                href={contactHref}
                className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                View contact →
              </Link>
            )}
          </div>
          <button
            onClick={onClose}
            title="Minimize — the call keeps running"
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* In-browser call controls (computer calling) */}
          {webrtcLive && webrtc && <WebrtcCallCard webrtc={webrtc} />}

          {/* Live status (hidden during a live computer call — the controls card covers it) */}
          {!webrtcLive && (
          <div
            className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
              status === "processed"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : status === "failed" || status === "no_recording"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
          >
            {inFlight ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : status === "processed" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{STATUS_COPY[status] ?? status}</span>
          </div>
          )}

          {(status === "failed" || status === "no_recording") && (
            <div className="space-y-2">
              {session?.error && <p className="text-xs text-rose-600">{session.error}</p>}
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry processing
              </button>
            </div>
          )}

          {/* AI review */}
          {ai && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-700">
                  <Sparkles className="h-3.5 w-3.5" /> AI summary
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {CALL_OUTCOME_LABEL[ai.suggested_outcome]}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${SENTIMENT_TONE[ai.sentiment]}`}
                >
                  {ai.sentiment}
                </span>
                {typeof session?.duration_seconds === "number" && (
                  <span className="text-xs text-slate-400">
                    {Math.floor(session.duration_seconds / 60)}m {session.duration_seconds % 60}s
                  </span>
                )}
              </div>

              <div>
                {ai.summary_native ? (
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    English
                  </div>
                ) : null}
                <p className="text-sm leading-relaxed text-slate-700">{ai.summary}</p>
              </div>

              {ai.summary_native ? (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Svenska
                  </div>
                  <p className="text-sm leading-relaxed text-slate-700">{ai.summary_native}</p>
                </div>
              ) : null}

              {ai.key_takeaways.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {ai.key_takeaways.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              )}

              {session?.recording_url && (
                <audio controls src={session.recording_url} className="w-full">
                  <track kind="captions" />
                </audio>
              )}

              {transcript && transcript.length > 0 && (
                <details className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">
                    Full transcript ({transcript.length} lines)
                  </summary>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto border-t border-slate-100 px-3 py-2.5">
                    {transcript.map((u, i) => (
                      <p key={i} className="text-xs leading-relaxed text-slate-600">
                        <span
                          className={`font-semibold ${u.speaker === "agent" ? "text-teal-700" : "text-slate-800"}`}
                        >
                          {u.speaker === "agent" ? "Agent" : "Contact"}:
                        </span>{" "}
                        {u.text}
                      </p>
                    ))}
                  </div>
                </details>
              )}

              <FollowupEmail
                target={target}
                suggested={ai.suggested_followup_email}
                defaultLanguage={ai.contact_language}
              />

              {ai.suggested_tasks.length > 0 && (
                <SuggestedTasks target={target} tasks={ai.suggested_tasks} />
              )}

              {ai.feedback_items.length > 0 && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1.5 text-xs font-semibold text-slate-700">
                    Product feedback captured ({ai.feedback_items.length})
                  </div>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {ai.feedback_items.map((f, i) => (
                      <li key={i}>
                        <span className="font-medium text-slate-700">{f.category}</span>
                        {f.severity ? ` · ${f.severity}` : ""}: {f.body}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Live controls for an in-browser (WebRTC) call: connection status, Mute, an
 * expandable DTMF keypad, and Hang up. The keypad lets the agent answer phone
 * menus mid-call ("press 1 for the workshop, 2 for reception") — DTMF is only
 * meaningful once the call is actually connected ("in_call").
 */
function WebrtcCallCard({ webrtc }: { webrtc: WebrtcControls }) {
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [dialed, setDialed] = useState("");
  const connected = webrtc.state === "in_call";

  const press = (digit: string) => {
    webrtc.onSendDtmf(digit);
    setDialed((s) => (s + digit).slice(-24));
  };

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-teal-800">
        {connected ? (
          <Laptop className="h-4 w-4 shrink-0" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        )}
        <span>{WEBRTC_COPY[webrtc.state]}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={webrtc.onToggleMute}
          disabled={!connected}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {webrtc.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {webrtc.muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={() => setKeypadOpen((v) => !v)}
          disabled={!connected}
          title="Keypad — press digits to navigate a phone menu"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${
            keypadOpen
              ? "border-teal-400 bg-teal-100 text-teal-800"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Grid3x3 className="h-4 w-4" /> Keypad
        </button>
        <button
          onClick={webrtc.onHangup}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
        >
          <PhoneOff className="h-4 w-4" /> Hang up
        </button>
      </div>

      {keypadOpen && connected && (
        <div className="mt-3">
          <div className="mb-2 flex h-5 items-center text-xs text-teal-700">
            {dialed ? (
              <>
                Pressed: <span className="ml-1 font-mono tracking-widest text-teal-900">{dialed}</span>
              </>
            ) : (
              <span className="text-teal-700/60">Tap a digit to answer the phone menu</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DTMF_KEYS.map((d) => (
              <button
                key={d}
                onClick={() => press(d)}
                className="rounded-lg border border-teal-200 bg-white py-2.5 text-lg font-semibold text-slate-700 hover:bg-teal-100 active:bg-teal-200"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FollowupEmail({
  target,
  suggested,
  defaultLanguage,
}: {
  target: CallNowTarget;
  suggested: SuggestedEmail;
  /** Contact language (ISO) the AI detected on the call; selector defaults to it. */
  defaultLanguage?: string;
}) {
  const { workspaceId } = useWorkspace();
  const [subject, setSubject] = useState(suggested.subject);
  const [body, setBody] = useState(suggested.body);
  const [language, setLanguage] = useState<string>(
    (defaultLanguage || "en").toLowerCase()
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Translated preview (what the recipient receives). The agent composes in
  // English; the send path re-translates server-side, so a stale preview never
  // determines what ships. Mirrors the contact compose modal.
  const [showPreview, setShowPreview] = useState(false);
  const [translated, setTranslated] = useState<{ subject: string; body: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const translatedKeyRef = useRef<string | null>(null);

  const fetchTranslation = useCallback(async () => {
    if (language === "en" || !workspaceId) return;
    if (!subject.trim() && !body.trim()) {
      setTranslated(null);
      translatedKeyRef.current = null;
      return;
    }
    const key = `${language} ${subject} ${body}`;
    if (translatedKeyRef.current === key) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch("/api/ai/translate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          subject,
          bodyHtml: textToHtml(body),
          targetLanguage: language,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTranslateError(data.error || "Translation failed");
        return;
      }
      setTranslated({ subject: data.subject || "", body: data.bodyHtml || "" });
      translatedKeyRef.current = key;
    } catch {
      setTranslateError("Network error while translating");
    } finally {
      setTranslating(false);
    }
  }, [language, subject, body, workspaceId]);

  // Invalidate + hide the preview when the target language changes.
  useEffect(() => {
    setTranslated(null);
    setTranslateError(null);
    translatedKeyRef.current = null;
  }, [language]);

  // Keep the preview fresh while it's open (debounced).
  useEffect(() => {
    if (!showPreview || language === "en") return;
    const t = setTimeout(() => void fetchTranslation(), 600);
    return () => clearTimeout(t);
  }, [showPreview, language, subject, body, fetchTranslation]);

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Subject and body are required");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/contacts/${target.contactId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          bodyHtml: textToHtml(body.trim()),
          targetLanguage: language,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send");
      toast.success(
        language === "en"
          ? "Follow-up email sent"
          : `Follow-up email sent in ${languageLabel(language)}`
      );
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <Mail className="h-3.5 w-3.5 text-indigo-600" /> Suggested follow-up email
        {!suggested.recommended && (
          <span className="font-normal text-slate-400">— AI didn&apos;t think one is needed</span>
        )}
      </div>

      {/* Send-language row: compose in English, translate at send. */}
      <div className="mb-2 flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500">Send in</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded border border-slate-200 px-2 py-1 text-sm bg-white"
          title="You edit in English; it's translated to this language when you send."
        >
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        {language !== "en" && (
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <Languages className="h-3.5 w-3.5" />
            {showPreview ? "Edit English" : `Preview in ${languageLabel(language)}`}
          </button>
        )}
      </div>

      {showPreview && language !== "en" ? (
        <div className="rounded border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1.5 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-700">
            <span className="inline-flex items-center gap-1 font-medium">
              <Languages className="h-3.5 w-3.5" />
              Recipient sees ({languageLabel(language)})
            </span>
            {translating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>
          {translateError ? (
            <div className="px-2 py-3 text-sm text-red-600">
              {translateError}{" "}
              <button
                onClick={() => {
                  translatedKeyRef.current = null;
                  void fetchTranslation();
                }}
                className="underline hover:text-red-700"
              >
                Retry
              </button>
            </div>
          ) : translated ? (
            <>
              <div className="px-2 py-1.5 bg-slate-50 border-b border-slate-100 text-xs text-slate-600">
                <span className="font-medium">Subject:</span>{" "}
                {translated.subject || <span className="text-slate-400">(empty)</span>}
              </div>
              <div
                className="prose prose-sm max-w-none px-2 py-2 text-sm text-slate-800"
                dangerouslySetInnerHTML={{ __html: translated.body || "<p class='text-slate-400'>(empty)</p>" }}
              />
            </>
          ) : (
            <div className="px-2 py-6 text-center text-sm text-slate-400">
              {translating ? `Translating to ${languageLabel(language)}…` : "Nothing to translate yet."}
            </div>
          )}
        </div>
      ) : (
        <>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mb-2 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
        </>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">
          {language !== "en"
            ? `You edit in English — sent in ${languageLabel(language)}.`
            : suggested.reason}
        </span>
        <button
          onClick={send}
          disabled={sending || sent}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {sent ? <CheckCircle2 className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
          {sent ? "Sent" : sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function SuggestedTasks({ target, tasks }: { target: CallNowTarget; tasks: SuggestedTask[] }) {
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [sent, setSent] = useState<Record<number, boolean>>({});
  const [sending, setSending] = useState<Record<number, boolean>>({});

  const add = async (i: number, t: SuggestedTask) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t.title,
          type: "call",
          due_date: t.due_date ? new Date(t.due_date).toISOString() : undefined,
          contact_id: target.contactId,
          company_id: target.companyId ?? undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setAdded((a) => ({ ...a, [i]: true }));
      toast.success("Task added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add task");
    }
  };

  const sendToSlack = async (i: number, t: SuggestedTask) => {
    setSending((s) => ({ ...s, [i]: true }));
    try {
      const res = await fetch("/api/slack/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t.title,
          dueDate: t.due_date ?? undefined,
          contactId: target.contactId || undefined,
          contactName: target.contactName,
          companyName: target.companyName ?? undefined,
        }),
      });
      if (res.status === 503) {
        toast.error("Slack isn't configured yet (#bug-reports webhook).");
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setSent((s) => ({ ...s, [i]: true }));
      toast.success("Sent to #bug-reports");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send to Slack");
    } finally {
      setSending((s) => ({ ...s, [i]: false }));
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <ListTodo className="h-3.5 w-3.5 text-indigo-600" /> Suggested follow-ups
      </div>
      <ul className="space-y-2">
        {tasks.map((t, i) => (
          <li key={i} className="flex items-start justify-between gap-2 text-sm text-slate-700">
            <span className="min-w-0">
              {t.title}
              {t.due_date ? <span className="ml-1 text-xs text-slate-400">({t.due_date})</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => sendToSlack(i, t)}
                disabled={sending[i] || sent[i]}
                title="Send to #bug-reports on Slack"
                className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <Hash className="h-3 w-3" />
                {sent[i] ? "Sent" : sending[i] ? "…" : "Slack"}
              </button>
              <button
                onClick={() => add(i, t)}
                disabled={added[i]}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {added[i] ? "Added" : "Add task"}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
