"use client";

import { useState, useEffect } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Modal } from "@/components/ui/modal";
import { Loader2, Phone, Plus } from "lucide-react";
import toast from "react-hot-toast";

interface CallList {
  id: string;
  name: string;
  is_dynamic: boolean;
  memberCount?: number;
}

interface AddToCallListModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName?: string;
  onAdded?: () => void;
}

export function AddToCallListModal({
  open,
  onClose,
  contactId,
  contactName,
  onAdded,
}: AddToCallListModalProps) {
  const { workspaceId } = useWorkspace();

  const [lists, setLists] = useState<CallList[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");

  const loadLists = async () => {
    setLoading(true);
    const res = await fetch("/api/calls/lists");
    const data = await res.json().catch(() => ({}));
    // Only static lists can take a manually-added contact — dynamic lists
    // resolve their members from filters, so a direct add would be ignored.
    const staticLists: CallList[] = (data.lists ?? []).filter(
      (l: CallList) => !l.is_dynamic,
    );
    setLists(staticLists);
    setLoading(false);
  };

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setNewListName("");
    setCreating(false);
    loadLists();
  }, [open]);

  const addToList = async (listId: string) => {
    if (!workspaceId) return;
    const res = await fetch("/api/contact-lists/add-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, listId, contactIds: [contactId] }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(result.error || "Could not add to call list");
      return false;
    }
    return true;
  };

  const handleAdd = async () => {
    if (!workspaceId || !selectedId) return;
    setAdding(true);
    const ok = await addToList(selectedId);
    setAdding(false);
    if (ok) {
      toast.success("Added to call list");
      onAdded?.();
      onClose();
    }
  };

  const handleCreateAndAdd = async () => {
    const name = newListName.trim();
    if (!workspaceId || !name) return;
    setCreating(true);
    const res = await fetch("/api/calls/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.list?.id) {
      toast.error(data.error || "Could not create call list");
      setCreating(false);
      return;
    }
    const ok = await addToList(data.list.id);
    setCreating(false);
    if (ok) {
      toast.success(`Added to “${name}”`);
      onAdded?.();
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add to call list" maxWidth="max-w-sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Add {contactName ? <strong>{contactName}</strong> : "this contact"} to a call list.
        </p>

        <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : lists.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-slate-500">
              <Phone className="w-5 h-5 text-slate-300" />
              <span>No call lists yet</span>
            </div>
          ) : (
            lists.map((list) => (
              <label
                key={list.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
              >
                <input
                  type="radio"
                  name="call-list"
                  checked={selectedId === list.id}
                  onChange={() => setSelectedId(list.id)}
                  className="border-slate-300 text-indigo-600"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-900">{list.name}</span>
                  {typeof list.memberCount === "number" && (
                    <span className="ml-2 text-xs text-slate-400">
                      {list.memberCount} contact{list.memberCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        <div className="border-t border-slate-100 pt-3">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Or create a new call list
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newListName.trim()) handleCreateAndAdd();
              }}
              placeholder="e.g. Follow-ups this week"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
            />
            <button
              onClick={handleCreateAndAdd}
              disabled={creating || !newListName.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={adding || !selectedId}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {adding && <Loader2 className="w-4 h-4 animate-spin" />}
            {adding ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
