"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Notification } from "@/lib/types";
import { fetchAll } from "@/lib/storage";
import {
  LayoutDashboard, Package, Camera, ArrowRightLeft, ClipboardList,
  Truck, MapPin, Brain, BarChart2, Bell, FileText,
  ShieldCheck, LogOut, Bluetooth, Wifi, Settings2,
  LogIn, RotateCcw, Settings, X, Images, TrendingUp, Leaf,
  FolderKanban, DollarSign, ChevronDown, LogOut as CheckOut,
  Archive,
} from "lucide-react";
import UserProfileDialog from "@/components/dialogs/UserProfileDialog";

interface NavItem {
  /** Display label */
  label: string;
  /** Icon component */
  icon: React.ComponentType<{ className?: string }>;
  /** The tab activated when this item is clicked */
  tabId: string;
  /** The permission key checked against allowedTabs (defaults to tabId) */
  permId?: string;
  /** Unique key for this nav entry (defaults to tabId) */
  navKey?: string;
}

interface NavGroup {
  id: string;
  label: string | null;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "main",
    label: null,
    items: [
      { label: "Dashboard",   icon: LayoutDashboard, tabId: "dashboard" },
    ],
  },
  {
    id: "assets",
    label: "MANAGE ASSETS",
    items: [
      { label: "Inventory",       icon: Package,  tabId: "assets" },
      { label: "Asset Scanner",   icon: Camera,   tabId: "scanner" },
      { label: "Product Gallery", icon: Images,   tabId: "gallery" },
    ],
  },
  {
    id: "transactions",
    label: "TRANSACTIONS",
    items: [
      { label: "Check Out",        icon: LogOut,          tabId: "movements",  permId: "movements",  navKey: "checkout" },
      { label: "Check In",         icon: LogIn,           tabId: "movements",  permId: "movements",  navKey: "checkin" },
      { label: "Transfer",         icon: ArrowRightLeft,  tabId: "transfers",  permId: "transfers" },
      { label: "Cycle Report",     icon: RotateCcw,       tabId: "cycles" },
      { label: "Orders",           icon: ClipboardList,   tabId: "orders" },
      { label: "Pickup Requests",  icon: Truck,           tabId: "pickups" },
    ],
  },
  {
    id: "projects",
    label: "PROJECTS",
    items: [
      { label: "Projects",   icon: FolderKanban, tabId: "projects" },
    ],
  },
  {
    id: "analytics",
    label: "REPORTS & ANALYTICS",
    items: [
      { label: "Inventory Charts", icon: BarChart2,   tabId: "inventory" },
      { label: "Reports & KPI",    icon: BarChart2,   tabId: "reports" },
      { label: "P&L Analysis",     icon: DollarSign,  tabId: "pl" },
      { label: "Sustainability",   icon: Leaf,        tabId: "sustainability" },
      { label: "AI Forecasting",   icon: Brain,       tabId: "forecasting" },
    ],
  },
  {
    id: "admin",
    label: "ADMIN",
    items: [
      { label: "Customers & Locations", icon: MapPin, tabId: "locations" },
      { label: "Hardware Config", icon: Settings2,   tabId: "hardware" },
      { label: "Notifications",   icon: Bell,        tabId: "notifications" },
      { label: "Audit Logs",      icon: FileText,    tabId: "audit" },
      { label: "Administration",  icon: ShieldCheck, tabId: "admin" },
    ],
  },
];

interface DeviceStatus { rfid: boolean; ble: boolean }

