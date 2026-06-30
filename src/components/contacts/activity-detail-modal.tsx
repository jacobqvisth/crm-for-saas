'use client';

import { format, formatDistanceToNow } from 'date-fns';
import { Modal } from '@/components/ui/modal';
import type { Tables } from '@/lib/database.types';

type Activity = Tables<'activities'>;

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
  if (!activity) return null;

  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  const metaEntries = Object.entries(meta).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  const created = activity.created_at ? new Date(activity.created_at) : null;

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

        {/* Full body */}
        {activity.body && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Details</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {activity.body}
            </p>
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
