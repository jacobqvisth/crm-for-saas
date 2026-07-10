"use client";

import { useEffect, useState } from "react";
import { Users, Loader2 } from "lucide-react";
import { AccountsPanel } from "./accounts-panel";
import { ForumsTabs } from "./forums-tabs";
import type { RedditAccount } from "@/lib/forums/accounts";

// The Reddit accounts roster, on its own Forums tab (after "Gap log"). Pulled
// out of the Posts board so the team's handles + personas live in one place.
export function AccountsClient() {
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forums/accounts");
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load accounts");
        const data = await res.json();
        if (!cancelled) setAccounts(data.accounts ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Reddit accounts</h1>
          <p className="text-sm text-slate-500">
            The team&apos;s Reddit accounts. Posts are assigned to these and posted manually.
          </p>
        </div>
      </div>

      <ForumsTabs active="accounts" />

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
        </div>
      ) : (
        !error && (
          <AccountsPanel accounts={accounts} onChange={setAccounts} standalone />
        )
      )}
    </div>
  );
}
