"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Phone } from "lucide-react";
import toast from "react-hot-toast";

export default function CallSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentPhone, setAgentPhone] = useState("");
  const [callerId, setCallerId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [defaultCallerId, setDefaultCallerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch("/api/settings/calls").then((r) => r.json());
      if (cancelled) return;
      setAgentPhone(res.agent_phone ?? "");
      setCallerId(res.caller_id ?? "");
      setEnabled(res.calling_enabled !== false);
      setDefaultCallerId(res.default_caller_id ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_phone: agentPhone,
          caller_id: callerId,
          calling_enabled: enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setAgentPhone(json.agent_phone ?? "");
      setCallerId(json.caller_id ?? "");
      toast.success("Call settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <Phone className="w-5 h-5 text-teal-600" />
        <h1 className="text-2xl font-bold text-slate-900">Calling</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        Place calls directly from the CRM. When you click <strong>Call</strong> on a contact, we ring
        your phone first, then connect you to them — the conversation is recorded, transcribed, and
        summarized by AI, and logged to the contact&apos;s timeline with a suggested follow-up.
      </p>

      <div className="flex items-center justify-between py-4 border-b border-slate-200 mb-6">
        <div>
          <p className="text-sm font-medium text-slate-900">Enable in-CRM calling</p>
          <p className="text-xs text-slate-500 mt-0.5">When off, the Call buttons are disabled.</p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            enabled ? "bg-teal-600" : "bg-slate-200"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div className="space-y-5 mb-8">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-slate-900 mb-1">Your phone number</label>
          <p className="text-xs text-slate-500 mb-2">
            The number 46elks rings first. Answer it to be bridged to the contact. Swedish numbers can
            be entered as 070… and are normalized to +46.
          </p>
          <input
            value={agentPhone}
            onChange={(e) => setAgentPhone(e.target.value)}
            placeholder="+46 70 123 45 67"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-slate-900 mb-1">
            Caller ID <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <p className="text-xs text-slate-500 mb-2">
            The number shown to the contact. Leave blank to use the workspace default
            {defaultCallerId ? ` (${defaultCallerId})` : ""}.
          </p>
          <input
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
            placeholder={defaultCallerId ?? "+46 76 686 03 35"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2 px-6 rounded-lg text-sm transition-colors"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
