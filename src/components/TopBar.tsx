"use client";

import { useEffect, useCallback } from "react";
import { Bell, Moon, Sun, Menu } from "lucide-react";
import { fetchAll } from "@/lib/storage";
import { Notification } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useDarkMode } from "@/lib/useDarkMode";
import { useState } from "react";

export default function TopBar({
  onNotificationsClick,
  onMenuClick,
  pageTitle,
}: {
  onNotificationsClick: () => void;
  onMenuClick: () => void;
  pageTitle: string;
}) {
  const { profile } = useAuth();
  const { dark, toggle } = useDarkMode();
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    const data = await fetchAll<Notification>("notifications");
    setUnreadCount(
      data.filter((n) => (!n.forUser || n.forUser === profile?.uid) && !n.read).length
    );
  }, [profile?.uid]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white/95 backdrop-blur-sm px-4 md:px-6">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>
      {/* Page title — desktop */}
      <p className="hidden lg:block text-sm font-semibold text-slate-800">{pageTitle}</p>
      <div className="flex items-center gap-2 ml-auto">
      {/* Dark mode toggle */}
      <button
        onClick={toggle}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* Notification bell */}
      <button
        onClick={onNotificationsClick}
        title="Notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      </div>
    </header>
  );
}
