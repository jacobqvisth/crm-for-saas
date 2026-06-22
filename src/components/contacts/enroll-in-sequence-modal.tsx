"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Modal } from "@/components/ui/modal";
import { Loader2, ListOrdered } from "lucide-react";
import toast from "react-hot-toast";
import { SenderAccountSelector } from "@/components/gmail/sender-account-selector";

interface Sequence {
  id: string;
  name: string;
  status: string | null;
}

interface EnrollInSequenceModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactEmail: string;
  onEnrolled?: () => void;
}

export function EnrollInSequenceModal({
  open,
  onClose,
  contactId,
  contactEmail,
  onEnrolled,
}: EnrollInSequenceModalProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [senderAccountId, setSenderAccountId] = useState<string | null>(null);
  const [allowCustomers, setAllowCustomers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;

    setLoading(true);
    setSelectedId(null);
    setAllowCustomers(false);

    (async () => {
      const { data } = await supabase
        .from("sequences")
        .select("id, name, status")
        .eq("workspace_id", workspaceId)
        .in("status", ["active", "draft"])
        .order("name");

      setSequences(data || []);
      setLoading(false);
    })();
  }, [open, workspaceId, supabase]);

  const handleEnroll = async () => {
    if (!workspaceId || !selectedId) return;

    setEnrolling(true);

    const res = await fetch("/api/sequences/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceId: selectedId,
        contactIds: [contactId],
        workspaceId,
        senderAccountId,
        allowCustomers,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      if (result.code === "NO_SENDER") {
        toast.error(result.error, { duration: 6000 });
      } else {
        toast.error(result.error || "Enrollment failed");
      }
      setEnrolling(false);
      return;
    }

    // HTTP 200 does NOT mean the contact was enrolled — enrollContacts can
    // silently skip (already enrolled, unsubscribed, customer/app-user, etc).
    // Reflect the real outcome instead of always claiming success.
    if (result.enrolled > 0) {
      toast.success("Enrolled in sequence");
      onEnrolled?.();
      onClose();
    } else {
      const reason = result.reasons?.[0]?.split(": ").slice(1).join(": ");
      if (result.skippedCustomer > 0 && !allowCustomers) {
        toast.error(
          "This contact is an existing customer / app user. Tick “Enroll customers anyway” below to include them.",
          { duration: 7000 }
        );
        setAllowCustomers(true);
      } else {
        toast.error(reason ? `Not enrolled — ${reason}` : "Contact was not enrolled");
      }
    }

    setEnrolling(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to Sequence"
      maxWidth="max-w-sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Select a sequence to enroll <strong>{contactEmail}</strong> into.
        </p>

        <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : sequences.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-slate-500">
              <ListOrdered className="w-5 h-5 text-slate-300" />
              <span>No sequences found</span>
            </div>
          ) : (
            sequences.map((seq) => (
              <label
                key={seq.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
              >
                <input
                  type="radio"
                  name="sequence"
                  checked={selectedId === seq.id}
                  onChange={() => setSelectedId(seq.id)}
                  className="border-slate-300 text-indigo-600"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-900">{seq.name}</span>
                  {seq.status === "draft" && (
                    <span className="ml-2 text-xs text-amber-600 font-medium">(Draft)</span>
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        {workspaceId && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Sender account
            </label>
            <SenderAccountSelector
              workspaceId={workspaceId}
              value={senderAccountId}
              onChange={setSenderAccountId}
              showCapacity={true}
            />
          </div>
        )}

        <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-600">
          <input
            type="checkbox"
            checked={allowCustomers}
            onChange={(e) => setAllowCustomers(e.target.checked)}
            className="mt-0.5 border-slate-300 text-indigo-600 rounded"
          />
          <span>
            Enroll customers anyway
            <span className="block text-xs text-slate-400">
              By default, existing app users / customer workshops are skipped (and
              their emails cancelled at send time). Tick this to mark the sequence
              as a customer follow-up so the email actually sends — e.g. a
              post-call “thanks for the conversation” message.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleEnroll}
            disabled={enrolling || !selectedId}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {enrolling && <Loader2 className="w-4 h-4 animate-spin" />}
            {enrolling ? "Enrolling..." : "Enroll"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
