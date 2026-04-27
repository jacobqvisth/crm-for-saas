"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { Modal } from "@/components/ui/modal";
import { Search, Users, UserPlus, Loader2, AlertTriangle, Settings } from "lucide-react";
import { SenderAccountSelector } from "@/components/gmail/sender-account-selector";
import { resolveListContactIds } from "@/lib/lists/filter-query";
import toast from "react-hot-toast";
import type { Tables, SequenceSettings } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type ContactList = Tables<"contact_lists">;

interface EnrollContactsModalProps {
  open: boolean;
  onClose: () => void;
  sequenceId: string;
  sequenceStatus?: string;
  sequenceSettings?: SequenceSettings;
  onEnrolled: () => void;
  onOpenSettings?: () => void;
}

export function EnrollContactsModal({
  open,
  onClose,
  sequenceId,
  sequenceStatus,
  sequenceSettings,
  onEnrolled,
  onOpenSettings,
}: EnrollContactsModalProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const rotationPool = sequenceSettings?.rotation_account_ids ?? [];
  const hasRotationPool = rotationPool.length > 0;
  const [totalAccounts, setTotalAccounts] = useState<number | null>(null);

  // Fetch the workspace account count so we can render "X of Y accounts" cleanly.
  useEffect(() => {
    if (!workspaceId || !open) return;
    fetch(`/api/gmail/accounts?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => setTotalAccounts((data.accounts || []).length))
      .catch(() => setTotalAccounts(null));
  }, [workspaceId, open]);

  const [tab, setTab] = useState<"search" | "list">("search");
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [senderAccountId, setSenderAccountId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  // Search contacts
  const searchContacts = useCallback(async () => {
    if (!workspaceId || !search.trim()) {
      setContacts([]);
      return;
    }
    setSearchLoading(true);

    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
      .limit(20);

    setContacts(data || []);
    setSearchLoading(false);
  }, [workspaceId, search, supabase]);

  useEffect(() => {
    const timer = setTimeout(searchContacts, 300);
    return () => clearTimeout(timer);
  }, [searchContacts]);

  // Load lists
  useEffect(() => {
    if (!workspaceId || !open) return;
    (async () => {
      const { data } = await supabase
        .from("contact_lists")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name");
      setLists(data || []);
    })();
  }, [workspaceId, open, supabase]);

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEnroll = async () => {
    if (!workspaceId) {
      toast.error("No workspace found");
      return;
    }

    setEnrolling(true);

    let contactIds: string[] = [];

    if (tab === "search") {
      contactIds = Array.from(selectedContacts);
    } else if (tab === "list" && selectedList) {
      const list = lists.find((l) => l.id === selectedList);
      if (!list) {
        toast.error("List not found");
        setEnrolling(false);
        return;
      }
      try {
        contactIds = await resolveListContactIds(supabase, list);
      } catch {
        toast.error("Failed to resolve list contacts");
        setEnrolling(false);
        return;
      }
    }

    if (contactIds.length === 0) {
      toast.error("No contacts selected");
      setEnrolling(false);
      return;
    }

    // Call the enrollment API
    const res = await fetch("/api/sequences/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequenceId,
        contactIds,
        workspaceId,
        senderAccountId,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      if (result.code === "NO_SENDER") {
        toast.error(result.error, { duration: 6000 });
      } else {
        toast.error(result.error || "Enrollment failed");
      }
    } else {
      toast.success(`Enrolled ${result.enrolled} contacts${result.skipped > 0 ? `, skipped ${result.skipped}` : ""}`);
      if (result.reasons && result.reasons.length > 0) {
        console.log("Enrollment skip reasons:", result.reasons);
      }
      onEnrolled();
      onClose();
    }

    setEnrolling(false);
  };

  const reset = () => {
    setSearch("");
    setContacts([]);
    setSelectedContacts(new Set());
    setSelectedList(null);
    setSenderAccountId(null);
    setTab("search");
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add Contacts to Sequence"
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {(sequenceStatus === "draft" || sequenceStatus === "paused") && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              This sequence is <strong>{sequenceStatus === "draft" ? "in Draft" : "Paused"}</strong>. Contacts will be enrolled and emails will be queued,
              but make sure to <strong>Activate</strong> the sequence for emails to send on schedule.
            </span>
          </div>
        )}

        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setTab("search")}
            className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === "search" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Search Contacts
          </button>
          <button
            onClick={() => setTab("list")}
            className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            From List
          </button>
        </div>

        {tab === "search" ? (
          <div>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm"
                autoFocus
              />
            </div>

            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
              {searchLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-500">
                  {search.trim() ? "No contacts found" : "Type to search contacts"}
                </div>
              ) : (
                contacts.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedContacts.has(c.id)}
                      onChange={() => toggleContact(c.id)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{c.email}</div>
                    </div>
                  </label>
                ))
              )}
            </div>

            {selectedContacts.size > 0 && (
              <div className="mt-2 text-sm text-indigo-600 font-medium">
                {selectedContacts.size} contact(s) selected
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
              {lists.length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-500">
                  No contact lists found
                </div>
              ) : (
                lists.map((list) => (
                  <label
                    key={list.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                  >
                    <input
                      type="radio"
                      name="list"
                      checked={selectedList === list.id}
                      onChange={() => setSelectedList(list.id)}
                      className="border-slate-300 text-indigo-600"
                    />
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-900">{list.name}</span>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        {workspaceId && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700">
                Sender account
              </label>
              {hasRotationPool && onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                >
                  <Settings className="w-3 h-3" />
                  Edit pool
                </button>
              )}
            </div>
            <SenderAccountSelector
              workspaceId={workspaceId}
              value={senderAccountId}
              onChange={setSenderAccountId}
              showCapacity={true}
              autoRotateLabel={
                hasRotationPool
                  ? `Auto-rotate (${rotationPool.length}${
                      totalAccounts !== null ? ` of ${totalAccounts}` : ""
                    } accounts)`
                  : undefined
              }
            />
            {hasRotationPool && senderAccountId === null && (
              <p className="text-xs text-slate-500">
                This sequence rotates only through {rotationPool.length}
                {totalAccounts !== null ? ` of ${totalAccounts}` : ""} workspace account{rotationPool.length === 1 ? "" : "s"}.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => { reset(); onClose(); }}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleEnroll}
            disabled={enrolling || (tab === "search" && selectedContacts.size === 0) || (tab === "list" && !selectedList)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {enrolling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            {enrolling ? "Enrolling..." : "Enroll"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
