"use client";

// The one "how should this draft be written" panel, reused by every forum
// text-generation surface (post generator, Answer-posts Draft reply, thread
// replies, per-member comments). It owns the four style axes (mention level +
// length + voice + approach) and the greyed-out "run the real Wrenchlane
// diagnostics" action. Guidance text + defaults live in
// src/lib/forums/generation-options.ts so the UI and the prompts never drift.

import { AlertTriangle, Stethoscope } from "lucide-react";
import {
  APPROACH_LABEL,
  exceedsCeiling,
  LENGTH_LABEL,
  MENTION_LABEL,
  VOICE_LABEL,
  type ForumApproach,
  type ForumGenerationOptions,
  type ForumMentionLevel,
  type ForumReplyLength,
  type ForumVoice,
} from "@/lib/forums/generation-options";
import type { ForumDiagnosticsMode } from "@/lib/forums/diagnostics-api";

type Props = {
  value: ForumGenerationOptions;
  onChange: (next: ForumGenerationOptions) => void;
  // When set, warn (but still allow) if the chosen mention level is stronger
  // than the assigned account's persona is cleared to use.
  accountCeiling?: ForumMentionLevel | null;
  accountLabel?: string | null;
  className?: string;
  // Diagnostics action. Greyed out until Matteo's API is wired
  // (diagnosticsEnabled stays false); the mode picker + button are disabled.
  diagnosticsEnabled?: boolean;
  diagnosticsMode?: ForumDiagnosticsMode;
  onDiagnosticsModeChange?: (mode: ForumDiagnosticsMode) => void;
  onRunDiagnostics?: () => void;
  diagnosticsRunning?: boolean;
};

// A labelled row of pill buttons for one option axis.
function PillRow<T extends string>(props: {
  label: string;
  options: T[];
  labels: Record<T, string>;
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-xs font-medium text-slate-500">{props.label}</span>
      <div className="flex flex-wrap gap-1.5">
        {props.options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => props.onSelect(o)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              props.value === o
                ? "border-orange-400 bg-orange-50 text-orange-700"
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
            }`}
          >
            {props.labels[o]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GenerationOptions({
  value,
  onChange,
  accountCeiling,
  accountLabel,
  className,
  diagnosticsEnabled = false,
  diagnosticsMode = "ground",
  onDiagnosticsModeChange,
  onRunDiagnostics,
  diagnosticsRunning = false,
}: Props) {
  const set = (patch: Partial<ForumGenerationOptions>) => onChange({ ...value, ...patch });

  const overCeiling =
    accountCeiling != null && exceedsCeiling(value.mentionLevel, accountCeiling);

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <PillRow<ForumMentionLevel>
        label="Wrenchlane mention"
        options={["none", "subtle", "explicit"]}
        labels={MENTION_LABEL}
        value={value.mentionLevel}
        onSelect={(mentionLevel) => set({ mentionLevel })}
      />

      {overCeiling && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {accountLabel ? <span className="font-medium">{accountLabel}</span> : "This account"}{" "}
            normally doesn&apos;t use a{" "}
            <span className="font-medium">{MENTION_LABEL[value.mentionLevel].toLowerCase()}</span>.
            You can draft it anyway, just make sure it fits the persona.
          </span>
        </div>
      )}

      <PillRow<ForumReplyLength>
        label="Length"
        options={["quick", "balanced", "thorough"]}
        labels={LENGTH_LABEL}
        value={value.length}
        onSelect={(length) => set({ length })}
      />
      <PillRow<ForumVoice>
        label="Voice"
        options={["owner", "mechanic", "neutral"]}
        labels={VOICE_LABEL}
        value={value.voice}
        onSelect={(voice) => set({ voice })}
      />
      <PillRow<ForumApproach>
        label="Approach"
        options={["direct", "ask_questions", "similar_experience", "step_by_step"]}
        labels={APPROACH_LABEL}
        value={value.approach}
        onSelect={(approach) => set({ approach })}
      />

      {/* Real diagnostics action — greyed out until Matteo's API is wired. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!diagnosticsEnabled || diagnosticsRunning}
            onClick={onRunDiagnostics}
            title={
              diagnosticsEnabled
                ? "Send this problem to the real Wrenchlane diagnostics engine"
                : "Waiting for Matteo API"
            }
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              diagnosticsEnabled
                ? "border-orange-300 bg-white text-orange-700 hover:bg-orange-50"
                : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
            }`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            {diagnosticsRunning ? "Running diagnosis…" : "Run real Wrenchlane diagnostics"}
          </button>
          {!diagnosticsEnabled && (
            <span className="text-xs italic text-slate-400">Waiting for Matteo API</span>
          )}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          Sends the problem from this post to our real Wrenchlane AI diagnostics engine and uses the
          result to write the reply.
        </p>
        {/* How the diagnosis feeds the draft (Jacob: user picks). Disabled with the button. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 opacity-60">
          <span className="w-28 shrink-0 text-xs font-medium text-slate-500">Use result</span>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["ground", "Ground the draft"],
                ["verbatim", "Use diagnosis as-is"],
              ] as [ForumDiagnosticsMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                disabled={!diagnosticsEnabled}
                onClick={() => onDiagnosticsModeChange?.(mode)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  diagnosticsMode === mode
                    ? "border-orange-400 bg-orange-50 text-orange-700"
                    : "border-slate-200 bg-white text-slate-500"
                } ${diagnosticsEnabled ? "" : "cursor-not-allowed"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
