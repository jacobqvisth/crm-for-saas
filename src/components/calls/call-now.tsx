"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ChevronDown,
  Star,
  Laptop,
  Smartphone,
  Mic,
  MicOff,
  PhoneOff,
} from "lucide-react";
import toast from "react-hot-toast";
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";
import { PhoneDisplay } from "@/components/contacts/phone-field";
import { getWebrtcPhone, type WebrtcState, type WebrtcCreds } from "@/lib/calls/webrtc-client";

/** Which leg rings as the agent: their mobile (bridge) or the browser (webrtc). */
type CallMode = "bridge" | "webrtc";

/** A dialable number for the Call button's picker. */
export type CallNumber = { number: string; label: string | null; isPrimary: boolean };

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
  key_takeaways: string[];
  sentiment: "positive" | "neutral" | "negative";
  suggested_outcome: CallOutcome;
  suggested_followup_email: SuggestedEmail;
  suggested_tasks: SuggestedTask[];
  feedback_items: FeedbackItem[];
};
type Utterance = { speaker: string; text: string; start_ms: number; end_ms: number };
type Session = {
  id: string;
  status: string;
  duration_seconds: number | null;
  recording_url: string | null;
  summary: string | null;
  ai_json: AiJson | null;
  transcript: Utterance[] | null;
  error: string | null;
};

export type CallNowTarget = {
  contactId: string;
  contactName: string;
  phone: string | null;
  companyId: string | null;
  companyName: string | null;
  listId?: string | null;
};

