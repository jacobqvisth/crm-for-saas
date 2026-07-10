// Live Wrenchlane AI diagnostics API (Matteo's endpoint).
//
// The idea: instead of only reusing historical diagnostics from the synced
// dashboard_diagnostics table, we take the problem described in a real Reddit
// post/comment, POST it to the actual Wrenchlane diagnosis engine, and get back
// a genuine ranked diagnosis. That result then either grounds the drafted reply
// or becomes the reply text directly (user picks; see ForumDiagnosticsMode).
//
// STATUS: not wired yet. Matteo has not shipped the API. Until DIAGNOSTICS_API
// env vars are set, isDiagnosticsApiConfigured() is false and the UI button is
// greyed out with "Waiting for Matteo API". runWrenchlaneDiagnostics() returns
// a not-configured result rather than throwing so callers can degrade cleanly.

export type ForumDiagnosticsMode = "ground" | "verbatim";

// The problem extracted from the source post/comment we want diagnosed.
export interface DiagnosticsProblem {
  title?: string | null;
  body?: string | null;
  subreddit?: string | null;
  // Any structured facts we already have (car, symptoms, DTCs) get passed
  // through when available so the engine has more to work with.
  car?: string | null;
  symptoms?: string[];
  dtcs?: string[];
}

// A ranked cause, mirroring the shape the app's diagnosis engine returns.
export interface DiagnosticsCause {
  name: string;
  probability: number | null;
  severity: string | null;
  description: string | null;
}

export interface DiagnosticsResult {
  summary: string | null;
  causes: DiagnosticsCause[];
  // A ready-to-post rendering of the diagnosis, used when mode = "verbatim".
  renderedText: string | null;
}

export type RunDiagnosticsResult =
  | { ok: true; result: DiagnosticsResult }
  | { ok: false; reason: string; notConfigured?: boolean };

// True once Matteo's endpoint + key are configured. Drives the greyed-out
// button server-side; the client learns it via GET /api/forums/diagnostics.
export function isDiagnosticsApiConfigured(): boolean {
  return Boolean(process.env.WRENCHLANE_DIAGNOSTICS_API_URL && process.env.WRENCHLANE_DIAGNOSTICS_API_KEY);
}

// Send a problem to the real Wrenchlane diagnostics engine.
//
// Intentionally a stub until Matteo provides the contract. The fetch shape
// below is a best guess and MUST be reconciled against the real API before
// flipping this on; for now it short-circuits when unconfigured.
export async function runWrenchlaneDiagnostics(
  problem: DiagnosticsProblem,
): Promise<RunDiagnosticsResult> {
  if (!isDiagnosticsApiConfigured()) {
    return {
      ok: false,
      notConfigured: true,
      reason: "Wrenchlane diagnostics API is not configured yet (waiting for Matteo API).",
    };
  }

  const url = process.env.WRENCHLANE_DIAGNOSTICS_API_URL as string;
  const key = process.env.WRENCHLANE_DIAGNOSTICS_API_KEY as string;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        title: problem.title ?? null,
        description: problem.body ?? null,
        car: problem.car ?? null,
        symptoms: problem.symptoms ?? [],
        dtcs: problem.dtcs ?? [],
      }),
    });
    if (!resp.ok) {
      return { ok: false, reason: `diagnostics API error: HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as Partial<DiagnosticsResult>;
    return {
      ok: true,
      result: {
        summary: data.summary ?? null,
        causes: Array.isArray(data.causes) ? data.causes : [],
        renderedText: data.renderedText ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: `diagnostics API request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
