"use client";

// Persistent in-browser presence so callbacks can ring the computer.
//
// Mounted once in the dashboard layout. When this device is the WebRTC owner and
// "calls on this computer" is on, it registers the shared SIP client and listens
// for incoming legs. A real callback (the inbound webhook rings the WebRTC number
// in parallel with the cell) arrives here as an incoming session → we show an
// Accept/Decline card. Declining just drops the browser leg; the mobile keeps
// ringing. Per-device toggle is stored in localStorage (no account-level state).

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Phone, PhoneOff, Mic, MicOff, X } from "lucide-react";
import { getWebrtcPhone, type WebrtcCreds, type IncomingInfo } from "@/lib/calls/webrtc-client";

type Phase = "idle" | "incoming" | "in_call";
const LS_KEY = "wl_webrtc_presence_enabled";

export function WebrtcPresence() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [from, setFrom] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const credsRef = useRef<WebrtcCreds | null>(null);
  // True only for calls this presence surfaced (inbound). Outbound calls placed
  // from the Call button are owned by CallProvider's pill — we must not also pop
  // an in-call bar for them, or the two widgets collide.
  const mineRef = useRef(false);

  // Read the per-device preference once (default on).
  useEffect(() => {
    if (typeof window !== "undefined") {
      setEnabled(window.localStorage.getItem(LS_KEY) !== "0");
    }
  }, []);

  // Check availability (owner + configured) once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/calls/webrtc-credentials");
        const json = await res.json();
        if (cancelled || !res.ok || !json.available) return;
        credsRef.current = {
          wsUri: json.wsUri,
          uri: json.uri,
          password: json.password,
          iceServers: json.iceServers,
        };
        setAvailable(true);
      } catch {
        /* not available — stay silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const incomingHandler = useCallback((info: IncomingInfo) => {
    mineRef.current = true;
    setFrom(info.from);
    setMuted(false);
    setPhase("incoming");
  }, []);

  // Register (or detach) based on availability + the device toggle.
  useEffect(() => {
    if (!available || !credsRef.current || !enabled) return;
    const phone = getWebrtcPhone();
    const creds = credsRef.current;

    const unsub = phone.subscribe({
      onState: (s) => {
        if (s === "in_call") {
          // Only surface the in-call bar for calls WE brought in (inbound).
          // Outbound calls are the CallProvider pill's job.
          if (mineRef.current) {
            setPhase("in_call");
            setMuted(false);
          }
        } else if (s === "ended" || s === "error") {
          mineRef.current = false;
          setPhase("idle");
          setFrom(null);
        }
      },
    });

    // Elect a single presence tab. The 46elks WebRTC number allows only ONE SIP
    // registration at a time, so if several open CRM tabs each held one they'd
    // steal it from each other and the ringing leg could land on the wrong tab
    // (leaving the caller stuck on "Connecting…"). A cross-tab Web Lock ensures
    // exactly one tab holds the live registration; the rest wait for the lock.
    const ac = new AbortController();
    // Silent: background presence (re)registration must never emit call-state
    // ("connecting"/"registered") — otherwise a re-register on focus or on
    // another tab freeing the line would revert an in-progress or just-ended
    // call's UI back to "placing the call…".
    const register = () =>
      phone.ensureRegistered(creds, { silent: true }).catch(() => {
        /* registration failure is non-fatal; the cell still rings */
      });
    // When THIS tab is looking at the CRM, make sure it holds the line, so an
    // outbound call placed here (or an inbound one) reaches this tab.
    const onVisible = () => {
      if (document.visibilityState === "visible") void register();
    };
    const hold = async () => {
      // This tab is the elected presence holder: it keeps its registration even
      // after an outbound call (a non-presence caller tab drops its own).
      phone.setPresenceHolder(true);
      phone.setIncomingHandler(incomingHandler);
      await register();
      // If another tab grabs the line for an outbound call, it broadcasts a
      // release when done — reclaim the line for inbound then.
      phone.setLineFreedHandler(register);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onVisible);
      // Keep the lock (and the registration) until this tab releases it.
      await new Promise<void>((resolve) => {
        if (ac.signal.aborted) resolve();
        else ac.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      phone.setLineFreedHandler(null);
      phone.setPresenceHolder(false);
    };

    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks?.request) {
      void locks
        .request("wl-webrtc-presence", { signal: ac.signal }, hold)
        .catch(() => {
          /* aborted before we acquired the lock — another tab has presence */
        });
    } else {
      // No Web Locks support — best-effort: just register in this tab.
      void hold();
    }

    return () => {
      ac.abort();
      unsub();
      phone.setIncomingHandler(null);
    };
  }, [available, enabled, incomingHandler]);

  const toggle = () => {
    setEnabled((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  const accept = () => getWebrtcPhone().acceptIncoming();
  const decline = () => {
    getWebrtcPhone().declineIncoming();
    mineRef.current = false;
    setPhase("idle");
    setFrom(null);
  };
  const hangup = () => getWebrtcPhone().hangup();
  const toggleMute = () =>
    setMuted((m) => {
      const next = !m;
      getWebrtcPhone().setMuted(next);
      return next;
    });

  if (!available) return null;

  return (
    <>
      {/* Presence toggle — small, bottom-left */}
      {phase === "idle" && (
        <button
          onClick={toggle}
          title={
            enabled
              ? "Calls ring on this computer — click to turn off"
              : "Calls don't ring here — click to turn on"
          }
          className={`fixed bottom-4 left-4 z-40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
            enabled
              ? "border-teal-200 bg-teal-50 text-teal-700"
              : "border-slate-200 bg-white text-slate-500"
          }`}
        >
          <Headphones className="h-3.5 w-3.5" />
          {enabled ? "Calls on this computer" : "Computer calls off"}
        </button>
      )}

      {/* Incoming call card */}
      {phase === "incoming" && (
        <div className="fixed bottom-4 left-4 z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-500" />
              </span>
              Incoming call
            </div>
            <button onClick={decline} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-sm text-slate-600">{from ?? "Unknown number"}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={accept}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              <Phone className="h-4 w-4" /> Accept
            </button>
            <button
              onClick={decline}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <PhoneOff className="h-4 w-4" /> Decline
            </button>
          </div>
        </div>
      )}

      {/* In-call bar */}
      {phase === "in_call" && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 shadow-xl">
          <div className="flex items-center gap-2 text-sm font-medium text-teal-800">
            <Phone className="h-4 w-4" /> On call
            {from ? <span className="text-teal-600">· {from}</span> : null}
          </div>
          <button
            onClick={toggleMute}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            onClick={hangup}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
          >
            <PhoneOff className="h-4 w-4" /> Hang up
          </button>
        </div>
      )}
    </>
  );
}
