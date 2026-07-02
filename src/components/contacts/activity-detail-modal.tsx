'use client';

import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Modal } from '@/components/ui/modal';
import type { Tables } from '@/lib/database.types';

type Activity = Tables<'activities'>;

interface EmailBody {
  source: 'inbox' | 'queue' | null;
  subject?: string | null;
  body_html: string | null;
  body_text: string | null;
  detected_language?: string | null;
  subject_translated_en?: string | null;
  body_translated_en?: string | null;
}

// Friendly labels for known metadata keys. Anything not listed is humanized
// from its snake_case key (e.g. `gmail_thread_id` -> "Gmail thread id").
const METADATA_LABELS: Record<string, string> = {
  sender_name: 'Sent by',
  sender_email: 'Sender',
  recipient: 'Recipient',
  to_email: 'Recipient',
  gmail_message_id: 'Gmail message ID',
  gmail_thread_id: 'Gmail thread ID',
  email_queue_id: 'Email queue ID',
  enrollment_id: 'Enrollment ID',
  sequence_id: 'Sequence ID',
  step_id: 'Step ID',
  tracking_id: 'Tracking ID',
  call_session_id: 'Call session ID',
  is_auto_reply: 'Auto-reply',
  stage: 'Stage',
  direction: 'Direction',
  duration: 'Duration',
  outcome: 'Outcome',
};

function humanizeKey(key: string): string {
  const label = key.replace(/_/g, ' ').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return JSON.stringify(value, null, 2);
}

// Does this activity look like an email whose body we can go fetch?
function isEmailActivity(activity: Activity): boolean {
  if (activity.type?.startsWith('email')) return true;
  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  return Boolean(meta.gmail_message_id || meta.email_queue_id);
}

interface ActivityDetailModalProps {
  activity: Activity | null;
  title: string;
  icon: React.ReactNode;
  typeLabel: string;
  onClose: () => void;
}

export function ActivityDetailModal({
  activity,
  title,
  icon,
  typeLabel,
  onClose,
}: ActivityDetailModalProps) {
  const [email, setEmail] = useState<EmailBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  const activityId = activity?.id ?? null;
  const wantsEmail = activity ? isEmailActivity(activity) : false;

  useEffect(() => {
    if (!activityId || !wantsEmail) {
      setEmail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEmail(null);
    setShowTranslation(false);
    fetch(`/api/activities/${activityId}/email-body`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EmailBody | null) => {
        if (!cancelled) setEmail(data);
      })
      .catch(() => {
        if (!cancelled) setEmail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, wantsEmail]);

  if (!activity) return null;

  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  const metaEntries = Object.entries(meta).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  const created = activity.created_at ? new Date(activity.created_at) : null;

  const hasEmailBody = Boolean(email && (email.body_html || email.body_text));
  const canTranslate = Boolean(
    email?.body_translated_en &&
      email.detected_language &&
      email.detected_language !== 'en',
  );

  // When we have the real message, the generic activity.body summary
  // ("Email from foo@bar.com") is redundant — hide it.
  const showBodySummary = Boolean(activity.body) && !hasEmailBody && !loading;

  const displayHtml =
    showTranslation && email?.body_translated_en
      ? email.body_translated_en
      : email?.body_html;

  return (
    <Modal open={!!activity} onClose={onClose} title="Activity details" maxWidth="max-w-lg">
      <div className="space-y-4">
        {/* Header: icon + type + title */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">{icon}</div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{typeLabel}</p>
            <p className="text-sm font-medium text-slate-900 break-words">{title}</p>
          </div>
        </div>

        {/* Full subject (untruncated) */}
        {activity.subject && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Subject</p>
            <p className="text-sm text-slate-800 break-words">{activity.subject}</p>
          </div>
        )}

        {/* Generic body summary (only when no real email body is available) */}
        {showBodySummary && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Details</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {activity.body}
            </p>
          </div>
        )}

        {/* Real email message */}
        {wantsEmail && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">Message</p>
              {canTranslate && (
                <button
                  type="button"
                  onClick={() => setShowTranslation((v) => !v)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {showTranslation
                    ? 'Show original'
                    : `Translate from ${email?.detected_language?.toUpperCase()}`}
                </button>
              )}
            </div>

            {loading ? (
              <p className="text-sm italic text-slate-400">Loading message…</p>
            ) : hasEmailBody ? (
              displayHtml ? (
                <iframe
                  sandbox=""
                  srcDoc={displayHtml}
                  title="Email message"
                  className="h-80 w-full rounded-lg border border-slate-200 bg-white"
                />
              ) : (
                <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  {showTranslation && email?.body_translated_en
                    ? email.body_translated_en
                    : email?.body_text}
                </p>
              )
            ) : (
              <p className="text-sm italic text-slate-400">
                Full message text not available for this activity.
              </p>
            )}
          </div>
        )}

        {/* Metadata */}
        {metaEntries.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">More info</p>
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {metaEntries.map(([key, value]) => (
                <div key={key} className="flex gap-3 px-3 py-2">
                  <dt className="w-1/3 flex-shrink-0 text-xs font-medium text-slate-500">
                    {METADATA_LABELS[key] ?? humanizeKey(key)}
                  </dt>
                  <dd className="min-w-0 flex-1 text-xs text-slate-800 break-words whitespace-pre-wrap">
                    {formatValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Timestamp */}
        {created && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">When</p>
            <p className="text-sm text-slate-800">
              {format(created, 'PPpp')}
              <span className="text-slate-400">
                {' '}· {formatDistanceToNow(created, { addSuffix: true })}
              </span>
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
