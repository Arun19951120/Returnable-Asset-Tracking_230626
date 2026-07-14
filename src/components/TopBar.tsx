"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { Bell, Moon, Sun, Menu, Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { fetchAll } from "@/lib/storage";
import { Notification } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useDarkMode } from "@/lib/useDarkMode";

const TYPE_ICON = {
  info:    { Icon: Info,          cls: "text-blue-500" },
  warning: { Icon: AlertTriangle, cls: "text-amber-500" },
  error:   { Icon: XCircle,       cls: "text-red-500" },
  success: { Icon: CheckCircle2,  cls: "text-emerald-500" },
} as const;

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
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await fetchAll<Notification>("notifications");
    const mine = data
      .filter((n) => !n.forUser || n.forUser === profile?.uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setNotifs(mine);
  }, [profile?.uid]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  // Close dropdown on outside click. Use "click" (not "mousedown") so a click
  // on a dropdown item runs its handler before any close/unmount.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  const unreadCount = notifs.filter((n) => !n.read).length;

  function openFullTab() {
    setOpen(false);
    onNotificationsClick();
  }

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

      {/* Notification bell + dropdown */}
      <div className="relative" ref={wrapRef}>
        <button
          onClick={() => setOpen((v) => !v)}
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

        {open && (
          <div className="animate-fade-up absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Notifications</p>
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">{unreadCount} new</span>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
              {notifs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
              ) : (
                notifs.slice(0, 8).map((n) => {
                  const { Icon, cls } = TYPE_ICON[n.type] ?? TYPE_ICON.info;
                  return (
                    <button
                      key={n.id}
                      onClick={openFullTab}
                      className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${n.read ? "" : "bg-indigo-50/40"}`}
                    >
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-xs ${n.read ? "font-medium text-slate-600" : "font-bold text-slate-800"}`}>{n.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{n.message}</p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                      {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />}
                    </button>
                  );
                })
              )}
            </div>

            <button
              onClick={openFullTab}
              className="w-full border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-center text-xs font-semibold text-indigo-600 hover:bg-slate-100 transition-colors"
            >
              View all in Notifications →
            </button>
          </div>
        )}
      </div>
      </div>
    </header>
  );
}
