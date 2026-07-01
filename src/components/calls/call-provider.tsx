"use client";

// App-level call session. Mounted once in the dashboard layout so the active
// call — its live status, controls, and AI review — survives page navigation.
//
// Why this exists: the Call button used to own the drawer state per-page, so
// navigating away mid-call unmounted the panel with no way back (the call and
// its server-side recording were unaffected, but the UI was gone). Now the
// button just calls startCall(); this provider holds the state, renders the
// drawer, and shows a persistent "call in progress" pill with an Open button
// whenever the panel is minimized.
//
// Minimize ≠ hang up: dismissing the drawer (X / backdrop) minimizes to the
// pill and the call keeps running. Only the explicit "Hang up" ends a computer
// (WebRTC) call; phone-bridge calls end when you hang up your phone.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Phone, PhoneOff, Mic, MicOff, Maximize2, X, Sparkles, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import {
  CallDrawer,
  type CallMode,
  type CallNowTarget,
  type Session,
} from "@/components/calls/call-drawer";
import { getWebrtcPhone, type WebrtcState, type WebrtcCreds } from "@/lib/calls/webrtc-client";

export type StartCallOptions = {
  /** Explicit number to dial (from the pool picker). Falls back to target.phone. */
  to?: string | null;
  /** Ring the agent's mobile ("bridge", default) or the browser ("webrtc"). */
  mode?: CallMode;
  /** Override company-level do-not-contact / NIX for a deliberate call. */
  override?: boolean;
  /** Called once the call finishes processing (e.g. to refresh a timeline). */
  onLogged?: () => void;
};

type CallContextValue = {
  /** True while a call is active (dialing → processed, until dismissed). */
  active: boolean;
  /** Place a call and take over the app-level drawer/pill. */
  startCall: (target: CallNowTarget, opts?: StartCallOptions) => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

/** Trigger buttons call this to place a call handled by the app-level provider. */
export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within <CallProvider>");
  return ctx;
}

type ActiveCall = {
  target: CallNowTarget;
  mode: CallMode;
  startedAt: number;
  sessionId: string | null;
  onLogged?: () => void;
};

