'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { SlideOver } from '@/components/ui/slide-over';
import { createClient } from '@/lib/supabase/client';

const LEAD_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'customer', label: 'Customer' },
  { value: 'unqualified', label: 'Unqualified' },
  { value: 'churned', label: 'Churned' },
];

interface AddContactModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  workspaceId: string;
  onCreated: () => void;
}

export function AddContactModal({
  open, onClose, companyId, companyName, workspaceId, onCreated,
}: AddContactModalProps) {
  const supabase = createClient();
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', title: '', lead_status: 'new',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ first_name: '', last_name: '', email: '', phone: '', title: '', lead_status: 'new' });
      setErrors({});
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.email.trim()) next.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Invalid email';
    if (Object.keys(next).length) { setErrors(next); return; }

    setSaving(true);
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        workspace_id: workspaceId,
        company_id: companyId,
        email: form.email.trim(),
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        phone: form.phone.trim() || null,
        title: form.title.trim() || null,
        lead_status: form.lead_status,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') toast.error('A contact with this email already exists');
      else toast.error('Failed to create contact');
      setSaving(false);
      return;
    }

    await supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'contact_created',
      contact_id: data.id,
      company_id: companyId,
      subject: 'Contact created',
    });

    toast.success('Contact created');
    setSaving(false);
    onCreated();
    onClose();
  };

  return (
    <SlideOver open={open} onClose={onClose} title={`Add contact at ${companyName}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              type="text"
              value={form.first_name}
              onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
              className={input}
            />
          </Field>
          <Field label="Last name">
            <input
              type="text"
              value={form.last_name}
              onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              className={input}
            />
          </Field>
        </div>

        <Field label="Email *" error={errors.email}>
          <input
            type="email"
            value={form.email}
            onChange={(e) => { setForm((f) => ({ ...f, email: e.target.value })); setErrors({}); }}
            className={errors.email ? inputError : input}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={input}
            />
          </Field>
          <Field label="Title">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={input}
              placeholder="e.g. Owner"
            />
          </Field>
        </div>

        <Field label="Lead status">
          <select
            value={form.lead_status}
            onChange={(e) => setForm((f) => ({ ...f, lead_status: e.target.value }))}
            className={input}
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>

        <div className="text-xs text-slate-500 pt-2 border-t border-slate-100">
          Will be linked to <span className="font-medium text-slate-700">{companyName}</span>.
        </div>

        <div className="sticky bottom-0 -mx-4 -mb-4 mt-6 px-4 py-3 bg-white border-t border-slate-200 flex justify-end gap-2">
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
            {saving ? 'Creating...' : 'Create contact'}
          </button>
        </div>
      </form>
    </SlideOver>
  );
}

const input = 'w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';
const inputError = 'w-full text-sm px-2 py-1.5 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
