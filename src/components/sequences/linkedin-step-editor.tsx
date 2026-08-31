"use client";

import { useState, useEffect } from "react";
import { INVITE_NOTE_MAX_CHARS } from "@/lib/sequences/linkedin";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

interface LinkedInStepEditorProps {
  step: Step;
  onUpdate: (updates: Partial<Step>) => void;
}

/**
 * Editor for the two LinkedIn steps: `linkedin_invite` (a connection request,
 * with an optional note) and `linkedin_message` (a message to someone who is
 * already a connection).
 *
 * Neither sends anything. Both create a task for a rep, with the message text
 * and a link to the person, and the sequence carries on without waiting.
 */
export function LinkedInStepEditor({ step, onUpdate }: LinkedInStepEditorProps) {
  const isInvite = step.type === "linkedin_invite";
  const [body, setBody] = useState(step.linkedin_body || "");
  const [title, setTitle] = useState(step.task_title || "");
  const [description, setDescription] = useState(step.task_description || "");
  const [dueDays, setDueDays] = useState(step.task_due_days ?? 0);
  const [priority, setPriority] = useState(step.task_priority || "medium");

  useEffect(() => {
    setBody(step.linkedin_body || "");
    setTitle(step.task_title || "");
    setDescription(step.task_description || "");
    setDueDays(step.task_due_days ?? 0);
    setPriority(step.task_priority || "medium");
  }, [step]);

  // Counted against the raw text, which is what LinkedIn truncates. Variables
  // are not expanded here, so a note near the limit can still overflow once
  // {{first_name}} becomes a real name — hence the warning rather than a hard
  // block at exactly 300.
  const over = isInvite && body.length > INVITE_NOTE_MAX_CHARS;
  const near = isInvite && !over && body.length > INVITE_NOTE_MAX_CHARS - 40;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {isInvite
          ? "Creates a task to send a connection request. Nothing is sent automatically — LinkedIn has no API for it, and automating it puts the sender's account at risk."
          : "Creates a task to message this contact on LinkedIn. Use it after a connection request has been accepted."}
      </p>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          {isInvite ? "Connection note" : "Message"}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => onUpdate({ linkedin_body: body.trim() || null })}
          rows={isInvite ? 3 : 5}
          placeholder={
            isInvite
              ? "Hi {{first_name}}, I work with companies like {{company_name}} on..."
              : "Thanks for connecting, {{first_name}}. The reason I reached out..."
          }
          className={`w-full px-3 py-2 border rounded-md text-sm ${
            over ? "border-red-400" : "border-slate-300"
          }`}
        />
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-xs text-slate-400">
            Variables like <code className="text-slate-500">{"{{first_name}}"}</code> and{" "}
            <code className="text-slate-500">{"{{company_name}}"}</code> work here.
          </p>
          {isInvite && (
            <span
              className={`shrink-0 text-xs tabular-nums ${
                over ? "text-red-600 font-medium" : near ? "text-amber-600" : "text-slate-400"
              }`}
            >
              {body.length} / {INVITE_NOTE_MAX_CHARS}
            </span>
          )}
        </div>
        {over && (
          <p className="mt-1 text-xs text-red-600">
            LinkedIn cuts a connection note off at {INVITE_NOTE_MAX_CHARS} characters. Shorten it,
            or the end will not arrive.
          </p>
        )}
        {near && (
          <p className="mt-1 text-xs text-amber-600">
            Close to the {INVITE_NOTE_MAX_CHARS}-character limit. Variables expand at send time, so
            a long company name can still push it over.
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Task title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onUpdate({ task_title: title.trim() || null })}
          placeholder={
            isInvite ? "e.g. LinkedIn invite: {{first_name}}" : "e.g. LinkedIn follow-up: {{first_name}}"
          }
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">Leave blank for an auto-generated title.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          Notes for the rep (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => onUpdate({ task_description: description.trim() || null })}
          rows={2}
          placeholder="Context that helps, but is not part of the message."
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
        />
      </div>

      <div className="flex items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Due in (days)</label>
          <input
            type="number"
            value={dueDays}
            onChange={(e) => setDueDays(Math.max(0, Number(e.target.value)))}
            onBlur={() => onUpdate({ task_due_days: dueDays })}
            min={0}
            className="w-24 px-2 py-1.5 border border-slate-300 rounded-md text-sm text-center"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              onUpdate({ task_priority: e.target.value });
            }}
            className="px-2 py-1.5 border border-slate-300 rounded-md text-sm"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
        LinkedIn allows about 100 connection requests a week per account, whatever the
        subscription. Keep a sequence that leans on invites to a list one rep can work through,
        and expect roughly 20 a day rather than a mailing.
      </p>
    </div>
  );
}
