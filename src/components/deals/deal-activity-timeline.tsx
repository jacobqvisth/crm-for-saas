'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowRight, MessageSquare, Mail, MailOpen, Eye, MousePointerClick,
  Phone, Calendar, FileText, UserPlus, Loader2, Activity,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import toast from 'react-hot-toast';
import type { Tables, Json } from '@/lib/database.types';

type ActivityRow = Tables<'activities'>;

const iconMap: Record<string, { icon: typeof Activity; color: string }> = {
  deal_stage_change: { icon: ArrowRight, color: 'bg-amber-100 text-amber-600' },
  note: { icon: MessageSquare, color: 'bg-slate-100 text-slate-600' },
  email_sent: { icon: Mail, color: 'bg-blue-100 text-blue-600' },
  email_received: { icon: MailOpen, color: 'bg-green-100 text-green-600' },
  email_opened: { icon: Eye, color: 'bg-purple-100 text-purple-600' },
  email_clicked: { icon: MousePointerClick, color: 'bg-orange-100 text-orange-600' },
  call: { icon: Phone, color: 'bg-teal-100 text-teal-600' },
  meeting: { icon: Calendar, color: 'bg-indigo-100 text-indigo-600' },
  task: { icon: FileText, color: 'bg-slate-100 text-slate-600' },
  contact_created: { icon: UserPlus, color: 'bg-green-100 text-green-600' },
};

interface DealActivityTimelineProps {
  dealId: string;
}

export function DealActivityTimeline({ dealId }: DealActivityTimelineProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    if (!workspaceId || !dealId) return;
    let cancelled = false;

    async function fetchActivities() {
      setLoading(true);
      const { data, error } = await supabase
        .from('activities')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!cancelled) {
        if (error) toast.error('Failed to load activities');
        else setActivities(data || []);
        setLoading(false);
      }
    }

    fetchActivities();

    const channel = supabase
      .channel(`deal-activities-${dealId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activities', filter: `deal_id=eq.${dealId}` },
        (payload) => {
          setActivities(prev => [payload.new as ActivityRow, ...prev]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [workspaceId, dealId]);

  const addNote = async () => {
    if (!workspaceId || !noteText.trim()) return;
    setAddingNote(true);

    const { data: user } = await supabase.auth.getUser();

    const { error } = await supabase.from('activities').insert({
      workspace_id: workspaceId,
      type: 'note',
      deal_id: dealId,
      user_id: user?.user?.id || null,
      subject: 'Note added',
      description: noteText.trim(),
    });

    if (error) toast.error('Failed to add note');
    else {
      setNoteText('');
      toast.success('Note added');
    }
    setAddingNote(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add note */}
      <div className="flex gap-2">
        <input
          type="text"
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && noteText.trim()) addNote(); }}
          placeholder="Add a note..."
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={addNote}
          disabled={!noteText.trim() || addingNote}
          className="px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {addingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
        </button>
      </div>

      {/* Timeline */}
      {activities.length === 0 ? (
        <div className="text-center py-6">
          <Activity className="w-6 h-6 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          {activities.map(activity => {
            const config = iconMap[activity.type] || { icon: Activity, color: 'bg-slate-100 text-slate-500' };
            const Icon = config.icon;
            const metadata = activity.metadata as Record<string, string> | null;

            return (
              <div key={activity.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors">
                <div className={`p-1.5 rounded-md mt-0.5 ${config.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">
                    {activity.subject || activity.type.replace(/_/g, ' ')}
                  </p>
                  {activity.type === 'deal_stage_change' && metadata?.from_stage && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {metadata.from_stage} → {metadata.to_stage}
                    </p>
                  )}
                  {activity.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{activity.description}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
