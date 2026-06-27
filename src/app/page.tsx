"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import LoginPage from "@/components/LoginPage";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/components/views/Dashboard";
import AssetLedger from "@/components/views/AssetLedger";
import Scanner from "@/components/views/Scanner";
import Transfers from "@/components/views/Transfers";
import CycleReport from "@/components/views/CycleReport";
import AssetMovement from "@/components/views/AssetMovement";
import Orders from "@/components/views/Orders";
import PickupRequests from "@/components/views/PickupRequests";
import Customers from "@/components/views/Customers";
import Projects from "@/components/views/Projects";
import LocationManagement from "@/components/views/LocationManagement";
import HardwareConfig from "@/components/views/HardwareConfig";
import Forecasting from "@/components/views/Forecasting";
import InventoryChart from "@/components/views/InventoryChart";
import Reports from "@/components/views/Reports";
import Notifications from "@/components/views/Notifications";
import AuditLogs from "@/components/views/AuditLogs";
import Administration from "@/components/views/Administration";
import CustomerPortal from "@/components/views/CustomerPortal";
import Gallery from "@/components/views/Gallery";
import ProfitLoss from "@/components/views/ProfitLoss";
import Sustainability from "@/components/views/Sustainability";
import { ALL_TABS } from "@/lib/types";
import { Loader2 } from "lucide-react";
import TopBar from "@/components/TopBar";

const VIEWS: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  assets: AssetLedger,
  scanner: Scanner,
  movements: AssetMovement,
  transfers: Transfers,
  cycles: CycleReport,
  orders: Orders,
  pickups: PickupRequests,
  customers: Customers,
  projects:  Projects,
  locations: LocationManagement,
  hardware:  HardwareConfig,
  forecasting: Forecasting,
  inventory: InventoryChart,
  reports: Reports,
  notifications: Notifications,
  audit: AuditLogs,
  admin: Administration,
  gallery: Gallery,
  pl: ProfitLoss,
  sustainability: Sustainability,
};

export default function App() {
  const { user, loading, allowedTabs } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const isCustomer = user?.role === "Customer";
  const resolvedTab = allowedTabs.includes(activeTab) ? activeTab : allowedTabs[0] ?? "dashboard";
  const ActiveView = (resolvedTab === "dashboard" && isCustomer)
    ? CustomerPortal
    : (VIEWS[resolvedTab] ?? Dashboard);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        activeTab={resolvedTab}
        onTabChange={(tab) => { setActiveTab(tab); setSidebarOpen(false); }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <TopBar
          onNotificationsClick={() => setActiveTab("notifications")}
          onMenuClick={() => setSidebarOpen(true)}
          pageTitle={ALL_TABS.find(t => t.id === resolvedTab)?.label ?? "Dashboard"}
        />
        <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8">
          <ActiveView />
        </main>
      </div>
    </div>
  );
}
