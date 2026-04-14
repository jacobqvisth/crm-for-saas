"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useRouter } from "next/navigation";
import {
  Settings,
  Pencil,
  UserPlus,
  Check,
  X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Sequence = Tables<"sequences">;

interface SequenceStats {
  enrolled: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

export interface SendingStatus {
  gmailConnected: boolean;
  gmailEmail: string | null;
  nextSend: string | null;
  lastSent: string | null;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  active: { label: "Active", className: "bg-green-100 text-green-700" },
  paused: { label: "Paused", className: "bg-yellow-100 text-yellow-700" },
  archived: { label: "Archived", className: "bg-red-100 text-red-600" },
};

interface SequenceHeaderProps {
  sequence: Sequence;
  stats: SequenceStats;
  sendingStatus: SendingStatus | null;
  onRefresh: () => void;
  onEnrollClick: () => void;
  onSettingsClick: () => void;
}

export function SequenceHeader({
  sequence,
  stats,
  sendingStatus,
  onRefresh,
  onEnrollClick,
  onSettingsClick,
}: SequenceHeaderProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sequence.name);

  const badge = STATUS_BADGES[sequence.status] || STATUS_BADGES.draft;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  const saveName = async () => {
    if (!workspaceId || !name.trim()) return;
    const { error } = await supabase
      .from("sequences")
      .update({ name: name.trim() })
      .eq("id", sequence.id)
      .eq("workspace_id", workspaceId);

    if (error) {
      toast.error("Failed to update name");
    } else {
      toast.success("Name updated");
      onRefresh();
    }
    setEditing(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-xl font-bold text-slate-900 border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") { setEditing(false); setName(sequence.name); }
                }}
                autoFocus
              />
              <button onClick={saveName} className="p-1 rounded hover:bg-green-50 text-green-600">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => { setEditing(false); setName(sequence.name); }} className="p-1 rounded hover:bg-red-50 text-red-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{sequence.name}</h1>
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/sequences/${sequence.id}/edit`)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit Steps
          </button>
          <button
            onClick={onEnrollClick}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Contacts
          </button>
          <button
            onClick={onSettingsClick}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-4 mb-4">
        {[
          { label: "Enrolled", value: stats.enrolled },
          { label: "Sent", value: stats.sent },
          { label: "Opened", value: `${pct(stats.opened, stats.sent)}%`, sub: stats.opened },
          { label: "Clicked", value: `${pct(stats.clicked, stats.sent)}%`, sub: stats.clicked },
          { label: "Replied", value: `${pct(stats.replied, stats.sent)}%`, sub: stats.replied },
          { label: "Bounced", value: `${pct(stats.bounced, stats.sent)}%`, sub: stats.bounced },
          { label: "Unsubscribed", value: `${pct(stats.unsubscribed, stats.sent)}%`, sub: stats.unsubscribed },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-lg font-semibold text-slate-900">{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {sendingStatus && (
        <div className="flex items-center gap-1.5 pt-3 border-t border-slate-100 flex-wrap">
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${sendingStatus.gmailConnected ? "bg-green-500" : "bg-red-400"}`} />
            {sendingStatus.gmailConnected && sendingStatus.gmailEmail
              ? <>{sendingStatus.gmailEmail} connected</>
              : <>No sender connected — go to Settings → Email</>}
          </span>
          <span className="text-slate-300 text-xs">·</span>
          <span className="text-xs text-slate-500">
            {sendingStatus.nextSend
              ? <>Next send: {format(new Date(sendingStatus.nextSend), "MMM d, HH:mm")}</>
              : <>No emails queued</>}
          </span>
          <span className="text-slate-300 text-xs">·</span>
          <span className="text-xs text-slate-500">
            {sendingStatus.lastSent
              ? <>Last sent: {formatDistanceToNow(new Date(sendingStatus.lastSent), { addSuffix: true })}</>
              : <>No emails sent yet</>}
          </span>
        </div>
      )}
    </div>
  );
}
