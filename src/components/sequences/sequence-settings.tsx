"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { SlideOver } from "@/components/ui/slide-over";
import { Save } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables, SequenceSettings as SequenceSettingsType } from "@/lib/database.types";

type Sequence = Tables<"sequences">;

interface RotationAccount {
  id: string;
  email_address: string;
  display_name: string | null;
  status: string;
}

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
  const [dailyLimitTotal, setDailyLimitTotal] = useState<number | "">(
    settings.daily_limit_total && settings.daily_limit_total > 0
      ? settings.daily_limit_total
      : ""
  );
  const [stopOnReply, setStopOnReply] = useState(settings.stop_on_reply ?? true);
  const [stopOnCompanyReply, setStopOnCompanyReply] = useState(settings.stop_on_company_reply ?? true);
  const [senderRotation, setSenderRotation] = useState(settings.sender_rotation ?? true);
  const [rotationAccountIds, setRotationAccountIds] = useState<string[]>(
    settings.rotation_account_ids ?? []
  );
  const [rotationAccounts, setRotationAccounts] = useState<RotationAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = sequence.settings as SequenceSettingsType;
    setSendDays(s.send_days || [1, 2, 3, 4, 5]);
    setStartHour(s.send_start_hour ?? 9);
    setEndHour(s.send_end_hour ?? 17);
    setTimezone(s.timezone || "Europe/Stockholm");
    setDailyLimit(s.daily_limit_per_sender ?? 80);
    setDailyLimitTotal(s.daily_limit_total && s.daily_limit_total > 0 ? s.daily_limit_total : "");
    setStopOnReply(s.stop_on_reply ?? true);
    setStopOnCompanyReply(s.stop_on_company_reply ?? true);
    setSenderRotation(s.sender_rotation ?? true);
    setRotationAccountIds(s.rotation_account_ids ?? []);
  }, [sequence]);

  // Load Gmail accounts so the user can pick a per-sequence rotation pool.
  useEffect(() => {
    if (!workspaceId || !open) return;
    setAccountsLoading(true);
    fetch(`/api/gmail/accounts?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => {
        setRotationAccounts(data.accounts || []);
        setAccountsLoading(false);
      })
      .catch(() => setAccountsLoading(false));
  }, [workspaceId, open]);

  const toggleRotationAccount = (id: string) => {
    setRotationAccountIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const selectAllRotationAccounts = () => {
    setRotationAccountIds(rotationAccounts.map((a) => a.id));
  };

  const deselectAllRotationAccounts = () => {
    setRotationAccountIds([]);
  };

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
      // Store only when a non-empty subset is picked. Empty array = "all active",
      // which is also the default when undefined — keep the JSON tidy.
      ...(rotationAccountIds.length > 0
        ? { rotation_account_ids: rotationAccountIds }
        : {}),
      // Same pattern: omit when blank/0 ⇒ "no total cap".
      ...(typeof dailyLimitTotal === "number" && dailyLimitTotal > 0
        ? { daily_limit_total: dailyLimitTotal }
        : {}),
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Daily limit per sender
            </label>
            <p className="text-xs text-slate-500 mb-1.5">
              Max emails this sequence sends from any single sender per day.
            </p>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value))}
              min={1}
              max={500}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Daily total (across all senders)
            </label>
            <p className="text-xs text-slate-500 mb-1.5">
              Hard cap on this sequence&apos;s total daily output. Blank = no cap.
            </p>
            <input
              type="number"
              value={dailyLimitTotal}
              onChange={(e) => {
                const v = e.target.value;
                setDailyLimitTotal(v === "" ? "" : Math.max(0, Number(v)));
              }}
              min={0}
              max={5000}
              placeholder="e.g. 200"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-700">
              Auto-rotate pool
            </label>
            {rotationAccounts.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={selectAllRotationAccounts}
                  className="text-indigo-600 hover:text-indigo-700"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={deselectAllRotationAccounts}
                  className="text-slate-500 hover:text-slate-700"
                >
                  Deselect all
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">
            When &quot;Auto-rotate across all accounts&quot; is selected at enrollment, emails for this sequence rotate only through the accounts checked here. Leave all unchecked to rotate across every active account in the workspace.
          </p>
          {accountsLoading ? (
            <div className="text-sm text-slate-500 py-2">Loading accounts…</div>
          ) : rotationAccounts.length === 0 ? (
            <div className="text-sm text-slate-500 py-2">No Gmail accounts connected.</div>
          ) : (
            <div className="space-y-1.5 border border-slate-200 rounded-lg p-2 max-h-52 overflow-y-auto">
              {rotationAccounts.map((account) => (
                <label
                  key={account.id}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={rotationAccountIds.includes(account.id)}
                    onChange={() => toggleRotationAccount(account.id)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span className="text-sm text-slate-700">
                    {account.email_address}
                    {account.status !== "active" && (
                      <span className="ml-1 text-xs text-slate-400">({account.status})</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
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
