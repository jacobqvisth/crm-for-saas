'use client';

import { useState, useEffect } from 'react';
import { Loader2, FileText, Phone, Users, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/modal';
import { createClient } from '@/lib/supabase/client';

const ACTIVITY_TYPES = [
  { value: 'note',          label: 'Note',           icon: FileText, defaultSubject: '' },
  { value: 'call',          label: 'Call',           icon: Phone,    defaultSubject: 'Phone call' },
  { value: 'meeting',       label: 'Meeting',        icon: Users,    defaultSubject: 'Meeting' },
  { value: 'email_logged',  label: 'Email (logged)', icon: Mail,     defaultSubject: 'Email logged' },
] as const;

type ActivityType = typeof ACTIVITY_TYPES[number]['value'];

interface LogActivityModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  contactOptions: Array<{ id: string; label: string }>;
  workspaceId: string;
  onLogged: () => void;
}

export function LogActivityModal({
  open, onClose, companyId, companyName, contactOptions, workspaceId, onLogged,
}: LogActivityModalProps) {
  const supabase = createClient();
  const [type, setType] = useState<ActivityType>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType('note');
      setSubject('');
      setBody('');
      setContactId('');
    }
  }, [open]);

  // Refresh default subject when type changes (only if user hasn't typed one)
  const handleTypeChange = (next: ActivityType) => {
    setType(next);
    const spec = ACTIVITY_TYPES.find((t) => t.value === next);
    setSubject((current) => {
      const oldDefault = ACTIVITY_TYPES.find((t) => t.value === type)?.defaultSubject || '';
      if (current === oldDefault) return spec?.defaultSubject || '';
      return current;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() && !subject.trim()) {
      toast.error('Add a subject or note body');
      return;
    }
    setSaving(true);
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from('activities').insert({
      workspace_id: workspaceId,
      company_id: companyId,
      contact_id: contactId || null,
      type,
      subject: subject.trim() || null,
      body: body.trim() || null,
      user_id: user?.user?.id || null,
    });
    if (error) {
      toast.error('Failed to log activity');
      setSaving(false);
      return;
    }
    toast.success(`${labelFor(type)} logged`);
    setSaving(false);
    onLogged();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Log activity for ${companyName}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Type</label>
          <div className="grid grid-cols-4 gap-2">
            {ACTIVITY_TYPES.map((t) => {
              const Icon = t.icon;
              const active = type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTypeChange(t.value)}
                  className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border text-xs font-medium transition ${
                    active
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={ACTIVITY_TYPES.find((t) => t.value === type)?.defaultSubject || 'e.g. Discovery call'}
            className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="What happened, next steps, etc."
            className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
        </div>

        {contactOptions.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Linked contact (optional)
            </label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— Company-wide —</option>
              {contactOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Saving...' : `Log ${labelFor(type).toLowerCase()}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function labelFor(t: ActivityType) {
  return ACTIVITY_TYPES.find((x) => x.value === t)?.label || 'Activity';
}
