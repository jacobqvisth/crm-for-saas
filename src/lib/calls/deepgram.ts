// Deepgram batch transcription for recorded calls. Ported from
// result-insurance's _shared/deepgram.ts, adapted to send audio bytes directly
// (binary mode) rather than a URL — 46elks recording URLs need Basic Auth,
// which Deepgram's URL mode can't supply, so we fetch the audio ourselves and
// POST the buffer.

export interface CallUtterance {
  /** "agent" for Deepgram speaker 0, "contact" for the others. Diarization on
   *  a 2-party bridge is approximate but good enough for a readable transcript. */
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface TranscribeOptions {
  apiKey?: string;
  model?: string;
  /** Contact/locale hint (2-letter, e.g. "sv"). Used to pick the Deepgram
   *  language when supported; otherwise we fall back to auto-detection. */
  language?: string;
  timeoutMs?: number;
}

// Deepgram nova-2 language codes we trust to pin explicitly. Our contact
// `language` field uses 2-letter locales (sv, da, no, fi, de, en, …); map them
// to Deepgram's codes. Anything not listed (et/lv/lt and unknowns) falls back
// to detect_language so we never force the wrong model onto the audio — that
// mismatch is exactly what produced garbled "Swedish/Dutch/English" transcripts
// when we previously forced nova-3 `multi` (which doesn't support Swedish).
const DEEPGRAM_LANG: Record<string, string> = {
  sv: "sv",
  da: "da",
  no: "no",
  nb: "no",
  nn: "no",
  fi: "fi",
  en: "en",
  de: "de",
  nl: "nl",
  fr: "fr",
  es: "es",
  it: "it",
  pt: "pt",
};

/**
 * Transcribe audio bytes with Deepgram and return diarized utterances ordered
 * by start time. Returns [] for silence-only / unrecognized audio. Throws on
 * HTTP error or timeout.
 *
 * Uses nova-2 (Deepgram's broadest language coverage). When the caller passes a
 * supported `language` hint we pin it (most accurate); otherwise we enable
 * automatic language detection so any supported language transcribes correctly.
 */
export async function transcribeAudio(
  audio: ArrayBuffer,
  contentType: string,
  opts: TranscribeOptions = {},
): Promise<CallUtterance[]> {
  const apiKey = opts.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY missing");

  const params = new URLSearchParams({
    model: opts.model ?? "nova-2",
    punctuate: "true",
    smart_format: "true",
    diarize: "true",
    utterances: "true",
  });

  const hint = opts.language?.slice(0, 2).toLowerCase();
  const pinned = hint ? DEEPGRAM_LANG[hint] : undefined;
  if (pinned) {
    params.set("language", pinned);
  } else {
    // Auto-detect the spoken language for this recording.
    params.set("detect_language", "true");
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 120_000);
  try {
    const resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body: audio,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "(unreadable)");
      throw new Error(`Deepgram HTTP ${resp.status}: ${body}`);
    }

    const json = (await resp.json()) as {
      results?: {
        utterances?: Array<{
          speaker?: number;
          transcript?: string;
          start?: number;
          end?: number;
        }>;
      };
    };

    const raw = json?.results?.utterances ?? [];
    return raw
      .map((u) => ({
        speaker: u.speaker === 0 ? "agent" : "contact",
        text: (u.transcript ?? "").trim(),
        start_ms: Math.round((u.start ?? 0) * 1000),
        end_ms: Math.round((u.end ?? 0) * 1000),
      }))
      .filter((u) => u.text.length > 0)
      .sort((a, b) => a.start_ms - b.start_ms);
  } finally {
    clearTimeout(timer);
  }
}

/** Render utterances into a readable "[Agent 0:12] …" transcript string. */
export function formatTranscript(utterances: CallUtterance[]): string {
  const label: Record<string, string> = { agent: "Agent", contact: "Contact" };
  return utterances
    .map((u) => {
      const mm = Math.floor(u.start_ms / 60000);
      const ss = Math.floor((u.start_ms % 60000) / 1000)
        .toString()
        .padStart(2, "0");
      return `[${label[u.speaker] ?? u.speaker} ${mm}:${ss}] ${u.text}`;
    })
    .join("\n");
}
