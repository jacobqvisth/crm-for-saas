"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ChevronLeft, Loader2, User as UserIcon, Code2, Eye } from "lucide-react";
import { RichEmailEditor } from "@/components/sequences/rich-email-editor";
import { useWorkspace } from "@/lib/hooks/use-workspace";

type Profile = {
  email: string | null;
  full_name: string | null;
  title: string | null;
  signature_html: string | null;
  signature_updated_at: string | null;
};

type EditorMode = "rich" | "html";

export default function ProfileSettingsPage() {
  const { workspaceId } = useWorkspace();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [signatureHtml, setSignatureHtml] = useState("");
  const [mode, setMode] = useState<EditorMode>("rich");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/profile")
      .then((r) => r.json())
      .then((data: Profile) => {
        setProfile(data);
        setFullName(data.full_name ?? "");
        setTitle(data.title ?? "");
        setSignatureHtml(data.signature_html ?? "");
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => setLoading(false));
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

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
          <h1 className="text-2xl font-bold text-slate-900">Profile & Signature</h1>
        </div>
        <p className="text-sm text-slate-500">
          Your name, title, and email signature. The signature is appended automatically to every
          sequence email sent from any of your connected Gmail accounts.
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
