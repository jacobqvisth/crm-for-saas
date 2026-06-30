// Browser-only JsSIP wrapper for "talk from the computer" calling.
//
// How outbound computer-calling works (no client-initiated SIP needed):
//   1. The browser registers as the 46elks WebRTC number (a SIP endpoint).
//   2. The CRM API places a normal 46elks call with `to = <webrtc-number>` and
//      `voice_start.connect = <contact>` — exactly like the phone bridge, just
//      ringing the browser leg instead of a mobile.
//   3. 46elks rings this registered client; we AUTO-ANSWER it, and 46elks
//      bridges the answered leg to the contact. Audio flows through the laptop.
//   4. The call is recorded server-side and POSTed to the hangup webhook, so the
//      Deepgram → Claude pipeline runs identically to a phone-bridge call.
//
// JsSIP touches `window`/`navigator`/WebRTC, so it is dynamically imported and
// this module must only ever run in the browser. A single shared UA is reused
// across calls (one agent → one registration).

import type { UA, WebSocketInterface } from "jssip";
import type { RTCSession } from "jssip/lib/RTCSession";
import type { RTCSessionEvent } from "jssip/lib/UA";

export interface WebrtcCreds {
  /** wss://voip.46elks.com/w1/websocket */
  wsUri: string;
  /** 4600120210@voip.46elks.com */
  uri: string;
  /** The WebRTC number's SIP password. */
  password: string;
}

export type WebrtcState =
  | "idle"
  | "connecting"
  | "registered"
  | "ringing"
  | "in_call"
  | "ended"
  | "error";

export interface WebrtcHandlers {
  onState?: (state: WebrtcState) => void;
  onError?: (message: string) => void;
}

class WebrtcPhone {
  private ua: UA | null = null;
  private session: RTCSession | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private handlers: WebrtcHandlers = {};
  /** When true, the next inbound session (our own outbound leg) auto-answers. */
  private armed = false;
  private credsKey: string | null = null;

  setHandlers(h: WebrtcHandlers) {
    this.handlers = h;
  }

  private emit(state: WebrtcState) {
    this.handlers.onState?.(state);
  }

  private fail(message: string) {
    this.handlers.onError?.(message);
    this.emit("error");
  }

  /** Lazily create + register the shared UA. Resolves once registered. */
  async ensureRegistered(creds: WebrtcCreds): Promise<void> {
    const key = `${creds.wsUri}|${creds.uri}`;
    // Reuse an existing live registration for the same identity.
    if (this.ua && this.ua.isRegistered() && this.credsKey === key) return;
    // Tear down a stale UA (different creds) before re-registering.
    if (this.ua && this.credsKey !== key) {
      try {
        this.ua.stop();
      } catch {
        /* ignore */
      }
      this.ua = null;
    }

    const JsSIP = await import("jssip");
    // JsSIP is chatty on the console; keep it quiet in production.
    if (process.env.NODE_ENV === "production") JsSIP.debug.disable();

    const socket = new JsSIP.WebSocketInterface(creds.wsUri) as WebSocketInterface;
    const ua = new JsSIP.UA({
      sockets: [socket],
      uri: creds.uri,
      password: creds.password,
      session_timers: false,
      register: true,
    }) as UA;
    this.ua = ua;
    this.credsKey = key;

    ua.on("newRTCSession", (e: RTCSessionEvent) => this.onNewSession(e));

    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup();
        this.emit("registered");
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error("WebRTC registration failed — check the SIP credentials."));
      };
      const cleanup = () => {
        ua.removeListener("registered", ok);
        ua.removeListener("registrationFailed", bad);
        ua.removeListener("disconnected", bad);
      };
      ua.on("registered", ok);
      ua.on("registrationFailed", bad);
      ua.on("disconnected", bad);
      this.emit("connecting");
      ua.start();
    });
  }

  /** Arm so the next inbound leg (our outbound call) is auto-answered. */
  arm() {
    this.armed = true;
  }

  private onNewSession(e: RTCSessionEvent) {
    // We only expect inbound legs (46elks calling our registered client as the
    // agent side of an outbound bridge). Ignore anything we didn't arm for.
    if ((e.originator as string) !== "remote") return;
    if (!this.armed) {
      try {
        e.session.terminate();
      } catch {
        /* ignore */
      }
      return;
    }
    this.armed = false;
    this.session = e.session;
    this.emit("ringing");
    this.wireSession(e.session);

    try {
      e.session.answer({
        mediaConstraints: { audio: true, video: false },
        pcConfig: { rtcpMuxPolicy: "require", iceServers: [] },
      });
    } catch (err) {
      this.fail(err instanceof Error ? err.message : "Failed to answer the call");
    }
  }

  private wireSession(session: RTCSession) {
    session.on("peerconnection", (data) => {
      const pc = data.peerconnection as unknown as RTCPeerConnection;
      pc.addEventListener("track", (ev: RTCTrackEvent) => {
        const [stream] = ev.streams;
        if (stream) this.attachRemoteAudio(stream);
      });
    });
    session.on("confirmed", () => this.emit("in_call"));
    session.on("ended", () => this.cleanupSession("ended"));
    session.on("failed", () => this.cleanupSession("ended"));
    session.on("getusermediafailed", () =>
      this.fail("Microphone access was blocked — allow the mic and try again."),
    );
  }

  private attachRemoteAudio(stream: MediaStream) {
    if (typeof document === "undefined") return;
    if (!this.audioEl) {
      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      this.audioEl.setAttribute("playsinline", "true");
      this.audioEl.style.display = "none";
      document.body.appendChild(this.audioEl);
    }
    this.audioEl.srcObject = stream;
    void this.audioEl.play().catch(() => {
      /* autoplay may need a gesture; the click that started the call counts */
    });
  }

  private cleanupSession(finalState: WebrtcState) {
    if (this.audioEl) {
      this.audioEl.srcObject = null;
    }
    this.session = null;
    this.emit(finalState);
  }

  setMuted(muted: boolean) {
    if (!this.session) return;
    if (muted) this.session.mute({ audio: true });
    else this.session.unmute({ audio: true });
  }

  hangup() {
    if (this.session && !this.session.isEnded()) {
      try {
        this.session.terminate();
      } catch {
        /* ignore */
      }
    }
    this.armed = false;
  }

  inCall(): boolean {
    return !!this.session && !this.session.isEnded();
  }
}

let singleton: WebrtcPhone | null = null;

/** The shared browser WebRTC phone (one per tab). */
export function getWebrtcPhone(): WebrtcPhone {
  if (!singleton) singleton = new WebrtcPhone();
  return singleton;
}