const TERMINAL = ["processed", "failed", "no_recording"];

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [webrtcState, setWebrtcState] = useState<WebrtcState>("idle");
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(() => 0); // live-timer tick (0 until a call starts)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const credsRef = useRef<WebrtcCreds | null>(null);
  const webrtcUnsubRef = useRef<(() => void) | null>(null);
  // Latest onLogged, so the poll effect always sees the current callback.
  const onLoggedRef = useRef<(() => void) | undefined>(undefined);

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
        if (TERMINAL.includes(s.status)) {
          stopPolling();
          if (s.status === "processed") onLoggedRef.current?.();
        }
      } catch {
        /* transient — keep polling */
      }
    },
    [stopPolling],
  );

  // Poll while a call has a session id and hasn't reached a terminal state —
  // independent of whether the drawer is open, so a minimized call still lands
  // its recording + AI summary on the pill.
  const sessionId = activeCall?.sessionId ?? null;
  useEffect(() => {
    if (!sessionId) return;
    if (session && TERMINAL.includes(session.status)) return;
    poll(sessionId);
    pollRef.current = setInterval(() => poll(sessionId), 3000);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Live duration ticker while a call is in flight.
  useEffect(() => {
    if (!activeCall) return;
    const terminal = session && TERMINAL.includes(session.status);
    if (terminal) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeCall, session?.status]);

  const loadWebrtcCreds = useCallback(async (): Promise<WebrtcCreds | null> => {
    if (credsRef.current) return credsRef.current;
    try {
      const res = await fetch("/api/calls/webrtc-credentials");
      const json = await res.json();
      if (!res.ok || !json.available) return null;
      const creds: WebrtcCreds = { wsUri: json.wsUri, uri: json.uri, password: json.password };
      credsRef.current = creds;
      return creds;
    } catch {
      return null;
    }
  }, []);

  const startCall = useCallback(
    async (target: CallNowTarget, opts: StartCallOptions = {}) => {
      const mode = opts.mode ?? "bridge";
      const { to, override } = opts;

      // Take over the drawer immediately so the user sees progress (WebRTC
      // registration copy, ringing, etc.) even before the dial POST returns.
      onLoggedRef.current = opts.onLogged;
      setActiveCall({ target, mode, startedAt: Date.now(), sessionId: null, onLogged: opts.onLogged });
      setSession(null);
      setPanelOpen(true);
      setMuted(false);

      try {
        // For computer calls, register + arm the browser SIP client BEFORE
        // dialing (46elks may ring the browser leg immediately).
        if (mode === "webrtc") {
          const creds = await loadWebrtcCreds();
          if (!creds) {
            toast.error("Computer calling isn't set up yet.");
            setActiveCall(null);
            setPanelOpen(false);
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
            setActiveCall(null);
            setPanelOpen(false);
            return;
          }
          phone.arm();
        }

        const toNumber = to ?? target.phone ?? null;
        const res = await fetch("/api/calls/dial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: target.contactId,
            listId: target.listId ?? null,
            override: override ?? false,
            to: toNumber,
            mode,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (mode === "webrtc") getWebrtcPhone().hangup();
          if (json.error === "blocked") {
            setActiveCall(null);
            setPanelOpen(false);
            if (window.confirm(`${json.message}\n\nPlace the call anyway?`)) {
              return startCall(target, { ...opts, override: true });
            }
            return;
          }
          setActiveCall(null);
          setPanelOpen(false);
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
        setActiveCall((c) => (c ? { ...c, sessionId: json.sessionId } : c));
      } catch (err) {
        if (mode === "webrtc") getWebrtcPhone().hangup();
        setActiveCall(null);
        setPanelOpen(false);
        toast.error(err instanceof Error ? err.message : "Failed to place call");
      }
    },
    [loadWebrtcCreds],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      getWebrtcPhone().setMuted(next);
      return next;
    });
  }, []);

  const hangup = useCallback(() => {
    getWebrtcPhone().hangup();
  }, []);

  const retryProcessing = useCallback(() => {
    const id = activeCall?.sessionId;
    if (!id) return;
    fetch("/api/calls/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    }).then(() => {
      setSession((s) => (s ? { ...s, status: "processing", error: null } : s));
      if (!pollRef.current) pollRef.current = setInterval(() => poll(id), 3000);
    });
  }, [activeCall?.sessionId, poll]);

  // Dismiss the active call from the UI. Ends a live computer call first (so
  // dismissing a still-connected call doesn't leave it running headless).
  const dismiss = useCallback(() => {
    if (activeCall?.mode === "webrtc" && getWebrtcPhone().inCall()) getWebrtcPhone().hangup();
    webrtcUnsubRef.current?.();
    webrtcUnsubRef.current = null;
    stopPolling();
    setActiveCall(null);
    setSession(null);
    setPanelOpen(false);
    setWebrtcState("idle");
  }, [activeCall?.mode, stopPolling]);

  const status = session?.status ?? "dialing";
  const terminal = TERMINAL.includes(status);
  const webrtcLive =
    activeCall?.mode === "webrtc" &&
    ["connecting", "registered", "ringing", "in_call"].includes(webrtcState);
  const elapsed = activeCall && now ? Math.max(0, Math.floor((now - activeCall.startedAt) / 1000)) : 0;
  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, "0")}`;

  return (
    <CallContext.Provider value={{ active: !!activeCall, startCall }}>
      {children}

      {/* Active-call drawer (rendered app-level so it survives navigation). */}
      {activeCall && panelOpen && (
        <CallDrawer
          target={activeCall.target}
          session={session}
          onClose={() => setPanelOpen(false)}
          onRetry={retryProcessing}
          webrtc={
            activeCall.mode === "webrtc"
              ? { state: webrtcState, muted, onToggleMute: toggleMute, onHangup: hangup }
              : undefined
          }
        />
      )}

      {/* Minimized "call in progress" pill — the reopen affordance. */}
      {activeCall && !panelOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                {terminal ? (
                  <Sparkles className="h-4 w-4 shrink-0 text-indigo-600" />
                ) : (
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-500" />
                  </span>
                )}
                <span className="truncate">{activeCall.target.contactName}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500">
                {status === "processed"
                  ? "Call summary ready"
                  : terminal
                    ? (status === "no_recording" ? "No recording" : "Processing failed")
                    : activeCall.target.companyName
                      ? `${activeCall.target.companyName} · ${timer}`
                      : timer}
              </div>
            </div>
            <button
              onClick={dismiss}
              title={
                terminal
                  ? "Dismiss"
                  : webrtcLive
                    ? "Hang up & dismiss"
                    : "Dismiss (call continues on your phone)"
              }
              className="shrink-0 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={() => setPanelOpen(true)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              {terminal ? <Maximize2 className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Open
            </button>
            {webrtcLive && (
              <>
                <button
                  onClick={toggleMute}
                  disabled={webrtcState !== "in_call"}
                  title={muted ? "Unmute" : "Mute"}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <button
                  onClick={hangup}
                  title="Hang up"
                  className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-2.5 py-1.5 text-white hover:bg-rose-700"
                >
                  <PhoneOff className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </CallContext.Provider>
  );
}
