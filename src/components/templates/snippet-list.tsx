"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { VariablePicker } from "@/components/sequences/variable-picker";
import { Plus, Scissors, Search } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { Modal } from "@/components/ui/modal";
import type { Tables } from "@/lib/database.types";

type Snippet = Tables<"snippets">;

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "intro", label: "Intro" },
  { value: "objection", label: "Objection Handling" },
  { value: "pricing", label: "Pricing" },
  { value: "next_steps", label: "Next Steps" },
  { value: "closing", label: "Closing" },
];

function getCategoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

interface SnippetEditorProps {
  snippet: Snippet | null;
  workspaceId: string;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function SnippetEditor({ snippet, workspaceId, onSave, onCancel, onDelete }: SnippetEditorProps) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState(snippet?.name ?? "");
  const [category, setCategory] = useState(snippet?.category ?? "general");
  const [body, setBody] = useState(snippet?.body ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (snippet) {
      setName(snippet.name);
      setCategory(snippet.category);
      setBody(snippet.body);
    }
  }, [snippet]);

  const handleInsertVariable = (variable: string) => {
    if (bodyRef.current) {
      const textarea = bodyRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = body.slice(0, start) + variable + body.slice(end);
      setBody(newValue);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!body.trim()) { toast.error("Body is required"); return; }

    setSaving(true);
    try {
      if (snippet) {
        const res = await fetch(`/api/snippets/${snippet.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), category, body }),
        });
        if (!res.ok) throw new Error("Failed to update snippet");
        toast.success("Snippet updated");
      } else {
        const res = await fetch("/api/snippets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), category, body, workspaceId }),
        });
        if (!res.ok) throw new Error("Failed to create snippet");
        toast.success("Snippet created");
      }
      onSave();
    } catch {
      toast.error(snippet ? "Failed to update snippet" : "Failed to create snippet");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!snippet) return;
    if (!confirm("Delete this snippet?")) return;
    const res = await fetch(`/api/snippets/${snippet.id}?workspaceId=${workspaceId}`, {
      method: "DELETE",
    });
    if (!res.ok) { toast.error("Failed to delete snippet"); return; }
    toast.success("Snippet deleted");
    onDelete();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pricing objection response"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-slate-700">Body</label>
          <VariablePicker onInsert={handleInsertVariable} />
        </div>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder="Write your reusable snippet here. Use {{first_name}}, {{company_name}}, etc."
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        <div>
          {snippet && (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
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
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : snippet ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SnippetListProps {
  workspaceId: string;
  externalCreate?: boolean;
  onExternalCreateHandled?: () => void;
}

export function SnippetList({ workspaceId, externalCreate, onExternalCreateHandled }: SnippetListProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<Snippet | null>(null);

  useEffect(() => {
    if (externalCreate) {
      setSelected(null);
      setEditorOpen(true);
      onExternalCreateHandled?.();
    }
  }, [externalCreate, onExternalCreateHandled]);

  const loadSnippets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/snippets?workspaceId=${workspaceId}`);
      const data = await res.json();
      setSnippets(data.snippets || []);
    } catch {
      toast.error("Failed to load snippets");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  const filtered = search.trim()
    ? snippets.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.body.toLowerCase().includes(search.toLowerCase())
      )
    : snippets;

  const handleSaved = () => {
    setEditorOpen(false);
    setSelected(null);
    loadSnippets();
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search snippets..."
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <Scissors className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-slate-900">
            {search ? "No snippets match your search" : "No snippets yet"}
          </h3>
          {!search && (
            <>
              <p className="text-sm text-slate-500 mt-1">
                Create reusable text blocks for objection handling, pricing, CTAs, and more.
              </p>
              <button
                onClick={() => { setSelected(null); setEditorOpen(true); }}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Snippet
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Name</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Category</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Preview</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((snippet) => (
                <tr
                  key={snippet.id}
                  onClick={() => { setSelected(snippet); setEditorOpen(true); }}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-slate-900">{snippet.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full">
                      {getCategoryLabel(snippet.category)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-500 truncate max-w-xs block">
                      {snippet.body.slice(0, 80)}{snippet.body.length > 80 ? "…" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-500">
                      {format(new Date(snippet.updated_at), "MMM d, yyyy")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={selected ? "Edit Snippet" : "Create Snippet"}
        maxWidth="max-w-2xl"
      >
        <SnippetEditor
          snippet={selected}
          workspaceId={workspaceId}
          onSave={handleSaved}
          onCancel={() => setEditorOpen(false)}
          onDelete={handleSaved}
        />
      </Modal>
    </div>
  );
}
