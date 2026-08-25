"use client";

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Loader2, List, Phone, Plus } from "lucide-react";
import toast from "react-hot-toast";

// contact_lists.purpose — 'email' is the default (a normal contact list),
// 'calling' is what the /calls surfaces read.
export type ListPurpose = "email" | "calling";

interface TargetList {
  id: string;
  name: string;
  is_dynamic: boolean;
  memberCount?: number;
}

interface AddToListModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName?: string;
  /** Which tab opens first. Defaults to a normal contact list. */
  initialPurpose?: ListPurpose;
  /** Lists the contact already belongs to, so they render as already added. */
  existingListIds?: string[];
  onAdded?: () => void;
}

const PURPOSE_LABEL: Record<ListPurpose, string> = {
  email: "Contact list",
  calling: "Call list",
};

export function AddToListModal({
  open,
  onClose,
  contactId,
  contactName,
  initialPurpose = "email",
  existingListIds = [],
  onAdded,
}: AddToListModalProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [purpose, setPurpose] = useState<ListPurpose>(initialPurpose);
  const [lists, setLists] = useState<TargetList[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");

  const alreadyIn = new Set(existingListIds);

  const loadLists = useCallback(
    async (target: ListPurpose) => {
      setLoading(true);
      setLists([]);
      if (target === "calling") {
        const res = await fetch("/api/calls/lists");
        const data = await res.json().catch(() => ({}));
        // Only static lists can take a manually-added contact — dynamic lists
        // resolve their members from filters, so a direct add would be ignored.
        setLists(
          ((data.lists ?? []) as TargetList[]).filter((l) => !l.is_dynamic),
        );
      } else if (workspaceId) {
        const { data, error } = await supabase
          .from("contact_lists")
          .select("id, name, is_dynamic")
          .eq("workspace_id", workspaceId)
          .eq("purpose", "email")
          .eq("is_dynamic", false)
          .order("updated_at", { ascending: false });
        if (error) {
          toast.error("Could not load lists");
        } else {
          const withCounts = await Promise.all(
            (data ?? []).map(async (l) => {
              const { count } = await supabase
                .from("contact_list_members")
                .select("*", { count: "exact", head: true })
                .eq("list_id", l.id);
              return { ...l, is_dynamic: l.is_dynamic ?? false, memberCount: count ?? 0 };
            }),
          );
          setLists(withCounts);
        }
      }
      setLoading(false);
    },
    [supabase, workspaceId],
  );

  useEffect(() => {
    if (!open) return;
    setPurpose(initialPurpose);
    setSelectedId(null);
    setNewListName("");
    setCreating(false);
  }, [open, initialPurpose]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    loadLists(purpose);
  }, [open, purpose, loadLists]);

  const addToList = async (listId: string) => {
    if (!workspaceId) return false;
    const res = await fetch("/api/contact-lists/add-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, listId, contactIds: [contactId] }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(
        result.error ||
          `Could not add to ${PURPOSE_LABEL[purpose].toLowerCase()}`,
      );
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
      toast.success(`Added to ${PURPOSE_LABEL[purpose].toLowerCase()}`);
      onAdded?.();
      onClose();
    }
  };

  const handleCreateAndAdd = async () => {
    const name = newListName.trim();
    if (!workspaceId || !name) return;
    setCreating(true);

    let listId: string | null = null;
    if (purpose === "calling") {
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
      listId = data.list.id as string;
    } else {
      const { data, error } = await supabase
        .from("contact_lists")
        .insert({
          workspace_id: workspaceId,
          name,
          is_dynamic: false,
          purpose: "email",
        })
        .select("id")
        .single();
      if (error || !data?.id) {
        toast.error(error?.message || "Could not create list");
        setCreating(false);
        return;
      }
      listId = data.id;
    }

    const ok = await addToList(listId);
    setCreating(false);
    if (ok) {
      toast.success(`Added to “${name}”`);
      onAdded?.();
      onClose();
    }
  };

  const emptyIcon =
    purpose === "calling" ? (
      <Phone className="w-5 h-5 text-slate-300" />
    ) : (
      <List className="w-5 h-5 text-slate-300" />
    );

  return (
    <Modal open={open} onClose={onClose} title="Add to list" maxWidth="max-w-sm">
      <div className="space-y-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(["email", "calling"] as ListPurpose[]).map((p) => (
            <button
              key={p}
              onClick={() => setPurpose(p)}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                purpose === p
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {PURPOSE_LABEL[p]}
            </button>
          ))}
        </div>

        <p className="text-sm text-slate-500">
          Add {contactName ? <strong>{contactName}</strong> : "this contact"} to a{" "}
          {PURPOSE_LABEL[purpose].toLowerCase()}.
        </p>

        <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : lists.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-slate-500">
              {emptyIcon}
              <span>No {PURPOSE_LABEL[purpose].toLowerCase()}s yet</span>
            </div>
          ) : (
            lists.map((list) => {
              const isMember = alreadyIn.has(list.id);
              return (
                <label
                  key={list.id}
                  className={`flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 ${
                    isMember ? "opacity-60" : "hover:bg-slate-50 cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="target-list"
                    disabled={isMember}
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
                  {isMember && (
                    <span className="text-xs text-slate-400 whitespace-nowrap">Already added</span>
                  )}
                </label>
              );
            })
          )}
        </div>

        <div className="border-t border-slate-100 pt-3">
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Or create a new {PURPOSE_LABEL[purpose].toLowerCase()}
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
