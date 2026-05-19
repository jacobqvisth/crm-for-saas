"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  Users,
  Check,
  Languages,
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
  detected_language: string | null;
  subject_translated_en: string | null;
  body_translated_en: string | null;
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
      detected_language: string | null;
      subject_translated_en: string | null;
      body_translated_en: string | null;
    };

type Filter = "all" | "unread" | "interested" | "not_interested" | "out_of_office";

type Sender = {
  id: string;
  email_address: string;
  display_name: string | null;
  status: string | null;
};

const HIDE_OOO_KEY = "inbox.hideOOO";
const SENDER_FILTER_KEY = "inbox.senderFilter";

const LANG_LABELS: Record<string, string> = {
  en: "English",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  de: "German",
  fr: "French",
  pl: "Polish",
  cs: "Czech",
  ru: "Russian",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
};

function languageLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return LANG_LABELS[code] ?? code.toUpperCase();
}

function isTranslatable(detected: string | null | undefined): boolean {
  return !!detected && detected !== "en";
}

function htmlToPreview(html: string | null | undefined, max = 80): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

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

function ThreadBubble({ item }: { item: ThreadItem }) {
  // Per-bubble translation toggle. Default = English when a translation exists,
  // because that's the whole point of the feature. Click "Show original" to flip.
  const hasTranslation =
    item.type === "incoming" &&
    isTranslatable(item.detected_language) &&
    !!item.body_translated_en;
  const [showOriginal, setShowOriginal] = useState(false);

  const isIncoming = item.type === "incoming";

  // Pick which body to render.
  const bodyHtml = hasTranslation && !showOriginal
    ? item.body_translated_en
    : item.body_html;

  return (
    <div className={`max-w-2xl ${item.type === "outgoing" ? "ml-auto" : ""}`}>
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

        {isIncoming && hasTranslation && (
          <div className="flex items-center justify-between gap-2 mb-3 px-2.5 py-1.5 rounded-md bg-indigo-50/70 border border-indigo-100 text-xs">
            <span className="flex items-center gap-1.5 text-indigo-700">
              <Languages className="w-3.5 h-3.5" />
              {showOriginal
                ? `Original (${languageLabel(item.detected_language)})`
                : `Translated from ${languageLabel(item.detected_language)}`}
            </span>
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="text-indigo-600 hover:text-indigo-700 font-medium"
            >
              {showOriginal ? "Show English" : "Show original"}
            </button>
          </div>
        )}

        {bodyHtml ? (
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <p className="text-slate-400 italic">(empty)</p>
        )}
      </div>
    </div>
  );
}

