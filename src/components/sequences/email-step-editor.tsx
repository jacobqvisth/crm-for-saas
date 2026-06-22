"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Eye, EyeOff, FileText, Plus, Scissors, Sparkles, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";
import { RichEmailEditor } from "./rich-email-editor";
import { EmailPreviewFrame, previewInterpolate } from "./email-preview-frame";
import { GenerateVariantsModal } from "./generate-variants-modal";

type Step = Tables<"sequence_steps">;
type Template = Tables<"email_templates">;
type Snippet = Tables<"snippets">;
type StepVariant = Tables<"sequence_step_variants">;

type PersonaAngle = "shop_owner" | "service_advisor" | "technician";

// ---------------------------------------------------------------------------
// Snippet picker (unchanged)
// ---------------------------------------------------------------------------
interface SnippetPickerProps {
  snippets: Snippet[];
  onInsert: (body: string) => void;
}

function SnippetPicker({ snippets, onInsert }: SnippetPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (snippets.length === 0) return null;

  const grouped = snippets.reduce(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = [];
      acc[s.category].push(s);
      return acc;
    },
    {} as Record<string, Snippet[]>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
      >
        <Scissors className="w-3 h-3" />
        Snippets
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wide bg-slate-50">
                {category.replace("_", " ")}
              </p>
              {items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onInsert(s.body);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {s.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate-with-AI modal (unchanged)
// ---------------------------------------------------------------------------
interface GenerateModalProps {
  workspaceId: string;
  stepNumber: number;
  sequenceName?: string;
  onInsert: (subject: string, body: string) => void;
  onClose: () => void;
}

function GenerateModal({
  workspaceId,
  stepNumber,
  sequenceName,
  onInsert,
  onClose,
}: GenerateModalProps) {
  const [personaAngle, setPersonaAngle] = useState<PersonaAngle>("shop_owner");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(
    null
  );
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/ai/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          personaAngle,
          contactContext: {},
          stepNumber,
          sequenceName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed");
        return;
      }
      setDraft({ subject: data.subject, body: data.body });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleUse = () => {
    if (draft) onInsert(draft.subject, draft.body);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        <h3 className="text-base font-semibold text-slate-900 mb-4">
          Generate Email with AI
        </h3>

        {!draft ? (
          <>
            <div className="mb-5">
              <p className="text-sm font-medium text-slate-700 mb-2">
                Who are you emailing?
              </p>
              {(
                [
                  ["shop_owner", "Shop Owner / Manager"],
                  ["service_advisor", "Service Advisor"],
                  ["technician", "Technician / Tech Manager"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex items-center gap-2 py-1 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="personaAngle"
                    value={value}
                    checked={personaAngle === value}
                    onChange={() => setPersonaAngle(value)}
                    className="text-indigo-600"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />{" "}
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" /> Generate
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, subject: e.target.value } : d))
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Body preview
                </label>
                <div
                  className="w-full min-h-[120px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: draft.body }}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-between">
              <button
                onClick={() => {
                  setDraft(null);
                  handleGenerate();
                }}
                disabled={generating}
                className="text-sm text-slate-600 hover:text-slate-900 underline disabled:opacity-50"
              >
                {generating ? "Regenerating..." : "Regenerate"}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUse}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  Use This Draft
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmailStepEditor
// ---------------------------------------------------------------------------
interface EmailStepEditorProps {
  step: Step;
  onUpdate: (updates: Partial<Step>) => void;
  stepNumber?: number;
  sequenceName?: string;
  isFirstEmailStep?: boolean;
}

const SEQUENCE_VARIABLES = [
  "first_name",
  "last_name",
  "email",
  "company_name",
  "phone",
  "sender_first_name",
  "sender_company",
  "unsubscribe_link",
];

export function EmailStepEditor({
  step,
  onUpdate,
  stepNumber,
  sequenceName,
  isFirstEmailStep,
}: EmailStepEditorProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [subject, setSubject] = useState(step.subject_override || "");
  const [bodyHtml, setBodyHtml] = useState(step.body_override || "");
  const [includeSignature, setIncludeSignature] = useState(step.include_signature !== false);
  const [signatureHtml, setSignatureHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    step.template_id || ""
  );
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  // Variants: when this step has any rows in sequence_step_variants, the
  // engine ignores step.subject_override / body_override and picks one of the
  // active variants per contact. The editor reflects that — tabs above the
  // subject input, edits go to the active variant via PATCH.
  const [variants, setVariants] = useState<StepVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [showGenerateVariantsModal, setShowGenerateVariantsModal] = useState(false);
  const [ctaLock, setCtaLock] = useState(step.cta_lock || "");
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeVariant =
    activeVariantId !== null
      ? variants.find((v) => v.id === activeVariantId) ?? null
      : null;
  const editingVariant = activeVariant !== null;

  const fetchVariants = useCallback(async () => {
    const res = await fetch(
      `/api/sequences/${step.sequence_id}/steps/${step.id}/variants`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as { variants: StepVariant[] };
    setVariants(data.variants);
    setVariantsLoaded(true);
    return data.variants;
  }, [step.sequence_id, step.id]);

  useEffect(() => {
    if (!workspaceId) return;
    (async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name");
      setTemplates(data || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    (async () => {
      const { data } = await supabase
        .from("snippets")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name");
      setSnippets(data || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Pull the current user's signature so the preview can show body + signature
  // together — mirrors what the send engine appends (user_profiles.signature_html).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/profile");
        if (!res.ok) return;
        const data = (await res.json()) as { signature_html?: string | null };
        setSignatureHtml(data.signature_html ?? null);
      } catch {
        // Non-fatal — preview just renders without a signature.
      }
    })();
  }, []);

  // Initial variant fetch + reset when the step changes
  useEffect(() => {
    setVariantsLoaded(false);
    fetchVariants().then((vs) => {
      if (vs && vs.length > 0) {
        setActiveVariantId(vs[0].id);
      } else {
        setActiveVariantId(null);
      }
    });
  }, [fetchVariants]);

  // Sync local form state when step or active variant changes
  useEffect(() => {
    if (activeVariant) {
      setSubject(activeVariant.subject);
      setBodyHtml(activeVariant.body_html);
    } else {
      setSubject(step.subject_override || "");
      setBodyHtml(step.body_override || "");
    }
    setSelectedTemplateId(step.template_id || "");
    setIncludeSignature(step.include_signature !== false);
    setCtaLock(step.cta_lock || "");
  }, [step, activeVariant]);

  const handleCtaLockBlur = () => {
    const value = ctaLock.trim();
    onUpdate({ cta_lock: value === "" ? null : value });
  };

  const schedulePatch = useCallback(
    (variantId: string, updates: Partial<StepVariant>) => {
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(async () => {
        const res = await fetch(
          `/api/sequences/${step.sequence_id}/steps/${step.id}/variants/${variantId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          },
        );
        if (res.ok) {
          const { variant } = (await res.json()) as { variant: StepVariant };
          setVariants((prev) =>
            prev.map((v) => (v.id === variant.id ? variant : v)),
          );
        }
      }, 600);
    },
    [step.sequence_id, step.id],
  );

  const handleSignatureToggle = (checked: boolean) => {
    setIncludeSignature(checked);
    onUpdate({ include_signature: checked });
  };

  const handleTemplateSelect = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId) {
      const tpl = templates.find((t) => t.id === templateId);
      if (tpl) {
        if (editingVariant && activeVariantId) {
          setSubject(tpl.subject);
          setBodyHtml(tpl.body_html);
          schedulePatch(activeVariantId, {
            subject: tpl.subject,
            body_html: tpl.body_html,
          });
          onUpdate({ template_id: templateId });
          return;
        }
        setSubject(tpl.subject);
        setBodyHtml(tpl.body_html);
        onUpdate({
          template_id: templateId,
          subject_override: tpl.subject,
          body_override: tpl.body_html,
        });
        return;
      }
    }
    onUpdate({ template_id: templateId || null });
  };

  const handleSubjectBlur = () => {
    if (editingVariant && activeVariantId) {
      schedulePatch(activeVariantId, { subject });
    } else {
      onUpdate({ subject_override: subject });
    }
  };

  const handleBodyChange = (html: string) => {
    setBodyHtml(html);
    if (editingVariant && activeVariantId) {
      schedulePatch(activeVariantId, { body_html: html });
    } else {
      onUpdate({ body_override: html });
    }
  };

  const handleInsertSnippet = (snippetBody: string) => {
    const separator = bodyHtml.trim() ? "\n" : "";
    const newBody = bodyHtml + separator + snippetBody;
    setBodyHtml(newBody);
    if (editingVariant && activeVariantId) {
      schedulePatch(activeVariantId, { body_html: newBody });
    } else {
      onUpdate({ body_override: newBody });
    }
  };

  const handleGenerateInsert = (newSubject: string, newBody: string) => {
    setSubject(newSubject);
    setBodyHtml(newBody);
    if (editingVariant && activeVariantId) {
      schedulePatch(activeVariantId, {
        subject: newSubject,
        body_html: newBody,
      });
    } else {
      onUpdate({ subject_override: newSubject, body_override: newBody });
    }
    setShowGenerateModal(false);
  };

  const handleAddVariant = async () => {
    const res = await fetch(
      `/api/sequences/${step.sequence_id}/steps/${step.id}/variants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: "", body_html: "" }),
      },
    );
    if (!res.ok) {
      toast.error("Failed to add variant");
      return;
    }
    const data = (await res.json()) as { variants: StepVariant[] };
    setVariants(data.variants);
    const newest = data.variants[data.variants.length - 1];
    if (newest) setActiveVariantId(newest.id);
  };

  const handleRenameVariant = (name: string) => {
    if (!activeVariantId) return;
    setVariants((prev) =>
      prev.map((v) => (v.id === activeVariantId ? { ...v, name } : v)),
    );
    schedulePatch(activeVariantId, { name });
  };

  const handleWeightChange = (weight: number) => {
    if (!activeVariantId) return;
    setVariants((prev) =>
      prev.map((v) => (v.id === activeVariantId ? { ...v, weight } : v)),
    );
    schedulePatch(activeVariantId, { weight });
  };

  const handleToggleActive = (is_active: boolean) => {
    if (!activeVariantId) return;
    setVariants((prev) =>
      prev.map((v) => (v.id === activeVariantId ? { ...v, is_active } : v)),
    );
    schedulePatch(activeVariantId, { is_active });
  };

  const handleDeleteVariant = async () => {
    if (!activeVariantId) return;
    if (variants.length <= 1) {
      toast.error("Need at least one variant — disable it instead");
      return;
    }
    if (
      !confirm(
        `Delete "${activeVariant?.name ?? "this variant"}"? In-flight queue rows that already chose this variant will still send.`,
      )
    ) {
      return;
    }
    const res = await fetch(
      `/api/sequences/${step.sequence_id}/steps/${step.id}/variants/${activeVariantId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Failed to delete variant");
      return;
    }
    const next = variants.filter((v) => v.id !== activeVariantId);
    setVariants(next);
    setActiveVariantId(next[0]?.id ?? null);
  };

  return (
    <div className="space-y-3">
      {variantsLoaded && (
        <div>
          <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
            {variants.length === 0 ? (
              <span className="px-3 py-1.5 text-xs text-slate-500">
                Single message — add a variant to rotate copy across contacts
              </span>
            ) : (
              variants.map((v) => {
                const isActive = v.id === activeVariantId;
                const disabled = !v.is_active || v.weight === 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActiveVariantId(v.id)}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px whitespace-nowrap ${
                      isActive
                        ? "border-indigo-600 text-indigo-700"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    } ${disabled ? "italic opacity-60" : ""}`}
                    title={disabled ? "Disabled — won't be sent" : v.name}
                  >
                    {v.name}
                    {disabled && " (off)"}
                  </button>
                );
              })
            )}
            <button
              type="button"
              onClick={() => setShowGenerateVariantsModal(true)}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-medium"
              title="Generate multiple variants with AI"
            >
              <Sparkles className="w-3 h-3" />
              Generate variants
            </button>
            <button
              type="button"
              onClick={handleAddVariant}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded"
              title="Add an empty variant"
            >
              <Plus className="w-3 h-3" />
              Add empty
            </button>
          </div>
          {activeVariant && (
            <div className="flex flex-wrap items-center gap-3 mt-2 px-1">
              <input
                type="text"
                value={activeVariant.name}
                onChange={(e) => handleRenameVariant(e.target.value)}
                className="text-xs font-medium text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none px-0.5 min-w-0 flex-shrink"
                placeholder="Variant name"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                Weight
                <select
                  value={activeVariant.weight}
                  onChange={(e) => handleWeightChange(Number(e.target.value))}
                  className="text-xs border border-slate-300 rounded px-1 py-0.5"
                  title="Higher weight = larger share of sends"
                >
                  <option value={0}>0 (disabled)</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={activeVariant.is_active}
                  onChange={(e) => handleToggleActive(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                />
                Active
              </label>
              <span className="text-xs text-slate-400" title="Number of times this variant has been sent">
                {activeVariant.sends_count} sends
              </span>
              <button
                type="button"
                onClick={handleDeleteVariant}
                disabled={variants.length <= 1}
                className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  variants.length <= 1
                    ? "Can't delete the last variant — disable it instead"
                    : "Delete this variant"
                }
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </div>
          )}
          <div className="mt-2 px-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              CTA lock <span className="text-slate-400 font-normal">(optional — every AI-generated variant must include this phrase verbatim)</span>
            </label>
            <input
              type="text"
              value={ctaLock}
              onChange={(e) => setCtaLock(e.target.value)}
              onBlur={handleCtaLockBlur}
              placeholder='e.g. "open to a 15-min call next week?"'
              className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm"
            />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          Use Template
        </label>
        <div className="relative">
          <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <select
            value={selectedTemplateId}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-md text-sm"
          >
            <option value="">Write inline</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={handleSubjectBlur}
          placeholder="e.g. Hey {{first_name}}, quick question"
          className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm"
        />
        {isFirstEmailStep === false && (
          <p className="mt-1 text-xs text-slate-500">
            Leave blank to reply in the same Gmail thread as your first email
            (subject will auto-become{" "}
            <span className="font-mono">Re: &lt;first email subject&gt;</span>).
            Only set a subject here if you want to break out of the thread and
            start a new conversation.
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-slate-500">
            Body
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowGenerateModal(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 bg-indigo-50 rounded hover:bg-indigo-100 font-medium"
            >
              <Sparkles className="w-3 h-3" />
              Generate
            </button>
            <SnippetPicker snippets={snippets} onInsert={handleInsertSnippet} />
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
            >
              {showPreview ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              {showPreview ? "Edit" : "Preview"}
            </button>
          </div>
        </div>

        {showPreview ? (
          <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
            <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              {includeSignature && signatureHtml?.trim()
                ? "Gmail preview — sample values + your signature"
                : "Gmail preview — sample values shown"}
            </div>
            <EmailPreviewFrame
              html={
                includeSignature && signatureHtml?.trim()
                  ? `${previewInterpolate(bodyHtml)}${signatureHtml}`
                  : previewInterpolate(bodyHtml)
              }
            />
          </div>
        ) : (
          <RichEmailEditor
            value={bodyHtml}
            onChange={handleBodyChange}
            workspaceId={workspaceId ?? undefined}
            placeholder="Hi {{first_name}}, …"
            variables={SEQUENCE_VARIABLES}
          />
        )}

        <label className="mt-2 inline-flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeSignature}
            onChange={(e) => handleSignatureToggle(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            Append sender signature to this email.{" "}
            <span className="text-slate-400">
              (Each sender&apos;s signature is set in their Profile &amp; Signature settings.
              Auto-suppressed on thread replies regardless of this toggle.)
            </span>
          </span>
        </label>
      </div>

      {showGenerateModal && workspaceId && (
        <GenerateModal
          workspaceId={workspaceId}
          stepNumber={stepNumber || 1}
          sequenceName={sequenceName}
          onInsert={handleGenerateInsert}
          onClose={() => setShowGenerateModal(false)}
        />
      )}

      {showGenerateVariantsModal && workspaceId && (
        <GenerateVariantsModal
          workspaceId={workspaceId}
          sequenceId={step.sequence_id}
          stepId={step.id}
          onClose={() => setShowGenerateVariantsModal(false)}
          onSaved={(newVariants) => {
            setVariants(newVariants);
            if (!activeVariantId && newVariants.length > 0) {
              setActiveVariantId(newVariants[0].id);
            }
          }}
        />
      )}
    </div>
  );
}
