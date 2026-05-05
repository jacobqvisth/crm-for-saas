export class SyncSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncSkippedError";
  }
}

export function requireSourceEnv(sourceLabel: string, names: string[]) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new SyncSkippedError(
      `${sourceLabel} is not configured. Missing: ${missing.join(", ")}`,
    );
  }
}
