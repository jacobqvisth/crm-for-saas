"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  POST_LOGIN_NEXT_COOKIE,
  POST_LOGIN_NEXT_MAX_AGE,
  encodeNextCookie,
  safeNextPath,
} from "@/lib/auth/next-path";
import type { TenantAuth } from "@/config/tenants/types";
import { Chrome, LogIn, Mail } from "lucide-react";

/**
 * The sign-in buttons.
 *
 * Split out of page.tsx in phase 11 so the page itself can be a server
 * component and read TENANT_SLUG. Which buttons appear is the tenant's
 * `auth` block; this component renders what it is told and nothing else.
 *
 * WRENCHLANE RENDERS EXACTLY WHAT IT RENDERED BEFORE. With
 * `{ google: true, microsoft: false, email: false }` the two falsy branches
 * emit no DOM at all, so the markup is the single Google button that was here
 * before the split. That is checked against a saved prerender of /login rather
 * than asserted (R1).
 */
export function LoginForm({ auth }: { auth: TenantAuth }) {
  // Which provider is mid-redirect, or null. A string rather than a boolean
  // because with three buttons "something is loading" is not enough to know
  // which one to put the spinner on.
  const [pending, setPending] = useState<
    "google" | "azure" | "email" | "password" | null
  >(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  /**
   * Carry the middleware's `?next=` through the OAuth round-trip in a cookie.
   *
   * NOT on redirectTo: Supabase matches redirectTo against an exact allow-list,
   * so a "?next=" query param made it fall back to the project Site URL
   * (localhost) and stranded real users on "localhost refused to connect".
   * Read from window rather than useSearchParams to keep this prerenderable.
   */
  const stashNext = () => {
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    if (next) {
      document.cookie = `${POST_LOGIN_NEXT_COOKIE}=${encodeNextCookie(next)}; Path=/; Max-Age=${POST_LOGIN_NEXT_MAX_AGE}; SameSite=Lax`;
    }
  };

  const handleOAuth = async (provider: "google" | "azure") => {
    setPending(provider);
    setError(null);
    stashNext();

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        // Must stay byte-identical to the allow-listed Redirect URL.
        redirectTo: `${window.location.origin}/auth/callback`,
        // Google wants a refresh token, which needs these two. They are
        // Google-specific: sending them to Entra is at best ignored and at
        // worst rejected, so azure gets its scopes instead.
        ...(provider === "google"
          ? { queryParams: { access_type: "offline", prompt: "consent" } }
          : { scopes: "openid profile email" }),
      },
    });
    if (error) {
      console.error("Login error:", error.message);
      setError(error.message);
      setPending(null);
    }
  };

  /**
   * Email + password. The only sign-in that works on a tenant whose Supabase
   * project has neither an OAuth provider nor custom SMTP yet: the shared
   * Supabase sender delivers magic links to project team members only, so a
   * customer address never receives one. Accounts are still admin-created
   * (sign-up is disabled on the project); this only checks a password the
   * admin has set.
   *
   * The error is deliberately the same for "no such user" and "wrong
   * password", so the form cannot be used to test whether an address has an
   * account.
   */
  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending("password");
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("Login error:", error.message);
      setError("Wrong email or password.");
      setPending(null);
      return;
    }
    // No /auth/callback round-trip here: the browser client has already
    // written the session cookies. "/" resolves to the tenant's home route on
    // the server, and a stashed deep link wins over it.
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    window.location.assign(next ?? "/");
  };

  /**
   * Magic link. This does NOT create accounts: the tenant's Supabase project
   * has sign-up disabled, and a person is authorised by Jacob creating them
   * through the admin API. An unknown address gets the same neutral
   * confirmation as a known one, because saying "no such user" here would turn
   * the login page into a way to test whether an address has an account.
   */
  const handleEmail = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setPending("email");
    setError(null);
    stashNext();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Belt and braces. Sign-up is disabled on the project as well; this
        // means a misconfigured project still cannot create an account here.
        shouldCreateUser: false,
      },
    });
    if (error) {
      console.error("Login error:", error.message);
    }
    // Deliberately shown whether or not it errored. See the note above.
    setSent(true);
    setPending(null);
  };

  return (
    <>
      {auth.google && (
        <button
          onClick={() => handleOAuth("google")}
          disabled={pending !== null}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Chrome className="w-5 h-5" />
          {pending === "google" ? "Redirecting..." : "Sign in with Google Workspace"}
        </button>
      )}

      {auth.microsoft && (
        <button
          onClick={() => handleOAuth("azure")}
          disabled={pending !== null}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 mt-3 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <MicrosoftLogo />
          {pending === "azure" ? "Redirecting..." : "Sign in with Microsoft"}
        </button>
      )}

      {auth.email && (auth.google || auth.microsoft) && (
        <div className="flex items-center gap-3 my-5">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">or</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
      )}

      {auth.email &&
        (sent ? (
          <p className="text-sm text-slate-600 text-center py-3">
            If that address has an account, a sign-in link is on its way.
          </p>
        ) : (
          <form onSubmit={handlePassword} className="space-y-3">
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={pending !== null}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-indigo-600 rounded-lg text-white font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogIn className="w-5 h-5" />
              {pending === "password" ? "Signing in..." : "Sign in"}
            </button>
            <button
              type="button"
              onClick={handleEmail}
              disabled={pending !== null || email.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Mail className="w-4 h-4" />
              {pending === "email" ? "Sending..." : "Email me a sign-in link instead"}
            </button>
          </form>
        ))}

      {error && (
        <p className="text-sm text-red-600 text-center mt-4">{error}</p>
      )}
    </>
  );
}

/** Microsoft's four squares. Inline because lucide has no Microsoft glyph. */
function MicrosoftLogo() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}
