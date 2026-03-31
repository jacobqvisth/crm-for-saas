"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import {
  Inbox,
  Send,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  MailOpen,
} from "lucide-react";

type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  lead_status: string;
};

type EmailQueue = {
  subject: string;
  to_email: string;
  sender_account_id: string;
};

type InboxMessage = {
  id: string;
  workspace_id: string;
  gmail_account_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  email_queue_id: string | null;
  contact_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  received_at: string;
  is_read: boolean;
  category: string;
  contacts: Contact | null;
  email_queue: EmailQueue | null;
};

type ThreadItem =
  | {
      type: "outgoing";
      id: string;
      subject: string | null;
      body_html: string | null;
      to_email: string;
      timestamp: string | null;
      gmail_message_id: string | null;
    }
  | {
      type: "incoming";
      id: string;
      subject: string | null;
      body_html: string | null;
      body_text: string | null;
      from_email: string;
      from_name: string | null;
      timestamp: string;
      gmail_message_id: string | null;
    };

type Filter = "all" | "unread" | "interested" | "not_interested" | "out_of_office";

const CATEGORY_LABELS: Record<string, string> = {
  uncategorized: "Uncategorized",
  interested: "Interested",
  not_interested: "Not Interested",
  out_of_office: "Out of Office",
  other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  interested: "bg-green-100 text-green-700",
  not_interested: "bg-red-100 text-red-700",
  out_of_office: "bg-yellow-100 text-yellow-700",
  other: "bg-slate-100 text-slate-600",
};

