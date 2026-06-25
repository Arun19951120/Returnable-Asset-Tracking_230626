"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, updateDocument } from "@/lib/storage";
import { Notification } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { Bell, CheckCheck, AlertTriangle, Info, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

const TYPE_CONFIG = {
  info:    { icon: Info,          bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-700",   iconColor: "text-blue-500" },
  warning: { icon: AlertTriangle, bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700",  iconColor: "text-amber-500" },
  error:   { icon: XCircle,       bg: "bg-red-50",    border: "border-red-200",    text: "text-red-700",    iconColor: "text-red-500" },
  success: { icon: CheckCircle,   bg: "bg-emerald-50",border: "border-emerald-200",text: "text-emerald-700",iconColor: "text-emerald-500" },
};

export default function Notifications() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const load = useCallback(async () => {
    const data = await fetchAll<Notification>("notifications");
    // Show global notifications + notifications targeted at this user
    const mine = data.filter((n) => !n.forUser || n.forUser === profile?.uid);
    setNotifications(mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markRead(n: Notification) {
    await updateDocument("notifications", n.id, { read: true });
    load();
  }

  async function markAllRead() {
    await Promise.all(notifications.filter((n) => !n.read).map((n) => updateDocument("notifications", n.id, { read: true })));
    toast.success("All notifications marked as read");
    load();
  }

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
              <Bell className="h-5 w-5 text-white" />
            </div>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{unread}</span>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
            <p className="text-sm text-slate-500">{unread} unread · {notifications.length} total</p>
          </div>
        </div>
        {unread > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      <div className="space-y-3">
        {notifications.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-400">
            <Bell className="mx-auto h-8 w-8 mb-2 opacity-30" />
            No notifications
          </div>
        )}
        {notifications.map((n) => {
          const cfg = TYPE_CONFIG[n.type];
          const Icon = cfg.icon;
          return (
            <div key={n.id} className={`flex items-start gap-4 rounded-xl border p-4 transition-opacity ${cfg.bg} ${cfg.border} ${n.read ? "opacity-60" : ""}`}>
              <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${cfg.iconColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`font-semibold text-sm ${cfg.text}`}>{n.title}</p>
                  <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-slate-600 mt-0.5">{n.message}</p>
              </div>
              {!n.read && (
                <button onClick={() => markRead(n)} title="Mark as read"
                  className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-white/60 hover:text-slate-600">
                  <CheckCheck className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