const STATUS_COPY: Record<string, string> = {
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

export function CallNowButton({
  target,
  numbers,
  onLogged,
  className,
}: {
  target: CallNowTarget;
  /** All dialable numbers for this contact's company pool. When more than one,
   *  the button shows a picker so you choose which to call. */
  numbers?: CallNumber[];
  onLogged?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [placing, setPlacing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // WebRTC ("talk from computer") state. webrtcAvailable is null until first
  // checked; creds are cached so we register once per tab.
  const [webrtcAvailable, setWebrtcAvailable] = useState<boolean | null>(null);
  const [webrtcState, setWebrtcState] = useState<WebrtcState>("idle");
  const [muted, setMuted] = useState(false);
  const [activeMode, setActiveMode] = useState<CallMode>("bridge");
  const credsRef = useRef<WebrtcCreds | null>(null);
  const webrtcUnsubRef = useRef<(() => void) | null>(null);

  const pool = numbers ?? [];
  const hasPicker = pool.length > 1;
  // Show the options caret whenever there's a choice to make: multiple numbers,
  // or computer-calling is (or might be) available.
  const showCaret = hasPicker || webrtcAvailable !== false;

  // Lazily fetch WebRTC credentials/availability (only when the menu opens, so
  // it never costs anything on list renders). Returns the creds, or null.
  const loadWebrtcCreds = useCallback(async (): Promise<WebrtcCreds | null> => {
    if (credsRef.current) return credsRef.current;
    try {
      const res = await fetch("/api/calls/webrtc-credentials");
      const json = await res.json();
      if (!res.ok || !json.available) {
        setWebrtcAvailable(false);
        return null;
      }
      const creds: WebrtcCreds = { wsUri: json.wsUri, uri: json.uri, password: json.password };
      credsRef.current = creds;
      setWebrtcAvailable(true);
      return creds;
    } catch {
      setWebrtcAvailable(false);
      return null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/calls/session/${id}`);
        if (!res.ok) return;
        const json = await res.json();
        const s: Session = json.session;
        setSession(s);
        if (["processed", "failed", "no_recording"].includes(s.status)) {
          stopPolling();
          if (s.status === "processed") onLogged?.();
        }
      } catch {
        /* transient — keep polling */
      }
    },
    [onLogged, stopPolling],
  );

  useEffect(() => {
    if (!sessionId || !open) return;
    poll(sessionId);
    pollRef.current = setInterval(() => poll(sessionId), 3000);
    return stopPolling;
  }, [sessionId, open, poll, stopPolling]);

  const dial = useCallback(
    async (override = false, to?: string | null, mode: CallMode = "bridge") => {
      setPickerOpen(false);
      setPlacing(true);
      try {
        // For computer calls, register the browser SIP client and arm it to
        // auto-answer BEFORE placing the call (46elks may ring it immediately).
        if (mode === "webrtc") {
          const creds = await loadWebrtcCreds();
          if (!creds) {
            toast.error("Computer calling isn't set up yet.");
            return;
          }
          const phone = getWebrtcPhone();
          webrtcUnsubRef.current?.();
          webrtcUnsubRef.current = phone.subscribe({
            onState: (s) => {
              setWebrtcState(s);
              if (s === "in_call") setMuted(false);
            },
            onError: (msg) => toast.error(msg),
          });
          setWebrtcState("connecting");
          try {
            await phone.ensureRegistered(creds);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't connect the computer phone");
            setWebrtcState("error");
            return;
          }
          phone.arm();
        }

        // Dial the explicitly chosen number, else the button's default
        // (the pool primary). Always send `to` so we ring exactly what the UI shows.
        const toNumber = to ?? target.phone ?? null;
        const res = await fetch("/api/calls/dial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: target.contactId,
            listId: target.listId ?? null,
            override,
            to: toNumber,
            mode,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (mode === "webrtc") getWebrtcPhone().hangup();
          if (json.error === "blocked") {
            if (window.confirm(`${json.message}\n\nPlace the call anyway?`)) {
              setPlacing(false);
              return dial(true, to, mode);
            }
            return;
          }
          if (json.error === "no_agent_phone") {
            toast.error("Set your phone number in Call Settings first.");
            return;
          }
          if (json.error === "webrtc_unavailable") {
            toast.error("Computer calling isn't configured.");
            return;
          }
          throw new Error(json.message || json.error || "Failed to place call");
        }
        toast.success(
          mode === "webrtc"
            ? "Calling — connecting in your browser…"
            : "Calling — your phone should ring now.",
        );
        setActiveMode(mode);
        setSession(null);
        setSessionId(json.sessionId);
        setOpen(true);
      } catch (err) {
        if (mode === "webrtc") getWebrtcPhone().hangup();
        toast.error(err instanceof Error ? err.message : "Failed to place call");
      } finally {
        setPlacing(false);
      }
    },
    [target, loadWebrtcCreds],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      getWebrtcPhone().setMuted(next);
      return next;
    });
  }, []);

  const hangupWebrtc = useCallback(() => {
    getWebrtcPhone().hangup();
  }, []);

  const close = () => {
    // Hang up an in-progress computer call when the drawer is dismissed.
    if (activeMode === "webrtc" && getWebrtcPhone().inCall()) getWebrtcPhone().hangup();
    webrtcUnsubRef.current?.();
    webrtcUnsubRef.current = null;
    setOpen(false);
    stopPolling();
  };

  return (
    <>
      <div className="relative inline-flex">
        <button
          onClick={() => dial(false)}
          disabled={placing || !target.phone}
          title={target.phone ? `Call ${target.phone}` : "No phone number"}
          className={
            className ??
            `inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 ${
              showCaret ? "rounded-l-lg" : "rounded-lg"
            }`
          }
        >
          {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
          Call
        </button>

        {showCaret && (
          <button
            onClick={() => {
              setPickerOpen((v) => !v);
              if (webrtcAvailable === null) void loadWebrtcCreds();
            }}
            disabled={placing}
            title="Call options"
            aria-label="Call options"
            className="inline-flex items-center px-1.5 py-1.5 text-white bg-teal-600 hover:bg-teal-700 rounded-r-lg border-l border-teal-500 disabled:opacity-50"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}

        {pickerOpen && showCaret && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                How to call
              </div>
              <button
                onClick={() => dial(false, null, "bridge")}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <Smartphone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-slate-900">Ring my phone</span>
                  <span className="block truncate text-xs text-slate-500">Answer on your mobile</span>
                </span>
              </button>
              {webrtcAvailable !== false && (
                <button
                  onClick={() => dial(false, null, "webrtc")}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <Laptop className="w-3.5 h-3.5 shrink-0 text-teal-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-900">Talk from computer</span>
                    <span className="block truncate text-xs text-slate-500">Use your headset / mic</span>
                  </span>
                </button>
              )}

              {hasPicker && (
                <>
                  <div className="mt-1 border-t border-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Call which number
                  </div>
                  {pool.map((n) => (
                    <button
                      key={n.number}
                      onClick={() => dial(false, n.number, "bridge")}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      {n.isPrimary ? (
                        <Star className="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      ) : (
                        <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-slate-900">
                          <PhoneDisplay value={n.number} />
                        </span>
                        {n.label && (
                          <span className="block truncate text-xs text-slate-500">{n.label}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {open && (
        <CallDrawer
          target={target}
          session={session}
          onClose={close}
          webrtc={
            activeMode === "webrtc"
              ? { state: webrtcState, muted, onToggleMute: toggleMute, onHangup: hangupWebrtc }
              : undefined
          }
          onRetry={() =>
            sessionId &&
            fetch("/api/calls/process", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId }),
            }).then(() => {
              setSession((s) => (s ? { ...s, status: "processing", error: null } : s));
              pollRef.current = setInterval(() => poll(sessionId), 3000);
            })
          }
        />
      )}
    </>
  );
}

/**
 * Opens the same review drawer for a PAST call, loaded by session id — used
 * from the contact timeline and the Calls page so you can replay the recording,
 * read the full transcript, and see the AI summary after the fact.
 */
export function CallDetailDrawer({
  sessionId,
  target,
  onClose,
  contactHref,
}: {
  sessionId: string;
  target: CallNowTarget;
  onClose: () => void;
  contactHref?: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls/session/${sessionId}`);
      if (res.ok) {
        const json = await res.json();
        setSession(json.session);
        if (["processed", "failed", "no_recording"].includes(json.session?.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
    // Keep polling only while a call is still being processed.
    pollRef.current = setInterval(load, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  if (loading && !session) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
        <div className="flex h-full w-full max-w-lg items-center justify-center bg-white shadow-xl">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <CallDrawer
      target={target}
      session={session}
      onClose={onClose}
      contactHref={contactHref}
      onRetry={() =>
        fetch("/api/calls/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        }).then(() => {
          setSession((s) => (s ? { ...s, status: "processing", error: null } : s));
          if (!pollRef.current) pollRef.current = setInterval(load, 3000);
        })
      }
    />
  );
}

function CallDrawer({
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
  webrtc?: {
    state: WebrtcState;
    muted: boolean;
    onToggleMute: () => void;
    onHangup: () => void;
  };
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* In-browser call controls (computer calling) */}
          {webrtcLive && webrtc && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-teal-800">
                {webrtc.state === "in_call" ? (
                  <Laptop className="h-4 w-4 shrink-0" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                )}
                <span>{WEBRTC_COPY[webrtc.state]}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={webrtc.onToggleMute}
                  disabled={webrtc.state !== "in_call"}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {webrtc.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {webrtc.muted ? "Unmute" : "Mute"}
                </button>
                <button
                  onClick={webrtc.onHangup}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
                >
                  <PhoneOff className="h-4 w-4" /> Hang up
                </button>
              </div>
            </div>
          )}

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

              <FollowupEmail target={target} suggested={ai.suggested_followup_email} />

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

function FollowupEmail({
  target,
  suggested,
}: {
  target: CallNowTarget;
  suggested: SuggestedEmail;
}) {
  const [subject, setSubject] = useState(suggested.subject);
  const [body, setBody] = useState(suggested.body);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

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
        body: JSON.stringify({ subject: subject.trim(), bodyHtml: textToHtml(body.trim()) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send");
      toast.success("Follow-up email sent");
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
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">{suggested.reason}</span>
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

/** Small inline hint shown when calling isn't configured yet. */
export function CallSettingsHint() {
  return (
    <Link href="/settings" className="text-xs text-indigo-600 hover:underline">
      Configure calling →
    </Link>
  );
}
