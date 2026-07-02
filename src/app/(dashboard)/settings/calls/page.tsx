"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Phone } from "lucide-react";
import toast from "react-hot-toast";

type Member = { id: string; name: string };

export default function CallSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentPhone, setAgentPhone] = useState("");
  const [callerId, setCallerId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [defaultCallerId, setDefaultCallerId] = useState<string | null>(null);
  const [failoverUserId, setFailoverUserId] = useState<string | null>(null);
  const [ringSeconds, setRingSeconds] = useState(25);
  const [voicemailEnabled, setVoicemailEnabled] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);

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
      setFailoverUserId(res.failover_user_id ?? null);
      setRingSeconds(res.ring_seconds ?? 25);
      setVoicemailEnabled(res.voicemail_enabled !== false);
      setMembers(res.members ?? []);
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
          failover_user_id: failoverUserId,
          ring_seconds: ringSeconds,
          voicemail_enabled: voicemailEnabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setAgentPhone(json.agent_phone ?? "");
      setCallerId(json.caller_id ?? "");
      setFailoverUserId(json.failover_user_id ?? null);
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
        your phone first, then connect you to them — or use the <strong>Call</strong> dropdown to
        &ldquo;Talk from computer&rdquo; and take the call in your browser with a headset. Either way the
        conversation is recorded, transcribed, and summarized by AI, and logged to the contact&apos;s
        timeline with a suggested follow-up.
      </p>
      <p className="text-xs text-slate-400 mb-8 -mt-6">
        These settings are personal to your account — each team member sets their own phone and
        caller ID, and every call is logged under whoever placed it.
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
            The number shown to the contact when <em>you</em> call. Leave blank to use the shared
            default{defaultCallerId ? ` (${defaultCallerId})` : ""}. Note: a custom number must be
            rented from or verified with 46elks first, otherwise the call is rejected — talk to an
            admin before setting your own.
          </p>
          <input
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
            placeholder={defaultCallerId ?? "+46 76 686 03 35"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Inbound: no-answer failover + voicemail */}
      <h2 className="text-base font-semibold text-slate-900 mb-1">When someone calls you back</h2>
      <p className="text-sm text-slate-500 mb-4">
        How an incoming call to your number is handled if you don&apos;t pick up. These calls are
        recorded, transcribed, and logged to the contact just like the ones you place.
      </p>

      <div className="space-y-5 mb-8">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-slate-900 mb-1">
            Ring my phone for
          </label>
          <p className="text-xs text-slate-500 mb-2">
            How long your phone rings before we move on (about 5 seconds per ring).
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={60}
              value={ringSeconds}
              onChange={(e) => setRingSeconds(Math.max(5, Math.min(60, Number(e.target.value) || 25)))}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <span className="text-sm text-slate-500">seconds (≈ {Math.round(ringSeconds / 5)} rings)</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-slate-900 mb-1">
            If I don&apos;t answer, ring
          </label>
          <p className="text-xs text-slate-500 mb-2">
            Forward the call to a teammate&apos;s phone before giving up.
          </p>
          <select
            value={failoverUserId ?? ""}
            onChange={(e) => setFailoverUserId(e.target.value || null)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
          >
            <option value="">No one — go straight to voicemail</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">Take a voicemail if nobody answers</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Plays a beep, records the caller&apos;s message, and logs it (transcribed) to the contact.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVoicemailEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              voicemailEnabled ? "bg-teal-600" : "bg-slate-200"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                voicemailEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
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
