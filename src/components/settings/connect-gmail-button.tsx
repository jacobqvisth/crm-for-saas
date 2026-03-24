"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

export function ConnectGmailButton() {
  const [loading, setLoading] = useState(false);

  function handleConnect() {
    setLoading(true);
    // Redirect to the Gmail OAuth connect endpoint
    window.location.href = "/api/auth/gmail/connect";
  }

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
    >
      <Plus className="h-4 w-4" />
      {loading ? "Connecting..." : "Connect Gmail Account"}
    </button>
  );
}
