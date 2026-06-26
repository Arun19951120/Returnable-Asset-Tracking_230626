"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { ALL_TABS, Notification } from "@/lib/types";
import { fetchAll } from "@/lib/storage";
import {
  LayoutDashboard, Package, Camera, ArrowRightLeft, ClipboardList,
  Truck, Building2, MapPin, Brain, BarChart2, Bell, FileText,
  ShieldCheck, LogOut, ChevronRight, Bluetooth, Wifi, Settings2,
  LogIn, RotateCcw, Settings, X,
} from "lucide-react";
import UserProfileDialog from "@/components/dialogs/UserProfileDialog";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard:     LayoutDashboard,
  assets:        Package,
  scanner:       Camera,
  movements:     LogIn,
  transfers:     ArrowRightLeft,
  cycles:        RotateCcw,
  orders:        ClipboardList,
  pickups:       Truck,
  customers:     Building2,
  locations:     MapPin,
  hardware:      Settings2,
  forecasting:   Brain,
  reports:       BarChart2,
  inventory:     BarChart2,
  notifications: Bell,
  audit:         FileText,
  admin:         ShieldCheck,
};

interface DeviceStatus { rfid: boolean; ble: boolean }

export default function Sidebar({
  activeTab, onTabChange, isOpen, onClose,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { profile, allowedTabs, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [devices, setDevices] = useState<DeviceStatus>({ rfid: false, ble: false });
  const [showProfile, setShowProfile] = useState(false);

  // Poll notification count and device status
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

  const visibleTabs = ALL_TABS.filter((t) => allowedTabs.includes(t.id));

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-300 ease-in-out lg:relative lg:z-auto lg:h-screen lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600">
          <Package className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-900">AKN Returnable</p>
          <p className="text-[10px] text-slate-400 font-mono">v3.1.0</p>
        </div>
        {/* Global device status pills */}
        <div className="ml-auto flex items-center gap-1">
          <div className="flex flex-col gap-0.5">
            <span title={`RFID ${devices.rfid ? "connected" : "offline"}`}
              className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${devices.rfid ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"}`}>
              <Wifi className="h-2.5 w-2.5" /> RFID
            </span>
            <span title={`BLE ${devices.ble ? "connected" : "offline"}`}
              className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${devices.ble ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400"}`}>
              <Bluetooth className="h-2.5 w-2.5" /> BLE
            </span>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={onClose}
            className="lg:hidden ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {visibleTabs.map((tab) => {
          const Icon = ICONS[tab.id] ?? LayoutDashboard;
          const active = activeTab === tab.id;

          // Device status indicator for scanner tab
          const isScanner = tab.id === "scanner";
          const isHardware = tab.id === "hardware";
          const anyDeviceOn = devices.rfid || devices.ble;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                active ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
              }`}
            >
              <div className="relative shrink-0">
                <Icon className="h-4 w-4" />
                {/* BLE/RFID link dot on Scanner tab */}
                {isScanner && anyDeviceOn && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 border border-white animate-pulse" />
                )}
                {/* Config indicator on Hardware tab */}
                {isHardware && anyDeviceOn && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-400 border border-white" />
                )}
              </div>

              <span className="flex-1 text-left">{tab.label}</span>

              {/* Device link icons next to Scanner tab */}
              {isScanner && (
                <div className="flex items-center gap-0.5">
                  <span title={`RFID ${devices.rfid ? "linked" : "offline"}`}>
                    <Wifi className={`h-3 w-3 ${devices.rfid ? (active ? "text-blue-300" : "text-blue-400") : (active ? "text-white/20" : "text-slate-300")}`} />
                  </span>
                  <span title={`BLE ${devices.ble ? "linked" : "offline"}`}>
                    <Bluetooth className={`h-3 w-3 ${devices.ble ? (active ? "text-indigo-300" : "text-indigo-400") : (active ? "text-white/20" : "text-slate-300")}`} />
                  </span>
                </div>
              )}

              {/* Notification badge */}
              {tab.id === "notifications" && unreadCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white text-slate-900" : "bg-red-500 text-white"}`}>
                  {unreadCount}
                </span>
              )}

              {active && tab.id !== "notifications" && tab.id !== "scanner" && (
                <ChevronRight className="h-3 w-3 opacity-60" />
              )}
            </button>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProfile(true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left hover:bg-indigo-50 transition-colors"
            title="Profile & User Management"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 uppercase">
              {profile?.displayName?.[0] ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800">{profile?.displayName ?? "—"}</p>
              <p className="truncate text-[10px] text-slate-400 font-mono">{profile?.role}</p>
            </div>
            <Settings className="h-3.5 w-3.5 shrink-0 text-slate-300" />
          </button>
          <button onClick={logout} title="Sign out"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showProfile && <UserProfileDialog onClose={() => setShowProfile(false)} />}
    </aside>
  );
}
