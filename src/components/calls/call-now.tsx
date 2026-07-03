"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Loader2, ChevronDown, Star, Laptop, Smartphone } from "lucide-react";
import Link from "next/link";
import { PhoneDisplay } from "@/components/contacts/phone-field";
import { useCall } from "@/components/calls/call-provider";
import {
  CallDrawer,
  isStaleProcessing,
  type CallMode,
  type CallNowTarget,
  type CallNumber,
  type Session,
} from "@/components/calls/call-drawer";

// Re-export shared types so existing importers keep working.
export type { CallMode, CallNowTarget, CallNumber } from "@/components/calls/call-drawer";

/**
 * The "Call" button. A thin trigger: it resolves how to call (ring my phone vs
 * talk from computer, and which number), then hands off to the app-level
 * CallProvider via useCall().startCall(). The live drawer + minimized pill are
 * owned by the provider so they survive navigating away mid-call.
 */
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
  const { startCall } = useCall();
  const [placing, setPlacing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // null until first checked; false hides the "Talk from computer" option.
  const [webrtcAvailable, setWebrtcAvailable] = useState<boolean | null>(null);

  const pool = numbers ?? [];
  const hasPicker = pool.length > 1;
  const showCaret = hasPicker || webrtcAvailable !== false;

  // Probe WebRTC availability lazily (only when the menu opens) so it never
  // costs anything on list renders.
  const checkWebrtc = useCallback(async () => {
    if (webrtcAvailable !== null) return;
    try {
      const res = await fetch("/api/calls/webrtc-credentials");
      const json = await res.json();
      setWebrtcAvailable(res.ok && !!json.available);
    } catch {
      setWebrtcAvailable(false);
    }
  }, [webrtcAvailable]);

  const place = useCallback(
    async (to: string | null, mode: CallMode) => {
      setPickerOpen(false);
      setPlacing(true);
      try {
        await startCall(target, { to, mode, onLogged });
      } finally {
        setPlacing(false);
      }
    },
    [startCall, target, onLogged],
  );

  return (
    <div className="relative inline-flex">
      <button
        onClick={() => place(null, "bridge")}
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
            void checkWebrtc();
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
              onClick={() => place(null, "bridge")}
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
                onClick={() => place(null, "webrtc")}
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
                    onClick={() => place(n.number, "bridge")}
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
        // Stop polling on a terminal state, or when a "processing" row has been
        // stuck past the function timeout (it won't recover without a retry) —
        // otherwise the drawer would poll forever behind the spinner.
        const done =
          ["processed", "failed", "no_recording"].includes(json.session?.status) ||
          isStaleProcessing(json.session);
        if (done && pollRef.current) {
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
          // Bump updated_at optimistically so the just-retried call isn't
          // immediately re-flagged as stale before the first poll returns.
          setSession((s) =>
            s ? { ...s, status: "processing", error: null, updated_at: new Date().toISOString() } : s,
          );
          if (!pollRef.current) pollRef.current = setInterval(load, 3000);
        })
      }
    />
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
