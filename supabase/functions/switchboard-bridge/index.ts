// switchboard-bridge — 46elks WebSocket <-> ElevenLabs Agents WebSocket.
//
// Why this exists: connecting 46elks straight to ElevenLabs over SIP establishes
// the call but carries no RTP at all (a 32 second call recorded a 44 byte WAV,
// header only). 46elks support pointed at their WebSocket product instead, where
// the audio formats line up exactly: 46elks speaks pcm_16000 and the ElevenLabs
// Agents socket uses pcm_16000 both ways, so nothing has to be negotiated or
// resampled.
//
// Lives in an edge function rather than the Next app because Vercel functions
// cannot hold a long-lived socket. Same pattern as the demo app's
// receptionist-stream, which already streams 46elks audio successfully.
//
// Flow:
//   46elks connects and sends  {t:"hello", callid, from, to}
//     -> we look the call up, build the caller brief, open the ElevenLabs socket
//     -> ElevenLabs sends conversation_initiation_metadata
//     -> ONLY THEN we declare {t:"sending"} / {t:"listening"} to 46elks
//     -> audio relays both ways until either side hangs up
//
// That ordering is not cosmetic. 46elks support flagged it as THE cause of silent
// calls: declaring the formats before the AI session is ready loses the audio.
//
// The transfer path is untouched: the agent's transfer_call tool writes the target
// to switchboard_calls over HTTP, then calls end_call. ElevenLabs closes the
// socket, we send {t:"bye"}, the AI leg ends, and 46elks fires the `next` action
// on the original call, which rings a human.

// deno-lint-ignore-file no-explicit-any

const ELEVENLABS_API = "https://api.elevenlabs.io";
// 46elks and ElevenLabs both do 16 kHz 16-bit mono PCM, so this is a pass-through.
const AUDIO_FORMAT = "pcm_16000";

interface Hello {
  t: "hello";
  callid?: string;
  from?: string;
  to?: string;
}

function env(name: string): string | undefined {
  return Deno.env.get(name);
}

