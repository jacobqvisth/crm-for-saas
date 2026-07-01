// Browser-only JsSIP wrapper for computer calling (outbound + inbound).
//
// Outbound ("talk from the computer"), no client-initiated SIP needed:
//   1. The browser registers as the 46elks WebRTC number (a SIP endpoint).
//   2. The CRM API places a normal 46elks call with `to = <webrtc-number>` and
//      `voice_start.connect = <contact>` — like the phone bridge, just ringing
//      the browser leg. We ARM the client so it auto-answers that inbound leg.
//   3. 46elks bridges the answered browser leg to the contact. Audio flows
//      through the laptop; the call is recorded server-side as usual.
//
// Inbound ("ring my computer too" on a callback):
//   The inbound webhook returns `connect: "<webrtc-number>,<cell>"`, so 46elks
//   rings the browser AND the mobile at once. The browser leg arrives as an
//   un-armed incoming session — we surface it for manual Accept/Decline.
//
// JsSIP touches `window`/`navigator`/WebRTC, so it is dynamically imported and
// this module only ever runs in the browser. A single shared UA per tab serves
// both the persistent inbound presence and on-demand outbound calls.

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
  /** ICE servers (STUN/TURN) for media negotiation. Without at least a STUN
   *  server, a laptop behind NAT can only offer host candidates and audio may
   *  never flow. Served from the credentials endpoint so it's configurable. */
  iceServers?: RTCIceServer[];
}

/** How long to wait for SIP registration before giving up (ms). */
const REGISTER_TIMEOUT_MS = 15_000;
/** How long an armed outbound leg may take to reach the browser (ms). If 46elks
 *  never rings this tab — e.g. another tab/device holds the single shared
 *  registration — we surface an error instead of spinning on "Connecting…". */
const ARM_TIMEOUT_MS = 25_000;

export type WebrtcState =
  | "idle"
  | "connecting"
  | "registered"
  | "ringing"
  | "incoming"
  | "in_call"
  | "ended"
  | "error";

export interface WebrtcHandlers {
  onState?: (state: WebrtcState) => void;
  onError?: (message: string) => void;
}

export interface IncomingInfo {
  /** Best-effort caller number from the SIP From header (E.164-ish), if any. */
  from: string | null;
}

class WebrtcPhone {
  private ua: UA | null = null;
  private session: RTCSession | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private listeners = new Set<WebrtcHandlers>();
  private incomingHandler: ((info: IncomingInfo) => void) | null = null;
  /** When true, the next inbound session (our own outbound leg) auto-answers. */
  private armed = false;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private credsKey: string | null = null;
  private iceServers: RTCIceServer[] = [];

  /** Subscribe to state/error events. Returns an unsubscribe fn. */
  subscribe(h: WebrtcHandlers): () => void {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  /** Set the handler that surfaces un-armed incoming calls (inbound presence). */
  setIncomingHandler(fn: ((info: IncomingInfo) => void) | null) {
    this.incomingHandler = fn;
  }

  private emit(state: WebrtcState) {
    this.listeners.forEach((h) => h.onState?.(state));
  }

  private fail(message: string) {
    this.listeners.forEach((h) => h.onError?.(message));
    this.emit("error");
  }

  /** Lazily create + register the shared UA. Resolves once registered. */
  async ensureRegistered(creds: WebrtcCreds): Promise<void> {
    this.iceServers = creds.iceServers ?? [];
    const key = `${creds.wsUri}|${creds.uri}`;
    // Already registered with these creds — re-emit "registered" so callers that
    // optimistically set "connecting" don't get stuck on a stale label.
    if (this.ua && this.ua.isRegistered() && this.credsKey === key) {
      this.emit("registered");
      return;
    }
    if (this.ua && this.credsKey !== key) {
      try {
        this.ua.stop();
      } catch {
        /* ignore */
      }
      this.ua = null;
    }

    const JsSIP = await import("jssip");
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
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error("Timed out connecting your computer — check your network and try again."),
        );
      }, REGISTER_TIMEOUT_MS);
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
        clearTimeout(timer);
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

  isRegistered(): boolean {
    return !!this.ua && this.ua.isRegistered();
  }

  /** Arm so the next inbound leg (our outbound call) is auto-answered. A
   *  watchdog fires if 46elks never rings this tab (e.g. another tab/device
   *  holds the single shared registration) so the UI doesn't hang forever. */
  arm() {
    this.armed = true;
    this.clearArmTimer();
    this.armTimer = setTimeout(() => {
      if (this.armed && !this.inCall()) {
        this.armed = false;
        this.fail(
          "The call didn't reach this computer. Close any other CRM tabs or devices " +
            "(only one can take computer calls at a time), then try again.",
        );
      }
    }, ARM_TIMEOUT_MS);
  }

  private clearArmTimer() {
    if (this.armTimer) {
      clearTimeout(this.armTimer);
      this.armTimer = null;
    }
  }

  private onNewSession(e: RTCSessionEvent) {
    if ((e.originator as string) !== "remote") return;

    // Outbound: this is the agent leg of a call we just placed — auto-answer.
    if (this.armed) {
      this.armed = false;
      this.clearArmTimer();
      this.session = e.session;
      this.emit("ringing");
      this.wireSession(e.session);
      this.doAnswer(e.session);
      return;
    }

    // Inbound: a real callback ringing the browser leg. Surface for Accept if a
    // presence handler is listening; otherwise we can't take it — reject.
    if (this.incomingHandler && !this.inCall()) {
      this.session = e.session;
      this.wireSession(e.session);
      this.emit("incoming");
      this.incomingHandler({ from: extractFrom(e) });
      return;
    }

    try {
      e.session.terminate();
    } catch {
      /* ignore */
    }
  }

  private doAnswer(session: RTCSession) {
    try {
      session.answer({
        mediaConstraints: { audio: true, video: false },
        pcConfig: { rtcpMuxPolicy: "require", iceServers: this.iceServers },
      });
    } catch (err) {
      this.fail(err instanceof Error ? err.message : "Failed to answer the call");
    }
  }

  /** Accept a surfaced inbound call. */
  acceptIncoming() {
    if (this.session && !this.session.isEnded()) {
      this.emit("ringing");
      this.doAnswer(this.session);
    }
  }

  /** Decline a surfaced inbound call (the mobile leg can still answer). */
  declineIncoming() {
    if (this.session && !this.session.isEnded()) {
      try {
        this.session.terminate();
      } catch {
        /* ignore */
      }
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
      /* autoplay may need a gesture; the click that started/accepted counts */
    });
  }

  private cleanupSession(finalState: WebrtcState) {
    if (this.audioEl) this.audioEl.srcObject = null;
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
    this.clearArmTimer();
  }

  inCall(): boolean {
    return !!this.session && !this.session.isEnded();
  }
}

/** Best-effort caller number from an incoming SIP session's From header. */
function extractFrom(e: RTCSessionEvent): string | null {
  try {
    const req = e.request as unknown as {
      from?: { uri?: { user?: string }; display_name?: string };
    };
    const user = req.from?.uri?.user;
    return user ? (user.startsWith("+") ? user : `+${user}`) : null;
  } catch {
    return null;
  }
}

let singleton: WebrtcPhone | null = null;

/** The shared browser WebRTC phone (one per tab). */
export function getWebrtcPhone(): WebrtcPhone {
  if (!singleton) singleton = new WebrtcPhone();
  return singleton;
}
