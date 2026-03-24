"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { VariablePicker } from "./variable-picker";
import { Eye, EyeOff, FileText } from "lucide-react";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;
type Template = Tables<"email_templates">;

interface EmailStepEditorProps {
  step: Step;
  onUpdate: (updates: Partial<Step>) => void;
}

export function EmailStepEditor({ step, onUpdate }: EmailStepEditorProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [subject, setSubject] = useState(step.subject_override || "");
  const [bodyHtml, setBodyHtml] = useState(step.body_override || "");
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(step.template_id || "");

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
  }, [workspaceId, supabase]);

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
        textarea.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    }
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
        <label className="block text-xs font-medium text-slate-500 mb-1">Use Template</label>
        <div className="relative">
          <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <select
            value={selectedTemplateId}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-md text-sm"
          >
            <option value="">Write inline</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={handleSubjectBlur}
          placeholder="e.g. Hey {{first_name}}, quick question"
          className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-slate-500">Body</label>
          <div className="flex items-center gap-1">
            <VariablePicker onInsert={handleInsertVariable} />
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
            >
              {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
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
    </div>
  );
}
