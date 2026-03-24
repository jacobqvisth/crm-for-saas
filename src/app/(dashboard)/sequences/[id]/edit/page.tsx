"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { SequenceBuilder } from "@/components/sequences/sequence-builder";
import { SequenceSettingsPanel } from "@/components/sequences/sequence-settings";
import { ArrowLeft, Settings } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Sequence = Tables<"sequences">;

export default function SequenceEditPage() {
  const params = useParams();
  const sequenceId = params.id as string;
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const router = useRouter();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    (async () => {
      const { data, error } = await supabase
        .from("sequences")
        .select("*")
        .eq("id", sequenceId)
        .eq("workspace_id", workspaceId)
        .single();

      if (error || !data) {
        toast.error("Sequence not found");
        router.push("/sequences");
        return;
      }
      setSequence(data);
      setLoading(false);
    })();
  }, [workspaceId, sequenceId, supabase, router]);

  if (loading || !sequence) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/sequences/${sequenceId}`)}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-xl font-bold text-slate-900">
            Edit: {sequence.name}
          </h1>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>

      <SequenceBuilder sequenceId={sequenceId} />

      <SequenceSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sequence={sequence}
        onSave={() => {
          (async () => {
            const { data } = await supabase
              .from("sequences")
              .select("*")
              .eq("id", sequenceId)
              .single();
            if (data) setSequence(data);
          })();
        }}
      />
    </div>
  );
}
