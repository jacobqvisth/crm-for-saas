"use client";

import { useState } from "react";
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

type FilterTab = "all" | "email" | "call" | "deal" | "note";

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "email", label: "Emails" },
  { key: "call", label: "Calls" },
  { key: "deal", label: "Deals" },
  { key: "note", label: "Notes" },
];

const filterMap: Record<FilterTab, string[]> = {
  all: [],
  email: ["email"],
  call: ["call"],
  deal: ["deal_created", "deal_updated"],
  note: ["note"],
};

interface ActivityFeedProps {
  activities: ActivityRow[];
  showFilters?: boolean;
}

export function ActivityFeed({ activities, showFilters = false }: ActivityFeedProps) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [visibleCount, setVisibleCount] = useState(20);

  const filtered =
    filter === "all"
      ? activities
      : activities.filter((a) => filterMap[filter].includes(a.type));

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  if (activities.length === 0) {
    return (
      <div className="text-center py-8">
        <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No recent activity</p>
      </div>
    );
  }

  return (
    <div>
      {showFilters && (
        <div className="flex items-center gap-1 mb-3">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setFilter(tab.key);
                setVisibleCount(20);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === tab.key
                  ? "bg-indigo-50 text-indigo-600"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {visible.map((activity) => {
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

      {hasMore && (
        <button
          onClick={() => setVisibleCount((c) => c + 20)}
          className="w-full mt-3 py-2 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
        >
          Load more
        </button>
      )}
    </div>
  );
}
