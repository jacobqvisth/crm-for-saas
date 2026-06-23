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
} from "lucide-react";
import toast from "react-hot-toast";
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";

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
  key_takeaways: string[];
  sentiment: "positive" | "neutral" | "negative";
  suggested_outcome: CallOutcome;
  suggested_followup_email: SuggestedEmail;
  suggested_tasks: SuggestedTask[];
  feedback_items: FeedbackItem[];
};
type Session = {
  id: string;
  status: string;
  duration_seconds: number | null;
  recording_url: string | null;
  summary: string | null;
  ai_json: AiJson | null;
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
  onLogged,
  className,
}: {
  target: CallNowTarget;
  onLogged?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [placing, setPlacing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    async (override = false) => {
      setPlacing(true);
      try {
        const res = await fetch("/api/calls/dial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: target.contactId,
            listId: target.listId ?? null,
            override,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (json.error === "blocked") {
            if (window.confirm(`${json.message}\n\nPlace the call anyway?`)) {
              setPlacing(false);
              return dial(true);
            }
            return;
          }
          if (json.error === "no_agent_phone") {
            toast.error("Set your phone number in Call Settings first.");
            return;
          }
          throw new Error(json.message || json.error || "Failed to place call");
        }
        toast.success("Calling — your phone should ring now.");
        setSession(null);
        setSessionId(json.sessionId);
        setOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to place call");
      } finally {
        setPlacing(false);
      }
    },
    [target],
  );

  const close = () => {
    setOpen(false);
    stopPolling();
  };

  return (
    <>
      <button
        onClick={() => dial(false)}
        disabled={placing || !target.phone}
        title={target.phone ? `Call ${target.phone}` : "No phone number"}
        className={
          className ??
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
        }
      >
        {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
        Call
      </button>

      {open && (
        <CallDrawer
          target={target}
          session={session}
          onClose={close}
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

function CallDrawer({
  target,
  session,
  onClose,
  onRetry,
}: {
  target: CallNowTarget;
  session: Session | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const status = session?.status ?? "dialing";
  const ai = session?.ai_json ?? null;
  const inFlight = ["dialing", "in_progress", "completed", "processing"].includes(status);

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
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Live status */}
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

              <p className="text-sm leading-relaxed text-slate-700">{ai.summary}</p>

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

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <ListTodo className="h-3.5 w-3.5 text-indigo-600" /> Suggested follow-ups
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-sm text-slate-700">
            <span>
              {t.title}
              {t.due_date ? <span className="ml-1 text-xs text-slate-400">({t.due_date})</span> : null}
            </span>
            <button
              onClick={() => add(i, t)}
              disabled={added[i]}
              className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {added[i] ? "Added" : "Add task"}
            </button>
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