function getContactName(msg: InboxMessage): string {
  if (msg.contacts) {
    const name = [msg.contacts.first_name, msg.contacts.last_name].filter(Boolean).join(" ");
    if (name) return name;
  }
  return msg.from_name || msg.from_email;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

export function InboxClient() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replySending, setReplySending] = useState(false);

  const selectedMessage = messages.find((m) => m.id === selectedId) ?? null;

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox?filter=${filter}`);
      if (!res.ok) throw new Error("Failed to load inbox");
      const data = await res.json();
      setMessages(data);
    } catch {
      toast.error("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    setThread([]);
    try {
      const res = await fetch(`/api/inbox/${id}/thread`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setThread(data.thread ?? []);
    } catch {
      toast.error("Failed to load thread");
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const selectMessage = useCallback(
    async (msg: InboxMessage) => {
      setSelectedId(msg.id);
      setReplyOpen(false);
      setReplyBody("");

      if (!msg.is_read) {
        // Mark as read optimistically
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, is_read: true } : m))
        );
        await fetch(`/api/inbox/${msg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_read: true }),
        });
      }

      loadThread(msg.id);
    },
    [loadThread]
  );

  const updateMessage = useCallback(
    async (id: string, updates: { is_read?: boolean; category?: string }) => {
      const res = await fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        toast.error("Failed to update message");
        return;
      }
      const updated = await res.json();
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated } : m)));
    },
    []
  );

  const sendReply = useCallback(async () => {
    if (!selectedId || !replyBody.trim()) return;
    setReplySending(true);
    try {
      const res = await fetch(`/api/inbox/${selectedId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send reply");
      }
      toast.success("Reply sent");
      setReplyOpen(false);
      setReplyBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setReplySending(false);
    }
  }, [selectedId, replyBody]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "interested", label: "Interested" },
    { key: "not_interested", label: "Not Interested" },
    { key: "out_of_office", label: "OOO" },
  ];

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left panel — conversation list */}
      <div className="w-80 flex-shrink-0 border-r border-slate-200 flex flex-col bg-white">
        {/* Header */}
        <div className="px-4 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <Inbox className="w-5 h-5 text-indigo-600" />
            <h1 className="font-semibold text-slate-900">Inbox</h1>
          </div>
          {/* Filter tabs */}
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  filter === f.key
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-slate-500">Loading...</div>
          ) : messages.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No messages
            </div>
          ) : (
            messages.map((msg) => {
              const name = getContactName(msg);
              const isSelected = selectedId === msg.id;
              const preview = msg.body_text
                ? msg.body_text.replace(/\s+/g, " ").slice(0, 80)
                : "";

              return (
                <button
                  key={msg.id}
                  onClick={() => selectMessage(msg)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 flex gap-3 transition-colors relative ${
                    isSelected
                      ? "bg-indigo-50"
                      : msg.is_read
                      ? "hover:bg-slate-50"
                      : "hover:bg-slate-50 bg-white"
                  }`}
                >
                  {/* Unread dot */}
                  {!msg.is_read && (
                    <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500" />
                  )}

                  {/* Avatar */}
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700">
                    {getInitials(name) || "?"}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span
                        className={`text-sm truncate ${
                          msg.is_read ? "text-slate-700" : "text-slate-900 font-semibold"
                        }`}
                      >
                        {name}
                      </span>
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {formatDistanceToNow(new Date(msg.received_at), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 truncate mb-0.5">
                      {msg.subject || "(no subject)"}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs text-slate-400 truncate">{preview}</span>
                      {msg.category !== "uncategorized" && CATEGORY_COLORS[msg.category] && (
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                            CATEGORY_COLORS[msg.category]
                          }`}
                        >
                          {CATEGORY_LABELS[msg.category]}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — thread view */}
      <div className="flex-1 flex flex-col bg-slate-50 min-w-0">
        {!selectedMessage ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <Inbox className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a conversation</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900 truncate">
                  {selectedMessage.subject || "(no subject)"}
                </h2>
                <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
                  <span>{selectedMessage.from_name || selectedMessage.from_email}</span>
                  <span className="text-slate-300">·</span>
                  <span>{selectedMessage.from_email}</span>
                  {selectedMessage.contacts && (
                    <>
                      <span className="text-slate-300">·</span>
                      <Link
                        href={`/contacts/${selectedMessage.contacts.id}`}
                        className="text-indigo-600 hover:underline flex items-center gap-0.5"
                      >
                        View Contact
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </>
                  )}
                </div>
              </div>

              {/* Category selector */}
              <select
                value={selectedMessage.category}
                onChange={(e) => updateMessage(selectedMessage.id, { category: e.target.value })}
                className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 flex-shrink-0"
              >
                <option value="uncategorized">Uncategorized</option>
                <option value="interested">Interested</option>
                <option value="not_interested">Not Interested</option>
                <option value="out_of_office">Out of Office</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Action bar */}
            <div className="bg-white border-b border-slate-100 px-6 py-2 flex items-center gap-2">
              <button
                onClick={() =>
                  updateMessage(selectedMessage.id, { category: "interested" })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Interested
              </button>
              <button
                onClick={() =>
                  updateMessage(selectedMessage.id, { category: "not_interested" })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Not Interested
              </button>
              <button
                onClick={() =>
                  updateMessage(selectedMessage.id, { category: "out_of_office" })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition-colors"
              >
                <Clock className="w-3.5 h-3.5" />
                Out of Office
              </button>
              <div className="flex-1" />
              <button
                onClick={() =>
                  updateMessage(selectedMessage.id, { is_read: !selectedMessage.is_read })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
              >
                {selectedMessage.is_read ? (
                  <>
                    <Mail className="w-3.5 h-3.5" /> Mark Unread
                  </>
                ) : (
                  <>
                    <MailOpen className="w-3.5 h-3.5" /> Mark Read
                  </>
                )}
              </button>
            </div>

            {/* Thread messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {threadLoading ? (
                <div className="text-sm text-slate-400">Loading thread...</div>
              ) : (
                thread.map((item, i) => (
                  <div
                    key={`${item.type}-${i}`}
                    className={`max-w-2xl ${item.type === "outgoing" ? "ml-auto" : ""}`}
                  >
                    <div
                      className={`rounded-xl p-4 text-sm ${
                        item.type === "outgoing"
                          ? "bg-slate-100 text-slate-700"
                          : "bg-white border border-slate-200 text-slate-900"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
                        <span>
                          {item.type === "outgoing"
                            ? `To: ${item.to_email}`
                            : `From: ${item.from_name || item.from_email}`}
                        </span>
                        <span>
                          {item.timestamp
                            ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })
                            : ""}
                        </span>
                      </div>
                      {item.body_html ? (
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: item.body_html }}
                        />
                      ) : (
                        <p className="text-slate-400 italic">(empty)</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reply composer */}
            <div className="bg-white border-t border-slate-200 px-6 py-3">
              <button
                onClick={() => setReplyOpen((o) => !o)}
                className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 mb-2"
              >
                <Send className="w-4 h-4" />
                Reply
                {replyOpen ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {replyOpen && (
                <div>
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={`Reply to ${selectedMessage.from_email}...`}
                    rows={4}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={sendReply}
                      disabled={replySending || !replyBody.trim()}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Send className="w-4 h-4" />
                      {replySending ? "Sending..." : "Send Reply"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
