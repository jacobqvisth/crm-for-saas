/**
 * Turns a failed API response into something a person can act on.
 *
 * Client components used to pipe the server's `error` string straight into a
 * red banner, so a 401 surfaced as the single word "Unauthorized" — which says
 * nothing about what happened (the session lapsed) or what to do about it
 * (sign in again). The forums pages are where this was reported, but the
 * pattern was app-wide, so this helper is deliberately feature-agnostic.
 */

export type ApiFailureKind = "session-expired" | "not-provisioned" | "other";

export interface ApiFailure {
  kind: ApiFailureKind;
  /** User-facing sentence. Says what happened and what to do next. */
  message: string;
  /** The raw server string, kept for console/debugging — never shown alone. */
  serverError?: string;
}

export const SESSION_EXPIRED_MESSAGE =
  "You've been signed out because your session expired. Sign in again and you'll come straight back to this page.";

export const NOT_PROVISIONED_MESSAGE =
  "Your account isn't a member of a workspace yet, so this page has nothing to load. Ask Jacob to add you to the workspace, then reload.";

/**
 * Classify a failed response by status. Every forum/CRM API answers 401 with
 * "Unauthorized" when there's no session and 403 with "No workspace" when the
 * user isn't provisioned; both are states the user can resolve, so they get
 * specific copy. Anything else keeps the server's message, which is usually
 * already specific ("Couldn't start the Reddit search…").
 */
export function describeApiFailure(
  status: number,
  serverError?: string | null,
  fallback = "Something went wrong. Try again in a moment.",
): ApiFailure {
  const raw = serverError?.trim() || undefined;

  if (status === 401) {
    return { kind: "session-expired", message: SESSION_EXPIRED_MESSAGE, serverError: raw };
  }

  if (status === 403 && /no workspace/i.test(raw ?? "")) {
    return { kind: "not-provisioned", message: NOT_PROVISIONED_MESSAGE, serverError: raw };
  }

  return { kind: "other", message: raw ?? fallback, serverError: raw };
}

/**
 * Read a non-OK `Response` and describe it. Tolerates a body that isn't JSON
 * (a gateway timeout or an HTML error page), which is exactly when a raw
 * `res.json()` used to throw and mask the real status.
 */
export async function failureFromResponse(
  res: Response,
  fallback?: string,
): Promise<ApiFailure> {
  const body = await res.json().catch(() => null);
  const serverError =
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : null;
  return describeApiFailure(res.status, serverError, fallback);
}

/**
 * Carries a classified failure through a `throw`, so the existing
 * load-in-a-try/catch shape keeps working without losing the HTTP status the
 * classification depends on. Throwing a plain Error (the old pattern) flattened
 * everything to a bare string, which is how "Unauthorized" reached the UI.
 */
export class ApiFailureError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = "ApiFailureError";
    this.failure = failure;
  }
}

/**
 * Throw a classified failure if the response isn't OK. Only for responses whose
 * body hasn't been read yet — it consumes the body to find `error`.
 */
export async function throwIfFailed(res: Response, fallback?: string): Promise<void> {
  if (!res.ok) throw new ApiFailureError(await failureFromResponse(res, fallback));
}

/** Same, for a response whose JSON body has already been parsed. */
export function throwIfFailedParsed(
  res: Response,
  body: { error?: string } | null | undefined,
  fallback?: string,
): void {
  if (!res.ok) {
    throw new ApiFailureError(describeApiFailure(res.status, body?.error ?? null, fallback));
  }
}

/** Normalise anything caught in a load/save handler into a describable failure. */
export function toApiFailure(e: unknown, fallback: string): ApiFailure {
  if (e instanceof ApiFailureError) return e.failure;
  return describeApiFailure(0, e instanceof Error ? e.message : null, fallback);
}

/** True when the only way forward is signing in again. */
export function isSessionExpired(failure: ApiFailure | null | undefined): boolean {
  return failure?.kind === "session-expired";
}

/**
 * Where to send someone to recover a lapsed session, preserving the page they
 * were on so they land back here. Mirrors the middleware's `?next=` contract.
 */
export function signInHref(currentPath: string): string {
  const next = currentPath.startsWith("/") && !currentPath.startsWith("//") ? currentPath : null;
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
