import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  CEO_ALLOWED_EMAILS: z.string().optional(),
  SYNC_SECRET: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success && process.env.NODE_ENV !== "test") {
  console.warn("Environment validation warning", parsedEnv.error.flatten());
}

export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function hasSupabaseConfig(): boolean {
  return Boolean(
    getEnv("NEXT_PUBLIC_SUPABASE_URL") &&
      getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
      getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

export function hasSupabaseAuthConfig(): boolean {
  return Boolean(
    getEnv("NEXT_PUBLIC_SUPABASE_URL") &&
      getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

export function getAllowedEmails(): string[] {
  return (getEnv("CEO_ALLOWED_EMAILS") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// Entries starting with "@" match any email in that domain. Anything else
// must match exactly. Empty allowlist means "allow everyone" (dev mode).
export function isAllowedEmail(email?: string | null): boolean {
  const allowed = getAllowedEmails();
  if (allowed.length === 0) {
    return true;
  }

  if (!email) {
    return false;
  }

  const normalized = email.toLowerCase();
  return allowed.some((entry) =>
    entry.startsWith("@") ? normalized.endsWith(entry) : normalized === entry,
  );
}

export function getRequiredEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