async function json(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${r.status}`);
  return await r.json();
}

/** REST helper against our own Postgres via PostgREST, using the service role. */
async function db(path: string, init?: RequestInit): Promise<any> {
  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return await json(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * The brief handed to the agent at the start of the call.
 *
 * Deliberately reuses the CRM's own initiation webhook rather than duplicating
 * the caller-matching and availability logic here, so the agent gets identical
 * context whether it is reached over the bridge or over SIP. Falls back to bare
 * defaults if that call fails: a greeting with no name beats no call at all.
 */
async function fetchBrief(
  agentId: string,
  callerId: string | null,
  calledNumber: string | null,
): Promise<{ dynamic_variables?: Record<string, string>; conversation_config_override?: any }> {
  const appUrl = env("APP_URL")?.replace(/\/$/, "");
  const token = env("CALL_AGENT_WEBHOOK_TOKEN");
  if (!appUrl || !token) return {};
  try {
    const r = await fetch(`${appUrl}/api/call-agent/initiation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-callagent-token": token },
      body: JSON.stringify({
        agent_id: agentId,
        caller_id: callerId,
        called_number: calledNumber,
      }),
    });
    if (!r.ok) return {};
    const body = await r.json();
    return {
      dynamic_variables: body.dynamic_variables,
      conversation_config_override: body.conversation_config_override,
    };
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    // 46elks only ever opens a socket; a plain GET is a health check.
    return new Response("switchboard-bridge: expects a websocket upgrade", { status: 426 });
  }

  const { socket: elks, response } = Deno.upgradeWebSocket(req);

  let ai: WebSocket | null = null;
  let aiReady = false;
  let declared = false;
  let closed = false;
  let callId: string | null = null;
  let transferPoll: number | null = null;
  // Caller audio that arrives before the AI socket is ready. Buffered rather than
  // dropped so the first thing the caller says is not lost.
  const pending: string[] = [];

  // ---- Outbound audio pacing -------------------------------------------------
  // The agent generates far faster than real time (one chunk can be ~2 seconds of
  // speech). Forwarding chunks straight through pushes all of that into 46elks'
  // playback buffer, and once it is there we cannot take it back: when the caller
  // interrupts, they keep hearing the agent for seconds.
  //
  // So we hold the audio here and feed 46elks one 20 ms frame at a time. An
  // interruption then just clears our queue, which is the difference between the
  // agent stopping now and stopping two seconds from now.
  // 100 ms per frame, not 20. The first attempt at this sent 20 ms frames every
  // 20 ms and the line audibly suffered: 50 websocket messages a second, each
  // with JSON and base64 overhead, on a timer that is not precise, is a recipe for
  // jitter. 100 ms is ten messages a second and still bounds interruption lag to
  // about a tenth of a second, which nobody hears as slow.
  //
  // Frame size must stay EVEN, or a frame boundary can land mid-sample and turn
  // 16-bit audio into static.
  const FRAME_BYTES = 3200; // 100 ms @ 16 kHz, 16-bit mono
  const FRAME_MS = 100;
  // A list of chunks with a read cursor, rather than one array that gets
  // reallocated on every append. The old version copied the whole backlog per
  // chunk, which is quadratic and stalls the very timer that has to stay regular.
  let queue: Uint8Array[] = [];
  let queueHead = 0; // read offset into queue[0]
  let queuedBytes = 0;
  let pacer: number | null = null;

  const enqueueAgentAudio = (b64: string) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    queue.push(bytes);
    queuedBytes += bytes.length;
  };

  const dropQueuedAudio = (): number => {
    const dropped = queuedBytes;
    queue = [];
    queueHead = 0;
    queuedBytes = 0;
    return dropped;
  };

  /** Pull up to `want` bytes off the queue, preserving sample alignment. */
  const takeBytes = (want: number): Uint8Array | null => {
    if (queuedBytes === 0) return null;
    const take = Math.min(want, queuedBytes);
    // Round down to a whole number of 16-bit samples.
    const aligned = take - (take % 2);
    if (aligned === 0) return null;

    const out = new Uint8Array(aligned);
    let written = 0;
    while (written < aligned) {
      const head = queue[0];
      const available = head.length - queueHead;
      const n = Math.min(available, aligned - written);
      out.set(head.subarray(queueHead, queueHead + n), written);
      written += n;
      queueHead += n;
      if (queueHead >= head.length) {
        queue.shift();
        queueHead = 0;
      }
    }
    queuedBytes -= aligned;
    return out;
  };

  const startPacer = () => {
    if (pacer !== null) return;
    pacer = setInterval(() => {
      if (closed || elks.readyState !== WebSocket.OPEN) return;
      const frame = takeBytes(FRAME_BYTES);
      if (!frame) return;
      let bin = "";
      for (let i = 0; i < frame.length; i++) bin += String.fromCharCode(frame[i]);
      elks.send(JSON.stringify({ t: "audio", data: btoa(bin) }));
    }, FRAME_MS);
  };

  /**
   * Hang up the agent leg ourselves once a transfer has been recorded.
   *
   * The agent is told to call end_call straight after transfer_call, and it does
   * not reliably do so: on a real call it said "Jag kopplar dig..." and then kept
   * talking for two minutes while the caller heard nothing useful, because the leg
   * never ended and so 46elks never fired the chained `next`.
   *
   * The transfer must not depend on the model remembering a second tool call, so
   * we watch the row the tool writes and close the leg ourselves.
   */
  const startTransferWatch = () => {
    if (transferPoll !== null || !callId) return;
    transferPoll = setInterval(async () => {
      if (closed || !callId) return;
      try {
        const rows = await db(
          `switchboard_calls?select=status&elks_call_id=eq.${encodeURIComponent(callId)}`,
        );
        if (rows?.[0]?.status === "forwarding") {
          console.log("transfer recorded; ending the agent leg so `next` can fire");
          shutdown("transfer requested");
        }
      } catch {
        // Transient failure: try again on the next tick.
      }
    }, 1500);
  };

  const shutdown = (why: string) => {
    if (closed) return;
    closed = true;
    console.log(`bridge closing: ${why}`);
    if (pacer !== null) clearInterval(pacer);
    if (transferPoll !== null) clearInterval(transferPoll);
    try {
      if (elks.readyState === WebSocket.OPEN) elks.send(JSON.stringify({ t: "bye" }));
    } catch { /* already gone */ }
    try {
      elks.close();
    } catch { /* already gone */ }
    try {
      ai?.close();
    } catch { /* already gone */ }
  };

  elks.onopen = () => console.log("46elks socket open");

  elks.onmessage = async (event) => {
    let msg: any;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }

    if (msg.t === "hello") {
      const hello = msg as Hello;
      callId = hello.callid ?? null;
      console.log(`hello callid=${hello.callid} from=${hello.from} to=${hello.to}`);

      const apiKey = env("ELEVENLABS_API_KEY");
      if (!apiKey) return shutdown("no ELEVENLABS_API_KEY");

      // Which agent answers this number.
      let agentId: string | null = null;
      try {
        const rows = await db(
          `switchboard_settings?select=provider_agent_id,enabled&bridge_number=eq.${encodeURIComponent(
            hello.to ?? "",
          )}`,
        );
        const row = rows?.[0];
        if (!row?.enabled) return shutdown("switchboard disabled or number unknown");
        agentId = row.provider_agent_id;
      } catch (err) {
        return shutdown(`settings lookup failed: ${err}`);
      }
      if (!agentId) return shutdown("no agent provisioned");

      // Record the call so the transfer tool and the `next` handler can find it.
      // Mirrors what /api/switchboard/inbound does on the SIP path.
      try {
        await db("switchboard_calls?on_conflict=elks_call_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            workspace_id: (
              await db(
                `switchboard_settings?select=workspace_id&bridge_number=eq.${encodeURIComponent(
                  hello.to ?? "",
                )}`,
              )
            )?.[0]?.workspace_id,
            elks_call_id: hello.callid,
            caller_number: hello.from ?? null,
            dialed_number: hello.to ?? null,
            status: "with_agent",
            answered_at: new Date().toISOString(),
          }),
        });
      } catch (err) {
        // Non-fatal: losing the row costs us reporting and the transfer lookup,
        // but the caller should still get to talk to someone.
        console.error("switchboard_calls upsert failed", err);
      }

      const brief = await fetchBrief(agentId, hello.from ?? null, hello.to ?? null);

      // Signed URL so a private agent can be reached without leaking the API key
      // into the socket URL.
      let signedUrl: string;
      try {
        const signed = await json(
          `${ELEVENLABS_API}/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
          { headers: { "xi-api-key": apiKey } },
        );
        signedUrl = signed.signed_url;
      } catch (err) {
        return shutdown(`signed url failed: ${err}`);
      }

      ai = new WebSocket(signedUrl);

      ai.onopen = () => {
        console.log("elevenlabs socket open");
        ai!.send(
          JSON.stringify({
            type: "conversation_initiation_client_data",
            ...(brief.dynamic_variables
              ? { dynamic_variables: brief.dynamic_variables }
              : {}),
            ...(brief.conversation_config_override
              ? { conversation_config_override: brief.conversation_config_override }
              : {}),
          }),
        );
      };

      ai.onmessage = (aiEvent) => {
        let m: any;
        try {
          m = JSON.parse(typeof aiEvent.data === "string" ? aiEvent.data : "");
        } catch {
          return;
        }

        switch (m.type) {
          case "conversation_initiation_metadata": {
            aiReady = true;
            // Record which provider conversation this call is, so the collector
            // can fetch the transcript afterwards. Without this the transcript
            // exists only at the provider and is invisible in the CRM, which is
            // how the first thirteen switchboard calls ended up with none.
            const convoId =
              m.conversation_initiation_metadata_event?.conversation_id ??
              m.conversation_id ??
              null;
            if (convoId && callId) {
              db(
                `switchboard_calls?elks_call_id=eq.${encodeURIComponent(callId)}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({ provider_conversation_id: convoId }),
                },
              ).catch((err) => console.error("could not record conversation id", err));
            }
            // THE ordering that matters: declare formats only now. 46elks support
            // identified doing this too early as the cause of silent calls.
            if (!declared && elks.readyState === WebSocket.OPEN) {
              elks.send(JSON.stringify({ t: "listening", format: AUDIO_FORMAT }));
              elks.send(JSON.stringify({ t: "sending", format: AUDIO_FORMAT }));
              declared = true;
              console.log("declared audio formats to 46elks");
            }
            // Flush whatever the caller said while we were connecting.
            for (const chunk of pending.splice(0)) {
              ai!.send(JSON.stringify({ user_audio_chunk: chunk }));
            }
            // From here on, a recorded transfer must end this leg even if the
            // agent forgets to call end_call.
            startTransferWatch();
            break;
          }
          case "audio": {
            const b64 = m.audio_event?.audio_base_64 ?? m.audio?.chunk;
            if (b64) {
              enqueueAgentAudio(b64);
              startPacer();
            }
            break;
          }
          case "ping": {
            // Keepalive: echo the id back or the socket is dropped.
            const id = m.ping_event?.event_id;
            if (id !== undefined) ai!.send(JSON.stringify({ type: "pong", event_id: id }));
            break;
          }
          case "interruption": {
            // The caller talked over the agent. Drop everything still queued so
            // they stop hearing it now rather than seconds from now. This is the
            // whole reason outbound audio is paced through us instead of pushed
            // straight into 46elks' playback buffer, which cannot be recalled.
            const dropped = dropQueuedAudio();
            if (dropped) console.log(`interruption: dropped ${dropped} queued bytes`);
            break;
          }
          case "agent_response":
          case "user_transcript":
            // Useful in logs while this is new; the authoritative transcript comes
            // from the conversation record afterwards.
            break;
        }
      };

      ai.onclose = () => shutdown("elevenlabs socket closed");
      ai.onerror = (e) => {
        console.error("elevenlabs socket error", e);
        shutdown("elevenlabs socket error");
      };
      return;
    }

    if (msg.t === "audio") {
      if (!msg.data) return;
      if (ai && aiReady && ai.readyState === WebSocket.OPEN) {
        ai.send(JSON.stringify({ user_audio_chunk: msg.data }));
      } else if (pending.length < 200) {
        // ~200 chunks is a few seconds of speech; past that, drop rather than grow
        // unboundedly on a stuck connection.
        pending.push(msg.data);
      }
      return;
    }

    if (msg.t === "bye") {
      shutdown(`46elks sent bye (${msg.reason ?? "no reason"})`);
      return;
    }
  };

  elks.onclose = () => shutdown("46elks socket closed");
  elks.onerror = (e) => {
    console.error("46elks socket error", e);
    shutdown("46elks socket error");
  };

  return response;
});
