"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveVariables } from "@/lib/sequences/variables";
import { RichEmailEditor } from "@/components/sequences/rich-email-editor";
import { Wand2, Loader2, Send, Eye, EyeOff, FileText } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;
type EmailTemplate = Tables<"email_templates">;

type Sender = {
  id: string;
  email_address: string;
  display_name: string | null;
  status: string;
};

type PersonaAngle = "shop_owner" | "service_advisor" | "technician";

const PERSONAS: { value: PersonaAngle; label: string }[] = [
  { value: "shop_owner", label: "Shop owner" },
  { value: "service_advisor", label: "Service advisor" },
  { value: "technician", label: "Technician" },
];

function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|br|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ComposeEmailModal({
  contact,
  workspaceId,
  company,
  onClose,
  onSent,
}: {
  contact: Contact;
  workspaceId: string;
  company: Company | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const supabase = createClient();

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [senderId, setSenderId] = useState("");

  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  const [persona, setPersona] = useState<PersonaAngle>("shop_owner");
  const [personalizing, setPersonalizing] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");

  const firstName = contact.first_name || "this contact";
  const toEmail = contact.email || "";

  // Load templates + connected senders.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name");
      setTemplates(data || []);
    })();

    (async () => {
      try {
        const res = await fetch("/api/inbox/senders");
        if (!res.ok) return;
        const data: Sender[] = await res.json();
        setSenders(data);
        const firstActive = data.find((s) => s.status === "active");
        if (firstActive) setSenderId(firstActive.id);
      } catch {
        /* non-fatal: server falls back to round-robin if none chosen */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Load a template's content into the editor (fully editable afterward).
  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setSubject(tpl.subject || "");
    setBodyHtml(tpl.body_html || "");
  };

  // Personalize the current draft with AI (reuses the sequence email generator).
  // Works whether the draft started blank, from a template, or hand-written.
  const handlePersonalize = async () => {
    setPersonalizing(true);
    try {
      const hasDraft = !!(subject.trim() || stripHtml(bodyHtml));
      const res = await fetch("/api/ai/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          personaAngle: persona,
          contactContext: {
            firstName: contact.first_name || undefined,
            lastName: contact.last_name || undefined,
            title: contact.title || undefined,
            company: company?.name || undefined,
            city: contact.city || undefined,
            country: contact.country || undefined,
          },
          stepNumber: 1,
          // If there's a draft, personalize it; otherwise write a fresh one.
          existingTemplate: hasDraft
            ? { subject: subject || "(no subject yet)", body: bodyHtml || "" }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Personalization failed");
        return;
      }
      setSubject(data.subject || subject);
      setBodyHtml(data.body || bodyHtml);
      toast.success("Draft personalized — review and edit before sending");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setPersonalizing(false);
    }
  };

  // Live preview: resolve merge variables exactly as the send path will.
  const preview = useMemo(
    () => ({
      subject: resolveVariables(subject, contact, company),
      body: resolveVariables(bodyHtml, contact, company),
    }),
    [subject, bodyHtml, contact, company]
  );

  const handleSend = async () => {
    if (!subject.trim()) {
      toast.error("Add a subject");
      return;
    }
    if (!stripHtml(bodyHtml)) {
      toast.error("Write a message");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          bodyHtml,
          senderAccountId: senderId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send");
        return;
      }

      // Optionally persist this as a reusable template (raw, with variables).
      if (saveAsTemplate && newTemplateName.trim()) {
        const { error } = await supabase.from("email_templates").insert({
          workspace_id: workspaceId,
          name: newTemplateName.trim(),
          subject: subject.trim(),
          body_html: bodyHtml,
          body_text: stripHtml(bodyHtml),
        });
        if (error) toast.error("Email sent, but saving the template failed");
        else toast.success("Email sent and template saved");
      } else {
        toast.success(
          data.sender_email ? `Email sent from ${data.sender_email}` : "Email sent"
        );
      }

      onSent?.();
      onClose();
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSending(false);
    }
  };

  const activeSenders = senders.filter((s) => s.status === "active");

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-900">
            Email {firstName}
          </h3>
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* To / From */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
              <div className="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 truncate">
                {toEmail || <span className="text-red-500">No email address</span>}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
              {activeSenders.length > 0 ? (
                <select
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {activeSenders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name ? `${s.display_name} <${s.email_address}>` : s.email_address}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-400">
                  Auto-selected sender
                </div>
              )}
            </div>
          </div>

          {/* Start-from row: template + AI */}
          <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Start from a template
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Blank — write it yourself</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[140px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">AI angle</label>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value as PersonaAngle)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {PERSONAS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handlePersonalize}
              disabled={personalizing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-100 rounded-lg hover:bg-indigo-200 disabled:opacity-50"
              title="Personalize the current draft (or write a fresh one) with AI"
            >
              {personalizing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {personalizing ? "Writing…" : "Personalize with AI"}
            </button>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
              className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-500">Message</label>
              <button
                onClick={() => setShowPreview((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
              >
                {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showPreview ? "Edit" : "Preview"}
              </button>
            </div>

            {showPreview ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs text-slate-600">
                  <span className="font-medium">Subject:</span>{" "}
                  {preview.subject || <span className="text-slate-400">(empty)</span>}
                </div>
                <div
                  className="px-3 py-2.5 text-sm text-slate-800 leading-relaxed prose prose-sm max-w-none min-h-[160px]"
                  dangerouslySetInnerHTML={{ __html: preview.body || "<p class='text-slate-400'>(empty)</p>" }}
                />
                <p className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100 bg-slate-50">
                  Preview with this contact&apos;s details filled in. Your signature is added automatically.
                </p>
              </div>
            ) : (
              <RichEmailEditor
                value={bodyHtml}
                onChange={setBodyHtml}
                workspaceId={workspaceId}
                placeholder={`Write to ${firstName}… use + Variable for {{first_name}}, {{company_name}}, etc.`}
              />
            )}
          </div>

          {/* Save as template */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={saveAsTemplate}
                onChange={(e) => setSaveAsTemplate(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              Also save this as a reusable template
            </label>
            {saveAsTemplate && (
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="Template name"
                className="mt-2 w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200">
          <p className="text-xs text-slate-400">
            Sends one tracked email. Opens, clicks &amp; replies show on the timeline.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !toEmail || (saveAsTemplate && !newTemplateName.trim())}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? "Sending…" : "Send email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
