"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import type { Asset, AssetMovement, AssetCycle, Order, Project, Location } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Package, Truck, ClipboardCheck, Activity, TrendingUp, AlertTriangle,
  LogIn, LogOut, MapPin, BarChart3, Clock, CheckCircle2, ArrowUpDown,
  CheckCheck, Loader2, X, Search, RefreshCw, ArrowRight,
  GripVertical, LayoutDashboard, EyeOff, PlusCircle, Eye,
  Wrench, ShieldAlert, HelpCircle,
} from "lucide-react";
import FilterBar, { DayRange, filterByDays } from "@/components/ui/FilterBar";
import BulkCheckInOutDialog from "@/components/dialogs/BulkCheckInOutDialog";

// ─── Notification helper ───────────────────────────────────────────────────────
function buildDispatchSummary(dispatched: Asset[]): string {
  const map = new Map<string, number>();
  dispatched.forEach((a) => {
    const key = a.description?.trim() || a.name;
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return [...map.entries()].map(([desc, qty]) => `• ${desc} × ${qty}`).join("\n");
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Available:   "bg-emerald-100 text-emerald-700",
    Dispatched:  "bg-blue-100 text-blue-700",
    "In-Transit":"bg-amber-100 text-amber-700",
    Maintenance: "bg-red-100 text-red-700",
    Pending:     "bg-slate-100 text-slate-600",
    Approved:    "bg-sky-100 text-sky-700",
    Received:    "bg-emerald-100 text-emerald-700",
    Completed:   "bg-emerald-100 text-emerald-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

// Animated count-up for KPI numbers — eases from 0 to target on mount/change
function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const duration = 650;
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

function StatCard({ label, value, icon: Icon, sub, color, trend }: {
  label: string; value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  sub?: string; color: string; trend?: string;
}) {
  return (
    <div className="stagger-item card-bento relative overflow-hidden p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
            {typeof value === "number" ? <CountUp value={value} /> : value}
          </p>
          {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
          {trend && <p className="mt-1 text-xs font-medium text-emerald-600">{trend}</p>}
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${color} shadow-sm`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
      <div className={`absolute bottom-0 left-0 h-0.5 w-full opacity-30 ${color}`} />
    </div>
  );
}

// ─── Cycle helpers (mirrors AssetMovement logic) ──────────────────────────────
async function completeCycle(assetId: string, location: string, cycles: AssetCycle[], cycleCount: number) {
  const active = cycles.find((c) => c.assetId === assetId && c.status === "Active");
  if (!active) return;
  await updateDocument("asset_cycles", active.id, {
    status: "Completed", completedAt: new Date().toISOString(),
    durationDays: Math.round((Date.now() - new Date(active.startedAt).getTime()) / 86400000),
    locationsVisited: active.locationsVisited.includes(location)
      ? active.locationsVisited : [...active.locationsVisited, location],
  });
  await updateDocument("assets", assetId, { cycleCount: (cycleCount || 0) + 1 });
}

async function addLocationToCycle(assetId: string, location: string, cycles: AssetCycle[]) {
  const active = cycles.find((c) => c.assetId === assetId && c.status === "Active");
  if (!active || active.locationsVisited.includes(location)) return;
  await updateDocument("asset_cycles", active.id, {
    locationsVisited: [...active.locationsVisited, location],
  });
}

async function startCycle(assetId: string, assetName: string, fromLoc: string, cycles: AssetCycle[]) {
  const num = cycles.filter((c) => c.assetId === assetId).length + 1;
  const id = await addDocument("asset_cycles", {
    assetId, assetName, cycleNumber: num, startedAt: new Date().toISOString(),
    locationsVisited: [fromLoc], status: "Active",
  });
  return id as unknown as string;
}

// ─── Smart Movement Widget (shared between Customer and Admin dashboards) ─────
function SmartMovementWidget({
  myLoc, assets, locations, movements, cycles, profile, masterWH, isManager, onDone,
}: {
  myLoc: string;
  assets: Asset[]; locations: Location[]; movements: AssetMovement[];
  cycles: AssetCycle[];
  profile: ReturnType<typeof useAuth>["profile"];
  masterWH: Location | undefined; isManager: boolean; onDone: () => void;
}) {
  const [receiving,    setReceiving]    = useState<string[]>([]);
  const [receivingAll, setReceivingAll] = useState(false);
  const [dispatchIds,  setDispatchIds]  = useState<string[]>([]);
  const [dispatchTo,   setDispatchTo]   = useState("");
  const [showBulkDC,   setShowBulkDC]   = useState(false);
  const [approving,    setApproving]    = useState(false);
  const [searchQ,      setSearchQ]      = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const incomingMovs = movements.filter(
    (m) => m.status === "In-Transit" && m.toLocation === myLoc
  );
  const noIncoming = incomingMovs.length === 0;
  const availableHere = assets.filter(
    (a) => a.location === myLoc && a.status === "Available"
  ).filter((a) => !searchQ || a.name.toLowerCase().includes(searchQ.toLowerCase()) || a.uuid.toLowerCase().includes(searchQ.toLowerCase()));

  async function doReceive(mov: AssetMovement) {
    const asset = assets.find((a) => a.id === mov.assetId);
    const isMasterTo = masterWH?.name === myLoc;
    await updateDocument("movements", mov.id, {
      status: "Completed", completedBy: profile?.uid ?? "", completedAt: new Date().toISOString(),
    });
    if (isMasterTo) await completeCycle(mov.assetId, myLoc, cycles, asset?.cycleCount ?? 0);
    else await addLocationToCycle(mov.assetId, myLoc, cycles);
    await updateDocument("assets", mov.assetId, { status: "Available", location: myLoc });
    await logAudit({
      userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
      action: `Received: ${mov.assetName} at ${myLoc}${isMasterTo ? " [cycle completed]" : ""}`,
      category: "Transfer", details: mov.assetId,
    });
  }

  async function handleReceiveOne(mov: AssetMovement) {
    setReceiving((p) => [...p, mov.id]);
    try { await doReceive(mov); onDone(); }
    finally { setReceiving((p) => p.filter((x) => x !== mov.id)); }
  }

  async function handleReceiveAll() {
    setReceivingAll(true);
    try {
      for (const m of incomingMovs) await doReceive(m);
      onDone();
    } finally { setReceivingAll(false); }
  }

  async function handleDispatch() {
    if (!dispatchTo || !dispatchIds.length) return;
    setApproving(true);
    try {
      const isMasterFrom = masterWH?.name === myLoc;
      for (const assetId of dispatchIds) {
        const asset = assets.find((a) => a.id === assetId)!;
        let cycleId: string | undefined;
        if (isMasterFrom) cycleId = await startCycle(assetId, asset.name, myLoc, cycles);
        else await addLocationToCycle(assetId, myLoc, cycles);
        const mov: Omit<AssetMovement, "id"> = {
          assetId, assetName: asset.name, fromLocation: myLoc, toLocation: dispatchTo,
          movementType: "Checkout", status: "In-Transit",
          createdBy: profile?.uid ?? "", createdAt: new Date().toISOString(), cycleId,
        };
        await addDocument("movements", mov);
        await updateDocument("assets", assetId, { status: "In-Transit" });
      }
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Dispatched ${dispatchIds.length} asset(s): ${myLoc} → ${dispatchTo}`,
        category: "Transfer", details: dispatchIds.join(", "),
      });
      // Global notification — visible to all users
      try {
        const dispatchedAssets = dispatchIds.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
        const summary = buildDispatchSummary(dispatchedAssets);
        await addDocument("notifications", {
          title: `📦 Incoming Shipment — ${dispatchTo}`,
          message: `${dispatchIds.length} item${dispatchIds.length > 1 ? "s" : ""} dispatched from ${myLoc}:\n${summary}`,
          type: "warning", read: false, createdAt: new Date().toISOString(),
        });
      } catch { /* non-blocking */ }
      setDispatchIds([]); setDispatchTo(""); onDone();
    } finally { setApproving(false); }
  }

  return (
    <div className="space-y-4">
      {/* ── Incoming Shipments ─────────────────────────────────────────────── */}
      {incomingMovs.length > 0 && (
        <div className="rounded-3xl border border-emerald-200 bg-white overflow-hidden shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-5 py-3">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-bold text-emerald-800">
                Incoming Shipments to {myLoc}
              </span>
              <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                {incomingMovs.length} In-Transit
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleReceiveAll} disabled={receivingAll}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {receivingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                Bulk Check-In
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-50 max-h-52 overflow-y-auto">
            {incomingMovs.map((mov) => {
              const isRcv = receiving.includes(mov.id);
              return (
                <div key={mov.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                  <Clock className="h-4 w-4 shrink-0 text-amber-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{mov.assetName}</p>
                    <p className="text-[10px] text-slate-400">
                      From: <span className="font-medium text-slate-600">{mov.fromLocation}</span>
                      {" · "}{new Date(mov.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">In-Transit</span>
                  <button onClick={() => handleReceiveOne(mov)} disabled={isRcv}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    {isRcv ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    Receive
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Block dispatch while incoming shipments are pending ──────────── */}
      {incomingMovs.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span><strong>Check in the {incomingMovs.length} incoming asset{incomingMovs.length > 1 ? "s" : ""} first</strong> — dispatch is locked until all arrivals are received.</span>
        </div>
      )}

      {/* ── Dispatch (send out) — hidden while incoming are pending ────────── */}
      {noIncoming && (
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-orange-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <LogOut className="h-4 w-4 text-orange-600" />
            <span className="text-sm font-bold text-orange-800">Dispatch from {myLoc}</span>
          </div>
          {dispatchIds.length > 0 && (
            <span className="rounded-full bg-orange-200 px-2 py-0.5 text-[10px] font-bold text-orange-800">
              {dispatchIds.length} selected
            </span>
          )}
        </div>

        {/* Search + select */}
        <div className="px-5 py-3 border-b border-slate-100 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input ref={searchRef} value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search assets at this location…"
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-2 text-sm outline-none focus:border-slate-500" />
            </div>
            {dispatchIds.length > 0 && (
              <button onClick={() => setDispatchIds([])} className="rounded-lg border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50">
                Clear
              </button>
            )}
          </div>
          {/* Select all visible */}
          {availableHere.length > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setDispatchIds(availableHere.map((a) => a.id))}
                className="text-[10px] font-semibold text-blue-600 hover:underline">
                Select all ({availableHere.length})
              </button>
              {dispatchIds.length > 0 && <>
                <span className="text-slate-300">·</span>
                <button onClick={() => setDispatchIds([])} className="text-[10px] font-semibold text-slate-400 hover:underline">Clear</button>
              </>}
            </div>
          )}
        </div>

        {/* Asset list */}
        <div className="divide-y divide-slate-50 max-h-44 overflow-y-auto">
          {availableHere.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No available assets at {myLoc}</p>
          ) : availableHere.map((a) => {
            const checked = dispatchIds.includes(a.id);
            return (
              <label key={a.id} className={`flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:bg-slate-50 ${checked ? "bg-orange-50" : ""}`}>
                <input type="checkbox" checked={checked} className="rounded"
                  onChange={() => setDispatchIds((p) => checked ? p.filter((x) => x !== a.id) : [...p, a.id])} />
                <Package className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{a.uuid}</p>
                </div>
              </label>
            );
          })}
        </div>

        {/* Destination + actions */}
        {dispatchIds.length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Dispatch To Location *</label>
              <select value={dispatchTo} onChange={(e) => setDispatchTo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500">
                <option value="">— select destination —</option>
                {locations.filter((l) => l.status === "Active" && l.name !== myLoc).map((l) => (
                  <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleDispatch} disabled={!dispatchTo || approving}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-600 py-2.5 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50">
                {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Dispatch {dispatchIds.length} Asset{dispatchIds.length > 1 ? "s" : ""}
              </button>
              {dispatchIds.length > 1 && (
                <button onClick={() => setShowBulkDC(true)} disabled={!dispatchTo}
                  className="flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-4 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50">
                  + DC
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {noIncoming && showBulkDC && (
        <BulkCheckInOutDialog
          assetIds={dispatchIds}
          locations={locations}
          initialMode="checkout"
          initialDestination={dispatchTo}
          onClose={() => { setShowBulkDC(false); setDispatchIds([]); setDispatchTo(""); onDone(); }}
        />
      )}

    </div>
  );
}

// ─── CUSTOMER DASHBOARD ───────────────────────────────────────────────────────
function CustomerDashboard() {
  const { profile } = useAuth();
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [cycles,    setCycles]    = useState<AssetCycle[]>([]);

  const load = useCallback(async () => {
    const [a, m, l, cy] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<AssetMovement>("movements"),
      fetchAll<Location>("locations"),
      fetchAll<AssetCycle>("asset_cycles"),
    ]);
    setAssets(a); setMovements(m); setLocations(l); setCycles(cy);
  }, []);

  useEffect(() => { load(); }, [load]);

  const myLocs = profile?.allowedLocations ?? [];
  const myLoc  = myLocs[0] ?? "";
  const masterWH = locations.find((l) => l.isMasterWarehouse);

  const myAssets  = assets.filter((a) => myLocs.includes(a.location));
  const available = myAssets.filter((a) => a.status === "Available").length;
  const inTransit = myAssets.filter((a) => a.status === "In-Transit").length;
  const history   = movements
    .filter((m) => myLocs.includes(m.fromLocation) || myLocs.includes(m.toLocation))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const received = history.filter((m) => myLocs.includes(m.toLocation) && m.status === "Completed").length;
  const sent     = history.filter((m) => myLocs.includes(m.fromLocation) && m.status === "Completed").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-800 px-6 py-5 text-white shadow-lg shadow-indigo-200/40">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Customer Portal</p>
            <h1 className="mt-1 text-2xl font-bold">Welcome, {profile?.displayName ?? "Customer"}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {myLocs.length > 0
                ? <><MapPin className="inline h-3.5 w-3.5 mr-1" />{myLocs.join(" · ")}</>
                : "No locations assigned"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold">{myAssets.length}</p>
              <p className="text-xs text-slate-300">Total Assets</p>
            </div>
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold text-emerald-400">{available}</p>
              <p className="text-xs text-slate-300">Available</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Available at Site"  value={available} icon={Package}       sub="Ready for use"       color="bg-emerald-500" />
        <StatCard label="In-Transit to Site" value={inTransit} icon={Truck}         sub="Incoming shipments"  color="bg-blue-500"    />
        <StatCard label="Assets Received"    value={received}  icon={LogIn}         sub="All time completed"  color="bg-teal-500"    />
        <StatCard label="Assets Sent Back"   value={sent}      icon={LogOut}        sub="All time dispatched" color="bg-violet-500"  />
      </div>

      {/* Smart Movement Widget */}
      {myLoc && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-800">Quick Movement — {myLoc}</h2>
          </div>
          <SmartMovementWidget
            myLoc={myLoc}
            assets={assets} locations={locations} movements={movements} cycles={cycles}
            profile={profile} masterWH={masterWH} isManager={false}
            onDone={load}
          />
        </div>
      )}

      {/* Inventory by location */}
      {myLocs.length > 0 && (
        <div className="card-bento">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <BarChart3 className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-800">Current Inventory at Your Location(s)</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {myLocs.map((loc) => {
              const locAssets = assets.filter((a) => a.location === loc);
              const locObj    = locations.find((l) => l.name === loc);
              return (
                <div key={loc} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold text-slate-800">{loc}</span>
                      {locObj?.isMasterWarehouse && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">⭐ Master</span>}
                    </div>
                    <span className="text-sm font-bold text-slate-700">{locAssets.length} total</span>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                    {(["Available","In-Transit","Maintenance","Under Repair","Damaged","Lost"] as const).map((st) => {
                      const cnt = locAssets.filter((a) => a.status === st).length;
                      return (
                        <div key={st} className={`rounded-xl p-3 text-center ${cnt > 0 ? "bg-slate-50 border border-slate-200" : "bg-slate-50/40 border border-dashed border-slate-200 opacity-50"}`}>
                          <p className="text-xl font-bold text-slate-900">{cnt}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{st}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Movement history */}
      <div className="card-bento">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <ArrowUpDown className="h-4 w-4 text-slate-400" />
          <h2 className="font-semibold text-slate-800">Movement History</h2>
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{history.length} records</span>
        </div>
        <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
          {history.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-400">No movement records yet</p>
          )}
          {history.map((m) => {
            const isIncoming = myLocs.includes(m.toLocation);
            return (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isIncoming ? "bg-emerald-100" : "bg-orange-100"}`}>
                  {isIncoming ? <LogIn className="h-3.5 w-3.5 text-emerald-600" /> : <LogOut className="h-3.5 w-3.5 text-orange-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{m.assetName}</p>
                  <p className="text-xs text-slate-500">{isIncoming ? `From ${m.fromLocation}` : `To ${m.toLocation}`}</p>
                </div>
                <StatusBadge status={m.status} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── WIDGET REGISTRY ─────────────────────────────────────────────────────────
type WidgetId = "kpi-strip" | "recent-orders" | "quick-movement" | "location-table" | "asset-condition";

const WIDGET_META: { id: WidgetId; title: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "kpi-strip",        title: "KPI Summary",          desc: "6 live performance indicators",    icon: Activity },
  { id: "asset-condition",  title: "Asset Condition",       desc: "Repair / Damaged / Lost tracker",  icon: ShieldAlert },
  { id: "recent-orders",    title: "Recent Orders",         desc: "Latest orders with status",        icon: ClipboardCheck },
  { id: "quick-movement",   title: "Quick Movement",        desc: "Asset dispatch / receive tool",    icon: RefreshCw },
  { id: "location-table",   title: "Inventory by Location", desc: "Asset breakdown per location",     icon: MapPin },
];

const DASH_LAYOUT_KEY = "akn_dashboard_layout_v1";
const DEFAULT_ORDER: WidgetId[] = ["kpi-strip", "asset-condition", "recent-orders", "quick-movement", "location-table"];

function DashboardWidget({
  title, editMode, myIdx, dragIdx, dropIdx,
  onDragStart, onDragOver, onDrop, onDragEnd, onHide, children,
}: {
  title: string; editMode: boolean;
  myIdx: number; dragIdx: number | null; dropIdx: number | null;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onHide: () => void;
  children: React.ReactNode;
}) {
  const isDragging = dragIdx === myIdx;
  const isTarget   = dropIdx === myIdx && dragIdx !== null && dragIdx !== myIdx;

  return (
    <div
      draggable={editMode}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={`relative transition-all duration-150 ${editMode ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-40 scale-[0.99]" : ""}`}
    >
      {editMode && (
        <>
          <div className={`absolute inset-0 z-10 rounded-2xl pointer-events-none ring-2 ${isTarget ? "ring-indigo-500 bg-indigo-50/40" : "ring-dashed ring-indigo-300"}`} />
          <div className="absolute -top-4 left-4 z-20 flex items-center gap-1.5 rounded-full bg-indigo-600 pl-2 pr-3 py-1 text-[11px] font-semibold text-white shadow-md pointer-events-none select-none">
            <GripVertical className="h-3 w-3 opacity-70" />
            {title}
          </div>
          <button
            onClick={onHide}
            className="absolute -top-4 right-4 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 transition-colors"
            title="Hide widget"
          >
            <EyeOff className="h-3 w-3" />
          </button>
        </>
      )}
      <div className={editMode ? "pt-3" : ""}>{children}</div>
    </div>
  );
}

// ─── ADMIN / STAFF DASHBOARD ──────────────────────────────────────────────────
export default function Dashboard() {
  const { profile } = useAuth();
  if (profile?.role === "Customer") return <CustomerDashboard />;

  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [orders,    setOrders]    = useState<Order[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [cycles,    setCycles]    = useState<AssetCycle[]>([]);
  const [dayRange,       setDayRange]       = useState<DayRange>("30");
  const [projectFilter,  setProjectFilter]  = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [movLoc,         setMovLoc]         = useState("");

  // ── Dashboard layout customization ──────────────────────────────────────────
  const [editMode,       setEditMode]       = useState(false);
  const [widgetOrder,    setWidgetOrder]    = useState<WidgetId[]>(DEFAULT_ORDER);
  const [hiddenWidgets,  setHiddenWidgets]  = useState<WidgetId[]>([]);
  const [dragIdx,        setDragIdx]        = useState<number | null>(null);
  const [dropIdx,        setDropIdx]        = useState<number | null>(null);

  // Load persisted layout once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DASH_LAYOUT_KEY);
      if (raw) {
        const { order, hidden } = JSON.parse(raw) as { order: WidgetId[]; hidden: WidgetId[] };
        if (Array.isArray(order) && order.length) setWidgetOrder(order);
        if (Array.isArray(hidden)) setHiddenWidgets(hidden);
      }
    } catch {}
  }, []);

  function persistLayout(order: WidgetId[], hidden: WidgetId[]) {
    try { localStorage.setItem(DASH_LAYOUT_KEY, JSON.stringify({ order, hidden })); } catch {}
  }

  function hideWidget(id: WidgetId) {
    const newHidden = [...hiddenWidgets, id];
    const newOrder  = widgetOrder.filter((w) => w !== id);
    setHiddenWidgets(newHidden);
    setWidgetOrder(newOrder);
    persistLayout(newOrder, newHidden);
  }

  function showWidget(id: WidgetId) {
    const newHidden = hiddenWidgets.filter((w) => w !== id);
    const newOrder  = [...widgetOrder, id];
    setHiddenWidgets(newHidden);
    setWidgetOrder(newOrder);
    persistLayout(newOrder, newHidden);
  }

  function resetLayout() {
    setWidgetOrder(DEFAULT_ORDER);
    setHiddenWidgets([]);
    persistLayout(DEFAULT_ORDER, []);
  }

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIdx(idx);
  }

  function handleDrop(idx: number) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDropIdx(null); return; }
    const newOrder = [...widgetOrder];
    const [moved]  = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    setWidgetOrder(newOrder);
    persistLayout(newOrder, hiddenWidgets);
    setDragIdx(null);
    setDropIdx(null);
  }

  function handleDragEnd() { setDragIdx(null); setDropIdx(null); }

  const isManager = ["Admin", "Manager"].includes(profile?.role ?? "");

  const load = useCallback(async () => {
    const [a, o, p, l, m, cy] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<Order>("orders"),
      fetchAll<Project>("projects"),
      fetchAll<Location>("locations"),
      fetchAll<AssetMovement>("movements"),
      fetchAll<AssetCycle>("asset_cycles"),
    ]);
    setAssets(a); setOrders(o); setCycles(cy);
    setProjects(p.filter((x) => x.status === "Active"));
    const activeLocs = l.filter((x) => x.status === "Active");
    setLocations(activeLocs);
    setMovements(m);
    // Auto-default movement widget location
    if (!movLoc && activeLocs.length > 0) {
      const wh = activeLocs.find((x) => x.isMasterWarehouse);
      setMovLoc((wh ?? activeLocs[0]).name);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const masterWH = locations.find((l) => l.isMasterWarehouse);

  const filteredAssets = assets.filter((a) => {
    const matchProj = !projectFilter || a.projectId === projectFilter;
    const matchLoc  = !locationFilter || a.location === locationFilter;
    return matchProj && matchLoc;
  });
  const filteredOrders = filterByDays(orders, dayRange).filter(
    (o) => !locationFilter || o.origin === locationFilter || o.destination === locationFilter
  );

  const available   = filteredAssets.filter((a) => a.status === "Available").length;
  const inTransit   = filteredAssets.filter((a) => a.status === "In-Transit").length;
  const maintenance = filteredAssets.filter((a) => a.status === "Maintenance").length;
  const underRepair = filteredAssets.filter((a) => a.status === "Under Repair").length;
  const damaged     = filteredAssets.filter((a) => a.status === "Damaged").length;
  const lost        = filteredAssets.filter((a) => a.status === "Lost").length;
  const avgHealth   = filteredAssets.length
    ? Math.round(filteredAssets.reduce((s, a) => s + a.healthScore, 0) / filteredAssets.length) : 0;
  const recentOrders = filteredOrders.slice(0, 6);
  const projectMap   = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const STATUS_CONFIG = [
    { status: "Available",    color: "bg-emerald-500", light: "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-700" },
    { status: "In-Transit",   color: "bg-amber-500",   light: "bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-700" },
    { status: "Maintenance",  color: "bg-red-500",      light: "bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-700" },
    { status: "Under Repair", color: "bg-orange-500",  light: "bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-700" },
    { status: "Damaged",      color: "bg-rose-600",     light: "bg-rose-50 border-rose-200 dark:bg-rose-900/30 dark:border-rose-700" },
    { status: "Lost",         color: "bg-slate-500",    light: "bg-slate-50 border-slate-300 dark:bg-slate-800/50 dark:border-slate-600" },
  ] as const;

  // Global in-transit count
  const globalInTransit = movements.filter((m) => m.status === "In-Transit").length;

  // ── Widget renderer ─────────────────────────────────────────────────────────
  function renderWidget(id: WidgetId): React.ReactNode {
    switch (id) {
      case "asset-condition": {
        const underRepair = filteredAssets.filter((a) => a.status === "Under Repair");
        const damaged     = filteredAssets.filter((a) => a.status === "Damaged");
        const lost        = filteredAssets.filter((a) => a.status === "Lost");
        const total       = underRepair.length + damaged.length + lost.length;
        return (
          <div className="card-bento">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-400" />
                <h2 className="font-semibold text-slate-800">Asset Condition Tracker</h2>
              </div>
              {total > 0 && (
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-600">
                  {total} at risk
                </span>
              )}
            </div>
            {total === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 opacity-60" />
                <p className="text-sm">All assets in good condition</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {/* Summary row */}
                <div className="grid grid-cols-3 gap-4 px-5 py-4">
                  {[
                    { label: "Under Repair", count: underRepair.length, color: "bg-yellow-50 border-yellow-200", dot: "bg-yellow-400", text: "text-yellow-700", icon: Wrench },
                    { label: "Damaged",      count: damaged.length,     color: "bg-red-50 border-red-200",       dot: "bg-red-500",    text: "text-red-700",    icon: ShieldAlert },
                    { label: "Lost",         count: lost.length,        color: "bg-rose-50 border-rose-200",     dot: "bg-rose-600",   text: "text-rose-800",   icon: HelpCircle },
                  ].map(({ label, count, color, dot, text, icon: Icon }) => (
                    <div key={label} className={`rounded-xl border p-4 text-center ${color}`}>
                      <div className="flex items-center justify-center gap-1.5 mb-1">
                        <span className={`h-2 w-2 rounded-full ${dot}`} />
                        <p className={`text-xs font-semibold ${text}`}>{label}</p>
                      </div>
                      <p className={`text-3xl font-bold ${text}`}>{count}</p>
                      <Icon className={`h-4 w-4 mx-auto mt-1 opacity-40 ${text}`} />
                    </div>
                  ))}
                </div>
                {/* Asset list */}
                {[...underRepair, ...damaged, ...lost].slice(0, 8).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      a.status === "Under Repair" ? "bg-yellow-400"
                      : a.status === "Damaged"    ? "bg-red-500"
                      : "bg-rose-600"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                      {a.conditionNotes && <p className="text-xs text-slate-400 truncate">{a.conditionNotes}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        a.status === "Under Repair" ? "bg-yellow-100 text-yellow-700"
                        : a.status === "Damaged"    ? "bg-red-100 text-red-700"
                        : "bg-rose-100 text-rose-800"
                      }`}>{a.status}</span>
                      <span className="text-[10px] text-slate-400">{a.location}</span>
                    </div>
                  </div>
                ))}
                {total > 8 && (
                  <p className="px-5 py-3 text-xs text-slate-400 text-center">+{total - 8} more — view in Asset Ledger</p>
                )}
              </div>
            )}
          </div>
        );
      }

      case "kpi-strip":
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[
              { label: "Total Assets",  value: filteredAssets.length, sub: "All fleet", icon: Package, color: "bg-slate-700", bar: null },
              { label: "Available",     value: available, sub: `${filteredAssets.length ? Math.round(available/filteredAssets.length*100) : 0}% of fleet`, icon: Activity, color: "bg-emerald-600", bar: { pct: filteredAssets.length ? available/filteredAssets.length*100 : 0, cls: "bg-emerald-500" } },
              { label: "In-Transit",    value: inTransit, sub: "Active shipments", icon: Truck, color: "bg-blue-600", bar: { pct: filteredAssets.length ? inTransit/filteredAssets.length*100 : 0, cls: "bg-blue-500" } },
              { label: "Maintenance",   value: maintenance, sub: maintenance > 0 ? "⚠ Needs attention" : "All clear", icon: AlertTriangle, color: maintenance > 0 ? "bg-red-500" : "bg-slate-500", bar: { pct: filteredAssets.length ? maintenance/filteredAssets.length*100 : 0, cls: "bg-red-500" } },
              { label: "Under Repair",  value: underRepair, sub: underRepair > 0 ? "🔧 In workshop" : "None in repair", icon: AlertTriangle, color: underRepair > 0 ? "bg-orange-500" : "bg-slate-500", bar: { pct: filteredAssets.length ? underRepair/filteredAssets.length*100 : 0, cls: "bg-orange-500" } },
              { label: "Damaged",       value: damaged, sub: damaged > 0 ? "⚠ Needs review" : "None damaged", icon: AlertTriangle, color: damaged > 0 ? "bg-rose-600" : "bg-slate-500", bar: { pct: filteredAssets.length ? damaged/filteredAssets.length*100 : 0, cls: "bg-rose-500" } },
              { label: "Lost",          value: lost, sub: lost > 0 ? "⚠ Unaccounted" : "None lost", icon: AlertTriangle, color: lost > 0 ? "bg-slate-700" : "bg-slate-500", bar: { pct: filteredAssets.length ? lost/filteredAssets.length*100 : 0, cls: "bg-slate-500" } },
              { label: "Fleet Health",  value: `${avgHealth}%`, sub: "Avg health score", icon: Activity, color: avgHealth >= 75 ? "bg-emerald-600" : "bg-red-500", bar: { pct: avgHealth, cls: avgHealth >= 75 ? "bg-emerald-400" : "bg-red-400" } },
            ].map(({ label, value, sub, icon: Icon, color, bar }) => (
              <div key={label} className="stagger-item rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${color}`}>
                    <Icon className="h-3.5 w-3.5 text-white" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {typeof value === "number" ? <CountUp value={value} /> : value}
                </p>
                {bar && (
                  <div className="mt-2 h-1 w-full rounded-full bg-slate-100">
                    <div className={`h-1 rounded-full ${bar.cls} transition-all`} style={{ width: `${Math.min(bar.pct, 100)}%` }} />
                  </div>
                )}
                <p className="mt-1.5 text-xs text-slate-500">{sub}</p>
              </div>
            ))}
          </div>
        );

      case "recent-orders":
        return (
          <div className="card-bento">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-800">Recent Orders</h2>
              <TrendingUp className="h-4 w-4 text-slate-400" />
            </div>
            <div className="divide-y divide-slate-50">
              {recentOrders.length === 0 && (
                <div className="flex flex-col items-center py-10 text-slate-400 gap-2">
                  <ClipboardCheck className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No orders in this period</p>
                </div>
              )}
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
                      <Package className="h-4 w-4 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 font-mono">#{order.id.slice(-8).toUpperCase()}</p>
                      <p className="text-xs text-slate-500">{order.origin} → {order.destination}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleDateString("en-IN")}</span>
                    <StatusBadge status={order.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case "quick-movement":
        return (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-800">Quick Movement</h2>
                {globalInTransit > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    {globalInTransit} in transit globally
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                <select value={movLoc} onChange={(e) => setMovLoc(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-500">
                  <option value="">— select location —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>
                  ))}
                </select>
              </div>
            </div>
            {movLoc ? (
              <SmartMovementWidget
                myLoc={movLoc}
                assets={assets} locations={locations} movements={movements} cycles={cycles}
                profile={profile} masterWH={masterWH} isManager={isManager}
                onDone={load}
              />
            ) : (
              <p className="py-6 text-center text-sm text-slate-400">Select a location to view incoming shipments and dispatch assets</p>
            )}
          </div>
        );

      case "location-table":
        if (!locations.length) return null;
        return (
          <div className="card-bento">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <MapPin className="h-4 w-4 text-slate-400" />
              <h2 className="font-semibold text-slate-800">Inventory by Location</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 text-left">Location</th>
                    <th className="px-4 py-3 text-center">Total</th>
                    <th className="px-4 py-3 text-center">Available</th>
                    <th className="px-4 py-3 text-center">In-Transit</th>
                    <th className="px-4 py-3 text-center">Maintenance</th>
                    <th className="px-4 py-3 text-center">Under Repair</th>
                    <th className="px-4 py-3 text-center">Damaged</th>
                    <th className="px-4 py-3 text-center">Lost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {locations.filter((l) => !locationFilter || l.name === locationFilter).map((loc) => {
                    const la = filteredAssets.filter((a) => a.location === loc.name);
                    if (!la.length) return null;
                    return (
                      <tr key={loc.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${loc.isMasterWarehouse ? "bg-purple-500" : "bg-slate-400"}`} />
                            <span className="font-medium text-slate-800">{loc.name}</span>
                            {loc.isMasterWarehouse && <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-700">MASTER</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-slate-800">{la.length}</td>
                        {(["Available","In-Transit","Maintenance","Under Repair","Damaged","Lost"] as const).map((st) => (
                          <td key={st} className="px-4 py-3 text-center">
                            <span className={la.filter((a) => a.status === st).length > 0 ? "font-semibold text-slate-800" : "text-slate-300"}>
                              {la.filter((a) => a.status === st).length}
                            </span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-800 px-6 py-5 text-white shadow-lg shadow-indigo-200/40">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">RSPL Returnable Asset Tracking</p>
            <h1 className="mt-1 text-2xl font-bold">Operations Dashboard</h1>
            <p className="mt-1 text-sm text-slate-400">
              {new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {filteredOrders.filter((o) => o.status === "Pending").length > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-500/20 border border-amber-400/30 px-4 py-2.5">
                <ClipboardCheck className="h-4 w-4 text-amber-300" />
                <div>
                  <p className="text-lg font-bold text-amber-300">{filteredOrders.filter((o) => o.status === "Pending").length}</p>
                  <p className="text-[10px] text-amber-400 uppercase tracking-wide">Pending Orders</p>
                </div>
              </div>
            )}
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
                editMode
                  ? "bg-white text-indigo-700 shadow-md"
                  : "bg-white/10 text-white hover:bg-white/20 border border-white/20"
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              {editMode ? "Done Editing" : "Customize"}
            </button>
          </div>
        </div>
      </div>

      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        projectFilter={projectFilter} projects={projects.map((p) => ({ id: p.id, name: p.name }))} onProjectChange={setProjectFilter}
        locationFilter={locationFilter} locations={locations.map((l) => l.name)} onLocationChange={setLocationFilter}
      />

      {/* ── Edit mode toolbar ─────────────────────────────────────────────────── */}
      {editMode && (
        <div className="rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/60 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-indigo-600" />
              <p className="text-sm font-semibold text-indigo-800">Dashboard Edit Mode</p>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                Drag to reorder · Click ✕ to hide
              </span>
            </div>
            <button
              onClick={resetLayout}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Reset to default
            </button>
          </div>
          {hiddenWidgets.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">Hidden widgets — click to restore</p>
              <div className="flex flex-wrap gap-2">
                {hiddenWidgets.map((id) => {
                  const meta = WIDGET_META.find((m) => m.id === id)!;
                  const Icon = meta.icon;
                  return (
                    <button
                      key={id}
                      onClick={() => showWidget(id)}
                      className="flex items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-white px-4 py-2.5 text-sm text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400 transition-all group"
                    >
                      <Icon className="h-4 w-4 text-indigo-400 group-hover:text-indigo-600" />
                      <span className="font-medium">{meta.title}</span>
                      <span className="text-xs text-slate-400">{meta.desc}</span>
                      <PlusCircle className="h-4 w-4 text-indigo-400 group-hover:text-indigo-600 ml-1" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {hiddenWidgets.length === 0 && (
            <p className="text-xs text-indigo-400 flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" /> All widgets are visible. Hide widgets using the ✕ button on each card.
            </p>
          )}
        </div>
      )}

      {/* ── Widget grid (draggable in edit mode) ─────────────────────────────── */}
      {widgetOrder.map((id, idx) => {
        const meta = WIDGET_META.find((m) => m.id === id)!;
        const content = renderWidget(id);
        if (content === null || content === undefined) return null;
        return (
          <DashboardWidget
            key={id}
            title={meta.title}
            editMode={editMode}
            myIdx={idx}
            dragIdx={dragIdx}
            dropIdx={dropIdx}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={() => handleDrop(idx)}
            onDragEnd={handleDragEnd}
            onHide={() => hideWidget(id)}
          >
            {content}
          </DashboardWidget>
        );
      })}
    </div>
  );
}
