"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";
import type { SequenceSettings } from "@/lib/database.types";

const DEFAULT_SETTINGS: SequenceSettings = {
  send_days: [1, 2, 3, 4, 5],
  send_start_hour: 9,
  send_end_hour: 17,
  timezone: "Europe/Stockholm",
  daily_limit_per_sender: 15,
  daily_limit_total: 150,
  stop_on_reply: true,
  stop_on_company_reply: true,
  sender_rotation: true,
};

export default function NewSequencePage() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const router = useRouter();

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!workspaceId) {
      toast.error("No workspace found");
      return;
    }
    if (!name.trim()) {
      toast.error("Sequence name is required");
      return;
    }

    setCreating(true);

    const { data, error } = await supabase
      .from("sequences")
      .insert({
        workspace_id: workspaceId,
        name: name.trim(),
        status: "draft" as const,
        settings: DEFAULT_SETTINGS,
      })
      .select()
      .single();

    if (error) {
      toast.error("Failed to create sequence");
      setCreating(false);
      return;
    }

    toast.success("Sequence created");
    router.push(`/sequences/${data.id}/edit`);
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <button
        onClick={() => router.push("/sequences")}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Sequences
      </button>

      <h1 className="text-2xl font-bold text-slate-900 mb-6">Create New Sequence</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Sequence Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Welcome Onboarding, Cold Outreach"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {creating ? "Creating..." : "Create & Build Steps"}
        </button>
      </div>
    </div>
  );
}
