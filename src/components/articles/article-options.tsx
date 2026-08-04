"use client";

// The style axes panel. Same pill-row shape as the forums generation-options
// panel, and for the same reason: labels and prompt guidance both live in
// src/lib/articles/generation-options.ts so the UI and the prompts cannot drift.

import { AlertTriangle } from "lucide-react";
import {
  ANGLE_LABEL,
  AUDIENCE_LABEL,
  BRAND_LABEL,
  CTA_LABEL,
  LANGUAGE_LABEL,
  LENGTH_LABEL,
  STRICTNESS_LABEL,
  VOICE_LABEL,
} from "@/lib/articles/generation-options";
import { getFormatSpec } from "@/lib/articles/formats";
import type {
  ArticleAngle,
  ArticleAudience,
  ArticleBrandLevel,
  ArticleCta,
  ArticleDataStrictness,
  ArticleFormat,
  ArticleGenerationOptions,
  ArticleLength,
  ArticleVoice,
} from "@/lib/articles/types";

type Props = {
  value: ArticleGenerationOptions;
  onChange: (next: ArticleGenerationOptions) => void;
  format: ArticleFormat;
};

function PillRow<T extends string>(props: {
  label: string;
  options: T[];
  labels: Record<T, string>;
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-xs font-medium text-slate-500">{props.label}</span>
      <div className="flex flex-wrap gap-1.5">
        {props.options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => props.onSelect(o)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              props.value === o
                ? "border-indigo-400 bg-indigo-50 text-indigo-700"
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

export function ArticleOptions({ value, onChange, format }: Props) {
  const set = (patch: Partial<ArticleGenerationOptions>) => onChange({ ...value, ...patch });
  const spec = getFormatSpec(format);

  return (
    <div className="space-y-3">
      <PillRow<ArticleAngle>
        label="Angle"
        options={[
          "case_study",
          "data_insight",
          "how_to",
          "myth_buster",
          "market_shift",
          "founder_pov",
          "objection_handler",
        ]}
        labels={ANGLE_LABEL}
        value={value.angle}
        onSelect={(angle) => set({ angle })}
      />
      <PillRow<ArticleAudience>
        label="Audience"
        options={["shop_owner", "technician", "dealer_fixed_ops", "distributor_partner"]}
        labels={AUDIENCE_LABEL}
        value={value.audience}
        onSelect={(audience) => set({ audience })}
      />
      <PillRow<ArticleVoice>
        label="Voice"
        options={["founder_first_person", "company_brand", "technical_expert"]}
        labels={VOICE_LABEL}
        value={value.voice}
        onSelect={(voice) => set({ voice })}
      />
      <PillRow<ArticleLength>
        label="Length"
        options={["short", "standard", "long"]}
        labels={LENGTH_LABEL}
        value={value.length}
        onSelect={(length) => set({ length })}
      />
      <PillRow<ArticleBrandLevel>
        label="Wrenchlane"
        options={["none", "subtle", "explicit"]}
        labels={BRAND_LABEL}
        value={value.brandLevel}
        onSelect={(brandLevel) => set({ brandLevel })}
      />
      <PillRow<ArticleCta>
        label="CTA"
        options={["none", "soft", "direct"]}
        labels={CTA_LABEL}
        value={value.cta}
        onSelect={(cta) => set({ cta })}
      />
      <PillRow<ArticleDataStrictness>
        label="Numbers"
        options={["strict", "illustrative"]}
        labels={STRICTNESS_LABEL}
        value={value.dataStrictness}
        onSelect={(dataStrictness) => set({ dataStrictness })}
      />
      <PillRow<string>
        label="Language"
        options={["en", "sv", "no", "da", "fi", "et", "lv", "lt"]}
        labels={LANGUAGE_LABEL}
        value={value.language}
        onSelect={(language) => set({ language })}
      />

      {value.dataStrictness === "illustrative" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The model may now use hedged estimates. They have to be visibly marked as estimates, but
            check the claims list before you post this.
          </span>
        </div>
      )}

      {spec?.wantsHashtags && (
        <label className="flex items-center gap-2 pt-1 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={value.hashtags}
            onChange={(e) => set({ hashtags: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Include hashtags
        </label>
      )}
    </div>
  );
}
