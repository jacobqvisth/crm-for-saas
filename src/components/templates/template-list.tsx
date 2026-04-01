"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { TemplateEditor } from "./template-editor";
import { SnippetList } from "./snippet-list";
import { Modal } from "@/components/ui/modal";
import { Plus, FileText, Search } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Template = Tables<"email_templates">;

export function TemplateList() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<"templates" | "snippets">("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [snippetEditorOpen, setSnippetEditorOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    let query = supabase
      .from("email_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });

    if (search.trim()) {
      query = query.or(`name.ilike.%${search}%,subject.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Failed to load templates");
    } else {
      setTemplates(data || []);
    }
    setLoading(false);
  }, [workspaceId, supabase, search]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleCreate = () => {
    setSelectedTemplate(null);
    setEditorOpen(true);
  };

  const handleEdit = (template: Template) => {
    setSelectedTemplate(template);
    setEditorOpen(true);
  };

  const handleSaved = () => {
    setEditorOpen(false);
    setSelectedTemplate(null);
    loadTemplates();
  };

  const handleDeleted = () => {
    setEditorOpen(false);
    setSelectedTemplate(null);
    loadTemplates();
  };

  if (!workspaceId) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Email Templates</h1>
          <p className="text-sm text-slate-500 mt-1">
            Create reusable email templates and snippets for your sequences
          </p>
        </div>
        <button
          onClick={activeTab === "templates" ? handleCreate : () => setSnippetEditorOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {activeTab === "templates" ? "Create Template" : "Create Snippet"}
        </button>
      </div>

      <div className="flex border-b border-slate-200 mb-4">
        {(["templates", "snippets"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "snippets" ? (
        <SnippetList
          workspaceId={workspaceId}
          externalCreate={snippetEditorOpen}
          onExternalCreateHandled={() => setSnippetEditorOpen(false)}
        />
      ) : (
        <>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates..."
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-medium text-slate-900">No templates yet</h3>
              <p className="text-sm text-slate-500 mt-1">Create your first email template to get started.</p>
              <button
                onClick={handleCreate}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Template
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Name</th>
                    <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Subject</th>
                    <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {templates.map((template) => (
                    <tr
                      key={template.id}
                      onClick={() => handleEdit(template)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-slate-900">{template.name}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600">{template.subject}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-500">
                          {format(new Date(template.updated_at), "MMM d, yyyy")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={selectedTemplate ? "Edit Template" : "Create Template"}
        maxWidth="max-w-2xl"
      >
        <TemplateEditor
          template={selectedTemplate}
          onSave={handleSaved}
          onCancel={() => setEditorOpen(false)}
          onDelete={handleDeleted}
        />
      </Modal>
    </div>
  );
}
