"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Save, Trash2, Eye, EyeOff } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";
import { RichEmailEditor } from "@/components/sequences/rich-email-editor";
import { EmailPreviewFrame, previewInterpolate } from "@/components/sequences/email-preview-frame";

type Template = Tables<"email_templates">;

type TemplateVersion = {
  id: string;
  version: number;
  name: string;
  subject: string;
  body_html: string;
  created_at: string;
};

interface TemplateEditorProps {
  template?: Template | null;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const TEMPLATE_VARIABLES = [
  "first_name",
  "last_name",
  "email",
  "company_name",
  "phone",
  "sender_first_name",
  "sender_company",
  "unsubscribe_link",
];

export function TemplateEditor({ template, onSave, onCancel, onDelete }: TemplateEditorProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [name, setName] = useState(template?.name || "");
  const [subject, setSubject] = useState(template?.subject || "");
  const [bodyHtml, setBodyHtml] = useState(template?.body_html || "");
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setSubject(template.subject);
      setBodyHtml(template.body_html);
    }
  }, [template]);

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
      // Snapshot current saved state before overwriting
      try {
        const { count } = await supabase
          .from("template_versions")
          .select("id", { count: "exact", head: true })
          .eq("template_id", template.id);

        const nextVersion = (count || 0) + 1;

        await supabase.from("template_versions").insert({
          template_id: template.id,
          workspace_id: workspaceId,
          version: nextVersion,
          name: template.name,
          subject: template.subject,
          body_html: template.body_html,
        });

        // Cap at 20 versions — delete oldest beyond 20
        const { data: oldVersions } = await supabase
          .from("template_versions")
          .select("id")
          .eq("template_id", template.id)
          .order("version", { ascending: false })
          .range(20, 1000);

        if (oldVersions && oldVersions.length > 0) {
          await supabase
            .from("template_versions")
            .delete()
            .in("id", oldVersions.map((v) => v.id));
        }
      } catch (err) {
        console.error("Failed to snapshot template version:", err);
      }

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

  const handleToggleVersions = async () => {
    setShowVersions(!showVersions);
    if (!showVersions && versions.length === 0 && template) {
      setLoadingVersions(true);
      const { data } = await supabase
        .from("template_versions")
        .select("id, version, name, subject, body_html, created_at")
        .eq("template_id", template.id)
        .order("version", { ascending: false })
        .limit(20);
      setVersions((data as TemplateVersion[]) || []);
      setLoadingVersions(false);
    }
  };

  const handleRestoreVersion = (v: TemplateVersion) => {
    setName(v.name);
    setSubject(v.subject);
    setBodyHtml(v.body_html);
    setShowVersions(false);
    toast(`Restored version ${v.version} — click Save to apply`, { icon: "⏪" });
  };

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
          <label className="block text-sm font-medium text-slate-700">Body</label>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPreview ? "Edit" : "Preview"}
          </button>
        </div>

        {showPreview ? (
          <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
            <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              Gmail preview — sample values shown
            </div>
            <EmailPreviewFrame html={previewInterpolate(bodyHtml)} minHeight={240} />
          </div>
        ) : (
          <RichEmailEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            placeholder="Hi {{first_name}}, …"
            variables={TEMPLATE_VARIABLES}
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

      {template && (
        <div className="pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleToggleVersions}
            className="text-sm text-slate-500 hover:text-slate-700 underline"
          >
            {showVersions ? "Hide version history" : "Version history"}
            {versions.length > 0 && ` (${versions.length})`}
          </button>

          {showVersions && (
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {loadingVersions ? (
                <p className="text-sm text-slate-400">Loading...</p>
              ) : versions.length === 0 ? (
                <p className="text-sm text-slate-400">No previous versions yet.</p>
              ) : (
                versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-sm"
                  >
                    <div>
                      <span className="font-medium text-slate-700">v{v.version}</span>
                      <span className="text-slate-400 ml-2">
                        {format(new Date(v.created_at), "MMM d, HH:mm")}
                      </span>
                      <p className="text-slate-500 truncate max-w-xs">{v.subject}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreVersion(v)}
                      className="text-xs px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded"
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
