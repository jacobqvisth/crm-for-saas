"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { VariablePicker } from "@/components/sequences/variable-picker";
import { Save, Trash2, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Template = Tables<"email_templates">;

interface TemplateEditorProps {
  template?: Template | null;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function TemplateEditor({ template, onSave, onCancel, onDelete }: TemplateEditorProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState(template?.name || "");
  const [subject, setSubject] = useState(template?.subject || "");
  const [bodyHtml, setBodyHtml] = useState(template?.body_html || "");
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setSubject(template.subject);
      setBodyHtml(template.body_html);
    }
  }, [template]);

  const handleInsertVariable = (variable: string) => {
    if (bodyRef.current) {
      const textarea = bodyRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = bodyHtml.slice(0, start) + variable + bodyHtml.slice(end);
      setBodyHtml(newValue);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    }
  };

  const generatePlainText = (html: string) => html.replace(/<[^>]*>/g, "").trim();

  const handleSave = async () => {
    if (!workspaceId) {
      toast.error("No workspace found");
      return;
    }
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    if (!bodyHtml.trim()) {
      toast.error("Body is required");
      return;
    }

    setSaving(true);

    const payload = {
      workspace_id: workspaceId,
      name: name.trim(),
      subject: subject.trim(),
      body_html: bodyHtml,
      body_text: generatePlainText(bodyHtml),
    };

    if (template) {
      const { error } = await supabase
        .from("email_templates")
        .update(payload)
        .eq("id", template.id)
        .eq("workspace_id", workspaceId);

      if (error) {
        toast.error("Failed to update template");
      } else {
        toast.success("Template updated");
        onSave();
      }
    } else {
      const { error } = await supabase.from("email_templates").insert(payload);

      if (error) {
        toast.error("Failed to create template");
      } else {
        toast.success("Template created");
        onSave();
      }
    }

    setSaving(false);
  };

  const handleDelete = async () => {
    if (!template || !workspaceId) return;
    if (!confirm("Are you sure you want to delete this template?")) return;

    const { error } = await supabase
      .from("email_templates")
      .delete()
      .eq("id", template.id)
      .eq("workspace_id", workspaceId);

    if (error) {
      toast.error("Failed to delete template");
    } else {
      toast.success("Template deleted");
      onDelete?.();
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
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Template Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Welcome Email"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Subject Line</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Hey {{first_name}}, quick question"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-slate-700">Body (HTML)</label>
          <div className="flex items-center gap-2">
            <VariablePicker onInsert={handleInsertVariable} />
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
            >
              {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPreview ? "Edit" : "Preview"}
            </button>
          </div>
        </div>
        {showPreview ? (
          <div
            className="w-full min-h-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <textarea
            ref={bodyRef}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={10}
            placeholder="<p>Hi {{first_name}},</p><p>...</p>"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <div>
          {template && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : template ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
