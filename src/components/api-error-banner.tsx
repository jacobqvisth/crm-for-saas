"use client";

import { usePathname } from "next/navigation";
import { AlertTriangle, LogIn, RefreshCw } from "lucide-react";
import {
  isSessionExpired,
  signInHref,
  type ApiFailure,
} from "@/lib/auth/api-error";

interface ApiErrorBannerProps {
  failure: ApiFailure | null;
  /** Optional retry for transient failures. Hidden on auth failures, where
      retrying the same request would just fail the same way. */
  onRetry?: () => void;
  className?: string;
}

/**
 * The one place an API failure gets rendered. Shows plain-language copy plus
 * the action that actually resolves it — a sign-in link carrying `?next=` for a
 * lapsed session, a retry for anything transient — instead of the bare
 * "Unauthorized" that sent people asking why forums was broken.
 */
export function ApiErrorBanner({ failure, onRetry, className }: ApiErrorBannerProps) {
  const pathname = usePathname();
  if (!failure) return null;

  const expired = isSessionExpired(failure);

  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 ${className ?? ""}`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-[16rem]">{failure.message}</span>

      {expired ? (
        <a
          href={signInHref(pathname)}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-red-700"
        >
          <LogIn className="h-3.5 w-3.5" /> Sign in again
        </a>
      ) : (
        onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 transition-colors hover:bg-red-100"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        )
      )}
    </div>
  );
}
