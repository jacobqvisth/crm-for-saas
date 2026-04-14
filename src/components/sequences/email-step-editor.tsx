"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { VariablePicker } from "./variable-picker";
import { Eye, EyeOff, FileText, Scissors, Sparkles } from "lucide-react";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;
type Template = Tables<"email_templates">;
type Snippet = Tables<"snippets">;

type PersonaAngle = "shop_owner" | "service_advisor" | "technician";

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
                  Body (HTML)
                </label>
                <textarea
                  value={draft.body}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, body: e.target.value } : d))
                  }
                  rows={8}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-mono"
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

interface EmailStepEditorProps {
  step: Step;
  onUpdate: (updates: Partial<Step>) => void;
  stepNumber?: number;
  sequenceName?: string;
  isFirstEmailStep?: boolean;
}

export function EmailStepEditor({
  step,
  onUpdate,
  stepNumber,
  sequenceName,
  isFirstEmailStep,
}: EmailStepEditorProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [subject, setSubject] = useState(step.subject_override || "");
  const [bodyHtml, setBodyHtml] = useState(step.body_override || "");
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    step.template_id || ""
  );
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

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

  useEffect(() => {
    setSubject(step.subject_override || "");
    setBodyHtml(step.body_override || "");
    setSelectedTemplateId(step.template_id || "");
  }, [step]);

  const handleTemplateSelect = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId) {
      const tpl = templates.find((t) => t.id === templateId);
      if (tpl) {
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
    onUpdate({ subject_override: subject });
  };

  const handleBodyBlur = () => {
    onUpdate({ body_override: bodyHtml });
  };

  const handleInsertVariable = (variable: string) => {
    if (bodyRef.current) {
      const textarea = bodyRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = bodyHtml.slice(0, start) + variable + bodyHtml.slice(end);
      setBodyHtml(newValue);
      onUpdate({ body_override: newValue });
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + variable.length,
          start + variable.length
        );
      }, 0);
    }
  };

  const handleInsertSnippet = (snippetBody: string) => {
    if (bodyRef.current) {
      const textarea = bodyRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue =
        bodyHtml.slice(0, start) + snippetBody + bodyHtml.slice(end);
      setBodyHtml(newValue);
      onUpdate({ body_override: newValue });
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + snippetBody.length,
          start + snippetBody.length
        );
      }, 0);
    }
  };

  const handleGenerateInsert = (newSubject: string, newBody: string) => {
    setSubject(newSubject);
    setBodyHtml(newBody);
    onUpdate({ subject_override: newSubject, body_override: newBody });
    setShowGenerateModal(false);
  };

  const previewHtml = bodyHtml
    .replace(/\{\{first_name\}\}/g, "John")
    .replace(/\{\{last_name\}\}/g, "Doe")
    .replace(/\{\{email\}\}/g, "john@example.com")
    .replace(/\{\{company_name\}\}/g, "Acme Inc")
    .replace(/\{\{phone\}\}/g, "+1 555-0123")
    .replace(/\{\{unsubscribe_link\}\}/g, "#");

  return (
    <div className="space-y-3">
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
            Leave blank to reply in the same Gmail thread as your first email (subject will auto-become{" "}
            <span className="font-mono">Re: &lt;first email subject&gt;</span>). Only set a subject here if you
            want to break out of the thread and start a new conversation.
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
            <VariablePicker onInsert={handleInsertVariable} />
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
          <div
            className="w-full min-h-[120px] px-3 py-2 border border-slate-300 rounded-md text-sm bg-white prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <textarea
            ref={bodyRef}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            onBlur={handleBodyBlur}
            rows={6}
            placeholder="<p>Hi {{first_name}},</p>"
            className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm font-mono"
          />
        )}
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
    </div>
  );
}
