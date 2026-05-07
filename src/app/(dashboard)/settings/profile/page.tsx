"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ChevronLeft,
  Loader2,
  User as UserIcon,
  Code2,
  Eye,
  MapPin,
  CalendarOff,
  Plus,
  X,
} from "lucide-react";
import { RichEmailEditor } from "@/components/sequences/rich-email-editor";
import { useWorkspace } from "@/lib/hooks/use-workspace";

type WorkingDays = {
  mon: boolean;
  tue: boolean;
  wed: boolean;
  thu: boolean;
  fri: boolean;
  sat: boolean;
  sun: boolean;
};

const DEFAULT_WORKING_DAYS: WorkingDays = {
  mon: true,
  tue: true,
  wed: true,
  thu: true,
  fri: true,
  sat: false,
  sun: false,
};

const DAYS: { key: keyof WorkingDays; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

type Profile = {
  email: string | null;
  full_name: string | null;
  title: string | null;
  signature_html: string | null;
  signature_updated_at: string | null;
  origin_address: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
  origin_geocoded_at: string | null;
  working_days: WorkingDays;
};

type UnavailableEntry = {
  id: string;
  date: string;
  reason: string | null;
};

type EditorMode = "rich" | "html";

export default function ProfileSettingsPage() {
  const { workspaceId } = useWorkspace();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [signatureHtml, setSignatureHtml] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [workingDays, setWorkingDays] = useState<WorkingDays>(DEFAULT_WORKING_DAYS);
  const [mode, setMode] = useState<EditorMode>("rich");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [pto, setPto] = useState<UnavailableEntry[]>([]);
  const [ptoDate, setPtoDate] = useState("");
  const [ptoReason, setPtoReason] = useState("");
  const [ptoSubmitting, setPtoSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/settings/profile").then((r) => r.json()),
      fetch("/api/settings/profile/unavailable-dates").then((r) => r.json()),
    ])
      .then(([p, u]: [Profile, { entries?: UnavailableEntry[] }]) => {
        if (cancelled) return;
        setProfile(p);
        setFullName(p.full_name ?? "");
        setTitle(p.title ?? "");
        setSignatureHtml(p.signature_html ?? "");
        setOriginAddress(p.origin_address ?? "");
        setWorkingDays(p.working_days ?? DEFAULT_WORKING_DAYS);
        setPto((u.entries ?? []).filter((e) => e.date >= todayIso()));
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim() || null,
          title: title.trim() || null,
          signature_html: signatureHtml.trim() || null,
          origin_address: originAddress.trim() || null,
          working_days: workingDays,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      if (data.geocode_note) toast(data.geocode_note);
      toast.success("Profile saved");
      // Refresh origin info from server (for geocoded_at + lat/lng).
      setProfile((p) =>
        p
          ? {
              ...p,
              origin_address: data.origin_address ?? null,
              origin_latitude: data.origin_latitude ?? null,
              origin_longitude: data.origin_longitude ?? null,
              origin_geocoded_at: data.origin_geocoded_at ?? null,
              working_days: data.working_days ?? p.working_days,
            }
          : p,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  async function addPto() {
    if (!ptoDate) {
      toast.error("Pick a date");
      return;
    }
    setPtoSubmitting(true);
    try {
      const res = await fetch("/api/settings/profile/unavailable-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: ptoDate, reason: ptoReason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const entry = data.entry as UnavailableEntry;
      setPto((p) => [...p.filter((e) => e.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date)));
      setPtoDate("");
      setPtoReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPtoSubmitting(false);
    }
  }

  async function removePto(entry: UnavailableEntry) {
    const res = await fetch(`/api/settings/profile/unavailable-dates?id=${entry.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to remove");
      return;
    }
    setPto((p) => p.filter((e) => e.id !== entry.id));
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-3"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back to settings
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <UserIcon className="w-5 h-5 text-slate-500" />
          <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        </div>
        <p className="text-sm text-slate-500">
          Identity, signature, and field-route settings (origin, working days, PTO).
        </p>
      </div>

      {profile?.email && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-600">
          Signed in as <span className="font-medium text-slate-900">{profile.email}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jacob Qvisth"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Founder, Wrenchlane"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900">Field-route origin</h2>
        </div>
        <p className="text-xs text-slate-500">
          The address each generated route starts and ends at. Geocoded on save.
        </p>
        <textarea
          value={originAddress}
          onChange={(e) => setOriginAddress(e.target.value)}
          rows={2}
          placeholder="Markvägen 23, 162 71 Vällingby"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        />
        {profile?.origin_latitude != null && profile?.origin_longitude != null && (
          <p className="text-xs text-slate-500">
            Geocoded as{" "}
            <span className="font-mono text-slate-700">
              {profile.origin_latitude.toFixed(5)}, {profile.origin_longitude.toFixed(5)}
            </span>
            {profile.origin_geocoded_at && (
              <>
                {" "}
                · verified {new Date(profile.origin_geocoded_at).toLocaleString()}
              </>
            )}
          </p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarOff className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900">Working calendar</h2>
        </div>
        <p className="text-xs text-slate-500">
          Days you accept routes. Off-days cannot be picked from the route schedule date picker.
        </p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() =>
                setWorkingDays((w) => ({ ...w, [d.key]: !w[d.key] }))
              }
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                workingDays[d.key]
                  ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="pt-3 border-t border-slate-100 space-y-2">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            PTO / unavailable dates
          </h3>
          {pto.length === 0 ? (
            <p className="text-xs text-slate-400">No upcoming unavailable dates.</p>
          ) : (
            <ul className="space-y-1">
              {pto.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between text-sm bg-slate-50 px-3 py-1.5 rounded"
                >
                  <span>
                    <span className="font-medium text-slate-700">{e.date}</span>
                    {e.reason && (
                      <span className="text-slate-500 ml-2">— {e.reason}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePto(e)}
                    className="text-slate-400 hover:text-red-600"
                    aria-label={`Remove ${e.date}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <input
              type="date"
              value={ptoDate}
              onChange={(e) => setPtoDate(e.target.value)}
              min={todayIso()}
              className="px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              type="text"
              value={ptoReason}
              onChange={(e) => setPtoReason(e.target.value)}
              placeholder="Reason (optional)"
              maxLength={200}
              className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              type="button"
              onClick={addPto}
              disabled={ptoSubmitting || !ptoDate}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Email signature</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Appended to outgoing sequence emails. Auto-suppressed on thread replies so it doesn&apos;t
              stack.
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("rich")}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                mode === "rich"
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Eye className="w-3 h-3" />
              Rich
            </button>
            <button
              type="button"
              onClick={() => setMode("html")}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                mode === "html"
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Code2 className="w-3 h-3" />
              HTML
            </button>
          </div>
        </div>

        {mode === "rich" ? (
          <RichEmailEditor
            value={signatureHtml}
            onChange={setSignatureHtml}
            workspaceId={workspaceId ?? undefined}
            placeholder="Best,&#10;Jacob Qvisth&#10;Founder, Wrenchlane"
            variables={[]}
          />
        ) : (
          <div className="space-y-2">
            <textarea
              value={signatureHtml}
              onChange={(e) => setSignatureHtml(e.target.value)}
              rows={10}
              placeholder='<p>Best,</p>&#10;<p><strong>Jacob Qvisth</strong><br>Founder, Wrenchlane</p>'
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1">Live preview</p>
              <div
                className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-sm text-slate-800 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: signatureHtml || "<em>(empty)</em>" }}
              />
            </div>
          </div>
        )}

        {profile?.signature_updated_at && (
          <p className="text-xs text-slate-400">
            Last updated {new Date(profile.signature_updated_at).toLocaleString()}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save profile
        </button>
      </div>
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
