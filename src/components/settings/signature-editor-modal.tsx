"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface SignatureEditorModalProps {
  userId: string;
  userLabel: string;
  mailboxCount: number;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function SignatureEditorModal({
  userId,
  userLabel,
  mailboxCount,
  open,
  onClose,
  onSaved,
}: SignatureEditorModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signature, setSignature] = useState("");
  const [originalSignature, setOriginalSignature] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/signatures/${userId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        if (cancelled) return;
        const sig = (data.signature_html as string | null) ?? "";
        setSignature(sig);
        setOriginalSignature(sig);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load signature");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/signatures/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature_html: signature || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to save signature");
        return;
      }
      toast.success("Signature saved");
      setOriginalSignature(signature);
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const dirty = signature !== originalSignature;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Edit signature — {userLabel}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {mailboxCount > 1
                ? `Applies to all ${mailboxCount} connected mailboxes for this sender.`
                : "Applied to outgoing sequence emails from this sender."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Signature HTML
                </label>
                <textarea
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  placeholder={`<p>Best,<br>Jacob</p>\n<p style="color:#666;font-size:12px;">Wrenchlane · jacob@wrenchlane.com</p>`}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  HTML is rendered in the email body. Leave empty to remove the signature.
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 mb-1.5">Preview</p>
                <div className="min-h-[80px] rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                  {signature.trim() ? (
                    <div dangerouslySetInnerHTML={{ __html: signature }} />
                  ) : (
                    <span className="text-slate-400">No signature.</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !dirty}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save signature"}
          </button>
        </div>
      </div>
    </div>
  );
}
