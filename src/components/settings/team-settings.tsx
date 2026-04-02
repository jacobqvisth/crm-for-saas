"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Mail } from "lucide-react";

interface GmailAccount {
  email_address: string;
  display_name: string | null;
  status: string;
}

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  is_current_user: boolean;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  gmail_accounts: GmailAccount[];
}

function MemberAvatar({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ?? "User"}
        className="w-9 h-9 rounded-full object-cover"
      />
    );
  }

  return (
    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">
      <span className="text-xs font-semibold text-indigo-700">{initials}</span>
    </div>
  );
}

export function TeamSettings() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/team")
      .then((r) => r.json())
      .then((data) => {
        setMembers(data.members ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {members.map((member) => (
        <div
          key={member.id}
          className="flex items-start gap-4 p-4 bg-white rounded-xl border border-slate-200"
        >
          <MemberAvatar name={member.full_name} avatarUrl={member.avatar_url} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-slate-900">
                {member.full_name ?? member.email ?? "Unknown user"}
              </p>
              {member.is_current_user && (
                <span className="text-xs text-slate-400">(You)</span>
              )}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  member.role === "owner"
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {member.role === "owner" ? "Owner" : "Member"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{member.email}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Joined {formatDistanceToNow(new Date(member.joined_at), { addSuffix: true })}
            </p>

            {member.gmail_accounts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {member.gmail_accounts.map((account) => (
                  <span
                    key={account.email_address}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs text-slate-600"
                  >
                    <Mail className="w-3 h-3 text-slate-400" />
                    {account.email_address}
                    <span
                      className={`w-1.5 h-1.5 rounded-full ml-0.5 ${
                        account.status === "active" ? "bg-green-500" : "bg-slate-300"
                      }`}
                    />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