export default function Sidebar({
  activeTab, activeNavKey, onTabChange, isOpen, onClose,
}: {
  activeTab: string;
  activeNavKey: string | null;
  onTabChange: (tab: string, navKey?: string) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { profile, allowedTabs, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [devices, setDevices] = useState<DeviceStatus>({ rfid: false, ble: false });
  const [showProfile, setShowProfile] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function refresh() {
      const ns = await fetchAll<Notification>("notifications");
      setUnreadCount(ns.filter((n) => !n.read).length);
      try {
        const res = await fetch("/api/hardware-config");
        if (res.ok) {
          const cfg = await res.json();
          setDevices({ rfid: cfg.rfid?.connected ?? false, ble: cfg.ble?.connected ?? false });
        }
      } catch {}
    }
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, []);

  const allowedSet = new Set(allowedTabs);

  function toggleGroup(id: string) {
    setCollapsed((p) => ({ ...p, [id]: !p[id] }));
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col transition-transform duration-300 ease-in-out lg:relative lg:z-auto lg:h-screen lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      style={{ background: "#0f1117" }}
    >
      {/* ── Brand ── */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl overflow-hidden bg-white shrink-0 shadow-lg shadow-indigo-500/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Rustoppers_Logo.jpg" alt="RSPL Logo" className="h-full w-full object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">RSPL Returnable</p>
          <p className="text-[10px] text-slate-500 font-mono">v3.1.0</p>
        </div>
        <div className="flex flex-col gap-0.5 shrink-0">
          <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${devices.rfid ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-slate-600"}`}>
            <Wifi className="h-2.5 w-2.5" /> RFID
          </span>
          <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${devices.ble ? "bg-violet-500/20 text-violet-400" : "bg-white/5 text-slate-600"}`}>
            <Bluetooth className="h-2.5 w-2.5" /> BLE
          </span>
        </div>
        <button onClick={onClose} className="lg:hidden ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors" aria-label="Close menu">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {NAV_GROUPS.map((group) => {
          // Filter to items this user has permission for
          const visibleItems = group.items.filter((item) =>
            allowedSet.has(item.permId ?? item.tabId)
          );
          // Deduplicate: for movements, only show checkout+checkin once each
          // (both have permId "movements" so both show when movements is allowed)
          if (visibleItems.length === 0) return null;

          const isCollapsed = !!collapsed[group.id];
          const anyDeviceOn = devices.rfid || devices.ble;

          return (
            <div key={group.id}>
              {group.label && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="flex w-full items-center justify-between px-2 pt-4 pb-1 group"
                >
                  <span className="text-[10px] font-bold tracking-widest text-slate-500 group-hover:text-slate-400 transition-colors">
                    {group.label}
                  </span>
                  <ChevronDown className={`h-3 w-3 text-slate-600 transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`} />
                </button>
              )}

              {!isCollapsed && (
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const navKey = item.navKey ?? item.tabId;
                    const Icon = item.icon;
                    // If the item has a navKey, highlight only when that navKey is active.
                    // Otherwise fall back to matching the tabId.
                    const active = item.navKey
                      ? activeNavKey === item.navKey
                      : activeNavKey === null
                        ? activeTab === item.tabId
                        : false;

                    return (
                      <button
                        key={navKey}
                        onClick={() => { onTabChange(item.tabId, item.navKey); onClose(); }}
                        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                          active
                            ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                        }`}
                      >
                        <div className="relative shrink-0">
                          <Icon className="h-4 w-4" />
                          {item.tabId === "scanner" && anyDeviceOn && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 border border-[#0f1117] animate-pulse" />
                          )}
                          {item.tabId === "hardware" && anyDeviceOn && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-400 border border-[#0f1117]" />
                          )}
                        </div>
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.tabId === "scanner" && (
                          <div className="flex items-center gap-0.5">
                            <Wifi className={`h-3 w-3 ${devices.rfid ? "text-blue-400" : "text-slate-700"}`} />
                            <Bluetooth className={`h-3 w-3 ${devices.ble ? "text-violet-400" : "text-slate-700"}`} />
                          </div>
                        )}
                        {item.tabId === "notifications" && unreadCount > 0 && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-red-500 text-white"}`}>
                            {unreadCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── User footer ── */}
      <div className="border-t border-white/5 px-3 py-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProfile(true)}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 text-left hover:bg-white/5 transition-colors"
            title="Profile & Settings"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white uppercase shadow">
              {profile?.displayName?.[0] ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-200">{profile?.displayName ?? "—"}</p>
              <p className="truncate text-[10px] text-slate-500 font-mono">{profile?.role}</p>
            </div>
            <Settings className="h-3.5 w-3.5 shrink-0 text-slate-600" />
          </button>
          <button onClick={logout} title="Sign out"
            className="rounded-xl p-2 text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showProfile && <UserProfileDialog onClose={() => setShowProfile(false)} />}
    </aside>
  );
}
