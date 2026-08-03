"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  POST_LOGIN_NEXT_COOKIE,
  POST_LOGIN_NEXT_MAX_AGE,
  encodeNextCookie,
  safeNextPath,
} from "@/lib/auth/next-path";
import { Chrome } from "lucide-react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleGoogleLogin = async () => {
    setLoading(true);

    // Middleware sends gated pages here as /login?next=/forums/answers. Carry
    // that through the OAuth round-trip in a cookie, NOT on redirectTo: Supabase
    // matches redirectTo against an exact allow-list entry, so a "?next=" query
    // param made it fall back to the project Site URL (localhost) and stranded
    // real users on "localhost refused to connect". Read from window rather than
    // useSearchParams to keep this page prerenderable.
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    if (next) {
      document.cookie = `${POST_LOGIN_NEXT_COOKIE}=${encodeNextCookie(next)}; Path=/; Max-Age=${POST_LOGIN_NEXT_MAX_AGE}; SameSite=Lax`;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Must stay byte-identical to the allow-listed Redirect URL.
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) {
      console.error("Login error:", error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl mb-4">
              <span className="text-white font-bold text-xl">C</span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Welcome back
            </h1>
            <p className="text-slate-500 mt-2">
              Sign in to your CRM workspace
            </p>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Chrome className="w-5 h-5" />
            {loading ? "Redirecting..." : "Sign in with Google Workspace"}
          </button>

          <p className="text-xs text-slate-400 text-center mt-6">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
