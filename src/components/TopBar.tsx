"use client";

import { useEffect, useState, useCallback } from "react";
import { Bell, Moon, Sun } from "lucide-react";
import { fetchAll, updateDocument } from "@/lib/storage";
import { Notification } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useDarkMode } from "@/lib/useDarkMode";

export default function TopBar({
  onNotificationsClick,
}: {
  onNotificationsClick: () => void;
}) {
  const { profile } = useAuth();
  const { dark, toggle } = useDarkMode();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchAll<Notification>("notifications");
    setNotifications(
      data
        .filter((n) => !n.forUser || n.forUser === profile?.uid)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    );
  }, [profile?.uid]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  const unread = notifications.filter((n) => !n.read);

  async function markRead(n: Notification) {
    await updateDocument("notifications", n.id, { read: true });
    load();
  }

  async function markAllRead() {
    await Promise.all(unread.map((n) => updateDocument("notifications", n.id, { read: true })));
    load();
  }

  const TYPE_DOT: Record<string, string> = {
    success: "bg-emerald-500",
    info:    "bg-blue-500",
    warning: "bg-amber-500",
    error:   "bg-red-500",
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-slate-200 bg-white px-6">
      {/* Dark mode toggle */}
      <button
        onClick={toggle}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* Notification bell */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown((v) => !v)}
          title="Notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        >
          <Bell className="h-4 w-4" />
          {unread.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>

        {showDropdown && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />

            {/* Dropdown */}
            <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-xs font-semibold text-slate-700">
                    Notifications
                  </span>
                  {unread.length > 0 && (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-600">
                      {unread.length} unread
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unread.length > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-[10px] font-medium text-blue-600 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    onClick={() => { setShowDropdown(false); onNotificationsClick(); }}
                    className="text-[10px] font-medium text-slate-500 hover:underline"
                  >
                    View all
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                {notifications.length === 0 && (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No notifications
                  </div>
                )}
                {notifications.slice(0, 12).map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                      n.read ? "opacity-50 hover:bg-slate-50" :
                      n.type === "warning" ? "bg-amber-50 border-l-2 border-amber-400 hover:bg-amber-100" :
                      "hover:bg-slate-50"
                    }`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[n.type] ?? "bg-slate-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold truncate ${n.type === "warning" && !n.read ? "text-amber-800" : "text-slate-800"}`}>{n.title}</p>
                      <p className="text-[11px] text-slate-600 whitespace-pre-line">{n.message}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                    </div>
                    {!n.read && (
                      <button
                        onClick={() => markRead(n)}
                        className="shrink-0 mt-0.5 h-5 w-5 rounded-full bg-slate-100 text-slate-400 hover:bg-blue-100 hover:text-blue-600 flex items-center justify-center text-[9px] font-bold transition-colors"
                        title="Mark read"
                      >
                        ✓
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
