"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Users,
  Building2,
  DollarSign,
  Mail,
  ListChecks,
  FileText,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Search,
  Inbox,
  CheckSquare,
  MapPin,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
};

const staticNavItems: Omit<NavItem, "badge">[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/deals", label: "Deals", icon: DollarSign },
  { href: "/sequences", label: "Sequences", icon: Mail },
  { href: "/lists", label: "Lists", icon: ListChecks },
  { href: "/prospector", label: "Prospector", icon: Search },
  { href: "/discovery", label: "Discovery", icon: MapPin },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tasksDueCount, setTasksDueCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;

    async function fetchUnread() {
      try {
        const res = await fetch("/api/inbox/unread-count");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUnreadCount(data.count ?? 0);
      } catch {
        // Ignore errors for badge fetch
      }
    }

    fetchUnread();
    const interval = setInterval(fetchUnread, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTasksCount() {
      try {
        const res = await fetch("/api/tasks/count");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTasksDueCount(data.count ?? 0);
      } catch {
        // Ignore errors for badge fetch
      }
    }

    fetchTasksCount();
    const interval = setInterval(fetchTasksCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const navItems: NavItem[] = staticNavItems.map((item) => ({
    ...item,
    badge:
      item.href === "/inbox"
        ? unreadCount
        : item.href === "/tasks"
        ? tasksDueCount
        : undefined,
  }));

  return (
    <aside
      className={`flex flex-col bg-white border-r border-slate-200 h-screen sticky top-0 transition-all duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-200">
        <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">C</span>
        </div>
        {!collapsed && (
          <span className="font-semibold text-slate-900 text-lg">CRM</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <div className="relative flex-shrink-0">
                <Icon className="w-5 h-5" />
                {item.badge != null && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-slate-200 p-2 space-y-1">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 w-full transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-red-50 hover:text-red-600 w-full transition-colors"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
