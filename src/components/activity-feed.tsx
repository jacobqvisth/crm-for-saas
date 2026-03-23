"use client";

import { formatDistanceToNow } from "date-fns";
import {
  Mail,
  Phone,
  MessageSquare,
  UserPlus,
  DollarSign,
  FileText,
  Activity,
} from "lucide-react";
import type { Tables } from "@/lib/database.types";

type ActivityRow = Tables<"activities">;

const iconMap: Record<string, typeof Activity> = {
  email: Mail,
  call: Phone,
  note: MessageSquare,
  contact_created: UserPlus,
  deal_created: DollarSign,
  deal_updated: DollarSign,
  task: FileText,
};

interface ActivityFeedProps {
  activities: ActivityRow[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8">
        <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {activities.map((activity) => {
        const Icon = iconMap[activity.type] || Activity;
        return (
          <div
            key={activity.id}
            className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <div className="p-1.5 bg-slate-100 rounded-md mt-0.5">
              <Icon className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700 truncate">
                {activity.subject || activity.type.replace(/_/g, " ")}
              </p>
              {activity.description && (
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {activity.description}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                {formatDistanceToNow(new Date(activity.created_at), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
