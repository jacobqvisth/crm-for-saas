"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Chrome } from "lucide-react";

type Props = {
  brandName: string;
  accent: string;
  initial: string;
  tagline: string;
  error?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  auth: "Sign-in failed. Please try again.",
  onboarding: "We couldn't finish setting up your account. Please try again.",
  not_invited:
    "That account isn't set up for access. Use your company Google Workspace account, or contact your admin.",
};

export default function LoginForm({
  brandName,
  accent,
  initial,
  tagline,
  error,
}: Props) {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleGoogleLogin = async () => {
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (signInError) {
      console.error("Login error:", signInError.message);
      setLoading(false);
    }
  };

  const errorMessage = error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4"
              style={{ backgroundColor: accent }}
            >
              <span className="text-white font-bold text-xl">{initial}</span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {brandName}
            </h1>
            <p className="text-slate-500 mt-2">{tagline}</p>
          </div>

          {errorMessage && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

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