function SenderDropdown({
  senders,
  selectedIds,
  summary,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  senders: Sender[];
  selectedIds: string[] | null;
  summary: string;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const effectiveSelected = selectedIds ?? senders.map((s) => s.id);
  const allSelected = senders.length > 0 && effectiveSelected.length === senders.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span className="truncate">{summary}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {senders.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">No senders configured</div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 text-xs">
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="text-indigo-600 hover:text-indigo-700 font-medium"
                  disabled={allSelected}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-slate-500 hover:text-slate-700"
                  disabled={effectiveSelected.length === 0}
                >
                  Clear
                </button>
              </div>
              {senders.map((s) => {
                const checked = effectiveSelected.includes(s.id);
                const label = s.display_name || s.email_address;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onToggle(s.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                  >
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        checked
                          ? "bg-indigo-600 border-indigo-600"
                          : "bg-white border-slate-300"
                      }`}
                    >
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-slate-900 truncate">{label}</span>
                      {s.display_name && (
                        <span className="block text-slate-400 truncate">{s.email_address}</span>
                      )}
                    </span>
                    {s.status && s.status !== "active" && (
                      <span className="text-[10px] text-slate-400 uppercase">{s.status}</span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
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
  const [hideOOO, setHideOOO] = useState(true);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderIds, setSelectedSenderIds] = useState<string[] | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  const selectedMessage = messages.find((m) => m.id === selectedId) ?? null;

  // Hydrate persisted preferences once on mount.
  useEffect(() => {
    try {
      const storedHideOOO = localStorage.getItem(HIDE_OOO_KEY);
      if (storedHideOOO !== null) setHideOOO(storedHideOOO === "1");
      const storedSenders = localStorage.getItem(SENDER_FILTER_KEY);
      if (storedSenders !== null) {
        const parsed = JSON.parse(storedSenders);
        if (Array.isArray(parsed)) setSelectedSenderIds(parsed.filter((v) => typeof v === "string"));
      }
    } catch {
      // Ignore corrupt localStorage values; defaults stand.
    }
    setPreferencesLoaded(true);
  }, []);

  // Persist hideOOO whenever it changes (after hydration).
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(HIDE_OOO_KEY, hideOOO ? "1" : "0");
    } catch {
      /* quota or unavailable — non-fatal */
    }
  }, [hideOOO, preferencesLoaded]);

  // Persist sender selection whenever it changes (after hydration).
  useEffect(() => {
    if (!preferencesLoaded) return;
    if (selectedSenderIds === null) return;
    try {
      localStorage.setItem(SENDER_FILTER_KEY, JSON.stringify(selectedSenderIds));
    } catch {
      /* non-fatal */
    }
  }, [selectedSenderIds, preferencesLoaded]);

  // Fetch the workspace's sender list once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/inbox/senders")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Sender[]) => {
        if (cancelled) return;
        setSenders(data);
        // First time ever: default to "all selected".
        setSelectedSenderIds((current) => {
          if (current !== null) return current;
          return data.map((s) => s.id);
        });
      })
      .catch(() => {
        // Failing here just means the multi-select stays empty; inbox itself still loads.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!preferencesLoaded) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter });
      if (hideOOO) params.set("hideOOO", "1");
      if (selectedSenderIds !== null) {
        params.set("senders", selectedSenderIds.join(","));
      }
      const res = await fetch(`/api/inbox?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load inbox");
      const data = await res.json();
      setMessages(data);
    } catch {
      toast.error("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [filter, hideOOO, selectedSenderIds, preferencesLoaded]);

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

  const senderSummary = useMemo(() => {
    if (selectedSenderIds === null) return "All senders";
    if (senders.length === 0) return "No senders";
    if (selectedSenderIds.length === senders.length) return "All senders";
    if (selectedSenderIds.length === 0) return "No senders selected";
    if (selectedSenderIds.length === 1) {
      const s = senders.find((x) => x.id === selectedSenderIds[0]);
      return s ? (s.display_name || s.email_address) : "1 sender";
    }
    return `${selectedSenderIds.length} senders`;
  }, [selectedSenderIds, senders]);

  const toggleSender = useCallback((id: string) => {
    setSelectedSenderIds((current) => {
      const base = current ?? senders.map((s) => s.id);
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  }, [senders]);

  const selectAllSenders = useCallback(() => {
    setSelectedSenderIds(senders.map((s) => s.id));
  }, [senders]);

  const clearAllSenders = useCallback(() => {
    setSelectedSenderIds([]);
  }, []);

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
          <div className="flex gap-1 flex-wrap mb-3">
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
          {/* Sender + OOO filters */}
          <div className="flex flex-col gap-2">
            <SenderDropdown
              senders={senders}
              selectedIds={selectedSenderIds}
              summary={senderSummary}
              onToggle={toggleSender}
              onSelectAll={selectAllSenders}
              onClearAll={clearAllSenders}
            />
            <label
              className={`flex items-center gap-2 text-xs ${
                filter === "out_of_office"
                  ? "text-slate-300 cursor-not-allowed"
                  : "text-slate-600 cursor-pointer"
              }`}
              title={
                filter === "out_of_office"
                  ? "OOO tab always shows out-of-office replies"
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={hideOOO}
                disabled={filter === "out_of_office"}
                onChange={(e) => setHideOOO(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Hide out-of-office
            </label>
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
              const translated = isTranslatable(msg.detected_language);
              const displaySubject = translated && msg.subject_translated_en
                ? msg.subject_translated_en
                : msg.subject;
              const preview = translated && msg.body_translated_en
                ? htmlToPreview(msg.body_translated_en)
                : msg.body_text
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
                    <div className="text-xs text-slate-600 truncate mb-0.5 flex items-center gap-1">
                      {translated && (
                        <Languages
                          className="w-3 h-3 text-indigo-400 flex-shrink-0"
                          aria-label={`Translated from ${languageLabel(msg.detected_language)}`}
                        />
                      )}
                      <span className="truncate">{displaySubject || "(no subject)"}</span>
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
                <h2 className="text-base font-semibold text-slate-900 truncate flex items-center gap-1.5">
                  {isTranslatable(selectedMessage.detected_language) && (
                    <Languages
                      className="w-4 h-4 text-indigo-500 flex-shrink-0"
                      aria-label={`Translated from ${languageLabel(selectedMessage.detected_language)}`}
                    />
                  )}
                  <span className="truncate">
                    {(isTranslatable(selectedMessage.detected_language) &&
                      selectedMessage.subject_translated_en) ||
                      selectedMessage.subject ||
                      "(no subject)"}
                  </span>
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
                  <ThreadBubble key={`${item.type}-${i}`} item={item} />
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
