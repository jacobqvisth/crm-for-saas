"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { SlideOver } from "@/components/ui/slide-over";
import { Save } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables, SequenceSettings as SequenceSettingsType } from "@/lib/database.types";

type Sequence = Tables<"sequences">;

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const TIMEZONES = [
  "Europe/Stockholm",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

interface SequenceSettingsProps {
  open: boolean;
  onClose: () => void;
  sequence: Sequence;
  onSave: () => void;
}

export function SequenceSettingsPanel({ open, onClose, sequence, onSave }: SequenceSettingsProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const settings = sequence.settings as SequenceSettingsType;

  const [sendDays, setSendDays] = useState<number[]>(settings.send_days || [1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState(settings.send_start_hour ?? 9);
  const [endHour, setEndHour] = useState(settings.send_end_hour ?? 17);
  const [timezone, setTimezone] = useState(settings.timezone || "Europe/Stockholm");
  const [dailyLimit, setDailyLimit] = useState(settings.daily_limit_per_sender ?? 80);
  const [stopOnReply, setStopOnReply] = useState(settings.stop_on_reply ?? true);
  const [stopOnCompanyReply, setStopOnCompanyReply] = useState(settings.stop_on_company_reply ?? true);
  const [senderRotation, setSenderRotation] = useState(settings.sender_rotation ?? true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = sequence.settings as SequenceSettingsType;
    setSendDays(s.send_days || [1, 2, 3, 4, 5]);
    setStartHour(s.send_start_hour ?? 9);
    setEndHour(s.send_end_hour ?? 17);
    setTimezone(s.timezone || "Europe/Stockholm");
    setDailyLimit(s.daily_limit_per_sender ?? 80);
    setStopOnReply(s.stop_on_reply ?? true);
    setStopOnCompanyReply(s.stop_on_company_reply ?? true);
    setSenderRotation(s.sender_rotation ?? true);
  }, [sequence]);

  const toggleDay = (day: number) => {
    setSendDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);

    const newSettings: SequenceSettingsType = {
      send_days: sendDays,
      send_start_hour: startHour,
      send_end_hour: endHour,
      timezone,
      daily_limit_per_sender: dailyLimit,
      stop_on_reply: stopOnReply,
      stop_on_company_reply: stopOnCompanyReply,
      sender_rotation: senderRotation,
    };

    const { error } = await supabase
      .from("sequences")
      .update({ settings: newSettings })
      .eq("id", sequence.id)
      .eq("workspace_id", workspaceId);

    if (error) {
      toast.error("Failed to save settings");
    } else {
      toast.success("Settings saved");
      onSave();
      onClose();
    }

    setSaving(false);
  };

  return (
    <SlideOver open={open} onClose={onClose} title="Sequence Settings">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Send Days</label>
          <div className="flex gap-2">
            {DAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  sendDays.includes(d.value)
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Start Hour</label>
            <select
              value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">End Hour</label>
            <select
              value={endHour}
              onChange={(e) => setEndHour(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Daily Send Limit (per sender)
          </label>
          <input
            type="number"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Number(e.target.value))}
            min={1}
            max={500}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-700">Stop Triggers</label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={stopOnReply}
              onChange={(e) => setStopOnReply(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            <span className="text-sm text-slate-700">Stop on reply</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={stopOnCompanyReply}
              onChange={(e) => setStopOnCompanyReply(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            <span className="text-sm text-slate-700">
              Pause other contacts at the same company when someone replies
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={senderRotation}
              onChange={(e) => setSenderRotation(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            <span className="text-sm text-slate-700">Rotate across all sender accounts</span>
          </label>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </SlideOver>
  );
}
