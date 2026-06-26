"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAll, addDocument, updateDocument, deleteDocument, logAudit } from "@/lib/storage";
import type { Asset, AssetMovement, Order, Transfer, ScheduledReport, AuditLog, Location, Project, Customer } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  FileText, Download, Plus, Trash2, X, Loader2,
  Mail, BarChart2, Clock, ShoppingCart, TrendingUp,
  Package, ArrowRight, Star, Users, LogIn, LogOut, Search, Filter,
  Upload, CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import FilterBar, { DayRange, filterByDays } from "@/components/ui/FilterBar";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function exportCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) { toast.error("No data to export"); return; }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
  toast.success(`${filename} downloaded`);
}

const PIE_COLORS = ["#1e293b", "#475569", "#94a3b8", "#cbd5e1"];

// ─── KPI Analytics Tab ────────────────────────────────────────────────────────
function KPITab({
  assets, orders, transfers, logs, locations, projects, movements,
}: {
  assets: Asset[]; orders: Order[]; transfers: Transfer[];
  logs: AuditLog[]; locations: Location[]; projects: Project[]; movements: AssetMovement[];
}) {
  const [dayRange, setDayRange]       = useState<DayRange>("30");
  const [locationFilter, setLocFilter] = useState("");
  const [projectFilter, setProjFilter] = useState("");

  // Apply filters
  const fAssets = assets.filter((a) =>
    (!locationFilter || a.location === locationFilter) &&
    (!projectFilter  || a.projectId === projectFilter)
  );
  const fOrders    = filterByDays(orders, dayRange).filter((o) =>
    !locationFilter || o.origin === locationFilter || o.destination === locationFilter
  );
  const fTransfers = filterByDays(transfers, dayRange).filter((t) =>
    !locationFilter || t.fromLocation === locationFilter || t.toLocation === locationFilter
  );
  const fLogs      = filterByDays(logs, dayRange, "timestamp");

  // KPIs
  const avgHealth      = fAssets.length ? Math.round(fAssets.reduce((s, a) => s + a.healthScore, 0) / fAssets.length) : 0;
  const emptyVelocity  = fTransfers.filter((t) => t.type === "Inbound Return" && t.status === "Completed").length;
  const dispatches     = fTransfers.filter((t) => t.type === "Outbound Dispatch").length;
  const pendingOrders  = fOrders.filter((o) => o.status === "Pending").length;

  const statusDist = ["Available", "Dispatched", "In-Transit", "Maintenance"].map((s) => ({
    name: s, value: fAssets.filter((a) => a.status === s).length,
  }));

  // Monthly order trend (6 months)
  const monthlyOrders = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
    const m = d.getMonth();
    return {
      month: d.toLocaleString("default", { month: "short" }),
      orders: fOrders.filter((o) => new Date(o.createdAt).getMonth() === m).length,
      transfers: fTransfers.filter((t) => new Date(t.createdAt).getMonth() === m).length,
    };
  });

  const transfersByType = (["Outbound Dispatch","Inbound Return","Inter-plant Transfer","Project Transfer","Site-to-Site Transfer"] as const)
    .map((t) => ({ name: t.replace(" Transfer","").replace("Inter-plant","Inter-plant"), value: fTransfers.filter((x) => x.type === t).length }))
    .filter((t) => t.value > 0);

  const locationNames = locations.filter((l) => l.status === "Active").map((l) => l.name);

  // ── Inventory Turnover Ratio per project ──────────────────────────────────
  const fMovements = filterByDays(movements, dayRange).filter((m) =>
    (m.status === "In-Transit" || m.status === "Completed") &&
    (!locationFilter || m.fromLocation === locationFilter || m.toLocation === locationFilter)
  );

  const turnoverData = projects
    .filter((p) => !projectFilter || p.id === projectFilter)
    .map((proj) => {
      const projAssets = assets.filter((a) => a.projectId === proj.id);
      const dispatched = fMovements.filter((m) => projAssets.some((a) => a.id === m.assetId)).length;
      const total      = projAssets.length;
      const ratio      = total > 0 ? Math.round((dispatched / total) * 10) / 10 : 0;
      return { project: proj.name, dispatched, total, ratio };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.ratio - a.ratio);

  // ── Date-wise: boxes shipped + trips ─────────────────────────────────────
  const fDispatchMovements = fMovements.filter((m) => m.movementType === "Checkout" || m.status === "In-Transit");
  const fDispatchTransfers = filterByDays(transfers, dayRange).filter((t) =>
    t.type === "Outbound Dispatch" &&
    (!locationFilter || t.fromLocation === locationFilter || t.toLocation === locationFilter)
  );

  // Group by date string
  const dateMap = new Map<string, { boxes: number; trips: Set<string> }>();
  fDispatchMovements.forEach((m) => {
    const key = new Date(m.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    if (!dateMap.has(key)) dateMap.set(key, { boxes: 0, trips: new Set() });
    dateMap.get(key)!.boxes += 1;
    dateMap.get(key)!.trips.add(m.fromLocation + "→" + m.toLocation + "_" + m.createdAt.slice(0, 10));
  });
  fDispatchTransfers.forEach((t) => {
    const key = new Date(t.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    if (!dateMap.has(key)) dateMap.set(key, { boxes: 0, trips: new Set() });
    t.assetIds.forEach(() => dateMap.get(key)!.boxes += 0); // already counted via movements
    dateMap.get(key)!.trips.add(t.id); // each Transfer record = 1 trip
  });

  const dateWiseData = [...dateMap.entries()]
    .map(([date, v]) => ({ date, boxes: v.boxes, trips: v.trips.size }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-30); // cap at 30 most recent dates

  return (
    <div className="space-y-5">
      {/* Filters */}
      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        locationFilter={locationFilter} locations={locationNames} onLocationChange={setLocFilter}
        projectFilter={projectFilter} projects={projects.map((p) => ({ id: p.id, name: p.name }))} onProjectChange={setProjFilter}
        extraFilters={
          <button onClick={() => exportCSV(fAssets as unknown as Record<string,unknown>[], "kpi-assets.csv")}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        }
      />

      {/* Active filter labels */}
      {(locationFilter || projectFilter) && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          {locationFilter && <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-white font-medium flex items-center gap-1">{locationFilter}<button onClick={() => setLocFilter("")}><X className="h-2.5 w-2.5 ml-0.5" /></button></span>}
          {projectFilter  && <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-white font-medium flex items-center gap-1">{projects.find((p) => p.id === projectFilter)?.name}<button onClick={() => setProjFilter("")}><X className="h-2.5 w-2.5 ml-0.5" /></button></span>}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Avg Fleet Health",       value: `${avgHealth}%`,  sub: `${fAssets.length} assets`, color: avgHealth >= 75 ? "text-emerald-600" : "text-red-500" },
          { label: "Return Velocity",         value: emptyVelocity,    sub: "Completed inbound returns", color: "text-slate-900" },
          { label: "Outbound Dispatches",     value: dispatches,       sub: "In selected period",        color: "text-slate-900" },
          { label: "Pending Orders",          value: pendingOrders,    sub: "Awaiting approval",         color: pendingOrders > 5 ? "text-amber-600" : "text-slate-900" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-400">{kpi.label}</p>
            <p className={`mt-2 text-3xl font-bold ${kpi.color}`}>{kpi.value}</p>
            <p className="mt-1 text-xs text-slate-500">{kpi.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Asset status pie */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Asset Status Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                label={({ name, value }) => value > 0 ? `${name}: ${value}` : ""} labelLine={false}>
                {statusDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly combined trend */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Monthly Activity Trend</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyOrders} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="orders"    name="Orders"    fill="#1e293b" radius={[3,3,0,0]} />
              <Bar dataKey="transfers" name="Transfers" fill="#94a3b8" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Health distribution */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Fleet Health Distribution</h2>
          <div className="space-y-3">
            {[
              { label: "Healthy (75–100)", count: fAssets.filter((a) => a.healthScore >= 75).length,  color: "bg-emerald-500" },
              { label: "Warning (50–74)",  count: fAssets.filter((a) => a.healthScore >= 50 && a.healthScore < 75).length, color: "bg-amber-400" },
              { label: "Critical (0–49)", count: fAssets.filter((a) => a.healthScore < 50).length,   color: "bg-red-500"   },
            ].map((band) => (
              <div key={band.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600">{band.label}</span>
                  <span className="font-mono font-bold text-slate-700">{band.count}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${band.color}`}
                    style={{ width: fAssets.length ? `${(band.count / fAssets.length) * 100}%` : "0%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transfer types */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Transfers by Type</h2>
          {transfersByType.length === 0
            ? <p className="text-sm text-slate-400 text-center py-8">No transfer data in this period</p>
            : <ResponsiveContainer width="100%" height={220}>
                <BarChart data={transfersByType} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" width={105} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#64748b" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
      </div>

      {/* ── Project-wise Inventory Turnover Ratio ── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <div>
            <h2 className="font-semibold text-slate-800">Project-wise Inventory Turnover Ratio</h2>
            <p className="text-xs text-slate-400">Dispatches ÷ Total assets — higher = more utilisation</p>
          </div>
        </div>
        {turnoverData.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No project data available</p>
        ) : (
          <div className="grid gap-0 divide-y divide-slate-100">
            {/* Chart */}
            <div className="p-5">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={turnoverData} margin={{ top: 5, right: 20, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="project" tick={{ fontSize: 10, fill: "#64748b" }} angle={-20} textAnchor="end" height={45} interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={true} label={{ value: "Ratio", angle: -90, position: "insideLeft", fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip formatter={(v: number | string | ReadonlyArray<number | string> | undefined, name: string | number | undefined) => [v, name === "ratio" ? "Turnover Ratio" : String(name ?? "")] as [React.ReactNode, string]} labelStyle={{ fontWeight: 600 }} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Bar dataKey="ratio" name="Turnover Ratio" radius={[4, 4, 0, 0]}>
                    {turnoverData.map((r, i) => (
                      <Cell key={i} fill={r.ratio >= 2 ? "#10b981" : r.ratio >= 1 ? "#f59e0b" : "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    {["Project", "Total Assets", "Dispatched (Period)", "Turnover Ratio", "Utilisation"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {turnoverData.map((r) => (
                    <tr key={r.project} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{r.project}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{r.total}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{r.dispatched}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          r.ratio >= 2   ? "bg-emerald-100 text-emerald-700" :
                          r.ratio >= 1   ? "bg-amber-100 text-amber-700" :
                                           "bg-slate-100 text-slate-500"
                        }`}>{r.ratio.toFixed(1)}×</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-32 rounded-full bg-slate-100 overflow-hidden">
                            <div className={`h-full rounded-full ${r.ratio >= 2 ? "bg-emerald-500" : r.ratio >= 1 ? "bg-amber-400" : "bg-slate-300"}`}
                              style={{ width: `${Math.min(100, (r.dispatched / r.total) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-mono text-slate-600">{Math.min(100, Math.round((r.dispatched / r.total) * 100))}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Date-wise Boxes Shipped & Trips ── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Package className="h-4 w-4 text-blue-500" />
          <div>
            <h2 className="font-semibold text-slate-800">Date-wise Shipment Summary</h2>
            <p className="text-xs text-slate-400">Boxes shipped and trips per day in the selected period</p>
          </div>
          <button onClick={() => exportCSV(dateWiseData as unknown as Record<string,unknown>[], "datewise-shipments.csv")}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        {dateWiseData.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No shipment data in this period</p>
        ) : (
          <>
            <div className="p-5">
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={dateWiseData} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} angle={-35} textAnchor="end" height={55} interval={Math.floor(dateWiseData.length / 10)} />
                  <YAxis yAxisId="left"  tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} label={{ value: "Boxes", angle: -90, position: "insideLeft", fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} label={{ value: "Trips", angle: 90, position: "insideRight", fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} labelStyle={{ fontWeight: 600 }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                  <Bar yAxisId="left"  dataKey="boxes" name="Boxes Shipped" fill="#3b82f6" radius={[3, 3, 0, 0]} opacity={0.85} />
                  <Line yAxisId="right" type="monotone" dataKey="trips" name="Trips" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Boxes Shipped</th>
                    <th className="px-4 py-3 text-left font-medium">No. of Trips</th>
                    <th className="px-4 py-3 text-left font-medium">Avg Boxes / Trip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...dateWiseData].reverse().map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{row.date}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Package className="h-3.5 w-3.5 text-blue-400" />
                          <span className="font-bold text-slate-800">{row.boxes}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-amber-600">{row.trips}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">
                        {row.trips > 0 ? (row.boxes / row.trips).toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">TOTAL</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800">{dateWiseData.reduce((s, r) => s + r.boxes, 0)}</td>
                    <td className="px-4 py-2.5 font-bold text-amber-700">{dateWiseData.reduce((s, r) => s + r.trips, 0)}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-slate-500">
                      {(() => { const b = dateWiseData.reduce((s, r) => s + r.boxes, 0); const t = dateWiseData.reduce((s, r) => s + r.trips, 0); return t > 0 ? (b / t).toFixed(1) : "—"; })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sales Report Tab ─────────────────────────────────────────────────────────
function SalesTab({
  transfers, assets, locations, projects, movements,
}: {
  transfers: Transfer[]; assets: Asset[]; locations: Location[]; projects: Project[]; movements: AssetMovement[];
}) {
  const [dayRange,      setDayRange]   = useState<DayRange>("30");
  const [destFilter,    setDestFilter] = useState("");
  const [typeFilter,    setTypeFilter] = useState("All");
  const [projectFilter, setProjFilter] = useState("");

  // Master warehouses
  const masterWHs   = locations.filter((l) => l.isMasterWarehouse).map((l) => l.name);
  const activeLocations = locations.filter((l) => l.status === "Active").map((l) => l.name);

  // Base: outbound from any Master Warehouse (Dispatched or Completed)
  const salesBase = transfers.filter((t) =>
    masterWHs.includes(t.fromLocation) &&
    (t.status === "Completed" || t.status === "Approved" || t.type === "Outbound Dispatch")
  );

  // Apply filters
  const filtered = filterByDays(salesBase, dayRange).filter((t) => {
    const matchDest  = !destFilter   || t.toLocation === destFilter;
    const matchType  = typeFilter === "All" || t.type === typeFilter;
    // Project filter: check if any asset in the transfer belongs to that project
    const matchProj  = !projectFilter || t.assetIds.some((id) => {
      const a = assets.find((x) => x.id === id);
      return a?.projectId === projectFilter;
    });
    return matchDest && matchType && matchProj;
  });

  // Summary metrics
  const totalShipments     = filtered.length;
  const totalAssetsShipped = filtered.reduce((s, t) => s + t.assetIds.length, 0);
  const totalValue         = filtered.reduce((sum, t) => {
    return sum + t.assetIds.reduce((s, id) => {
      const a = assets.find((x) => x.id === id);
      return s + (a?.cost ?? 0);
    }, 0);
  }, 0);
  const uniqueDests = [...new Set(filtered.map((t) => t.toLocation))];

  // Destination breakdown
  const destBreakdown = uniqueDests.map((d) => ({
    destination: d,
    shipments:   filtered.filter((t) => t.toLocation === d).length,
    assets:      filtered.filter((t) => t.toLocation === d).reduce((s, t) => s + t.assetIds.length, 0),
  })).sort((a, b) => b.assets - a.assets);

  // Daily shipment trend (last 30 points)
  const trendData = Array.from({ length: 14 }, (_, i) => {
    const d   = new Date();
    d.setDate(d.getDate() - (13 - i));
    const day = d.toLocaleDateString("default", { month: "short", day: "numeric" });
    return {
      day,
      shipments: filtered.filter((t) => new Date(t.createdAt).toDateString() === d.toDateString()).length,
      assets:    filtered.filter((t) => new Date(t.createdAt).toDateString() === d.toDateString()).reduce((s, t) => s + t.assetIds.length, 0),
    };
  });

  // ── Project-wise Sales Value (PO-based, duration-filtered) ───────────────────
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  // Compute cutoff date from dayRange filter
  const cutoffDate = (() => {
    if (dayRange === "all") return null;
    const d = new Date();
    d.setDate(d.getDate() - Number(dayRange));
    return d;
  })();

  const projectSalesData = projects
    .filter((p) => p.contractType !== "agreement")
    .map((proj) => {
      const projAssetIds = new Set(assets.filter((a) => a.projectId === proj.id).map((a) => a.id));
      const qualifiedMovements = movements.filter((m) => {
        if (!projAssetIds.has(m.assetId)) return false;
        if (m.status !== "Completed" && m.status !== "In-Transit") return false;
        if (proj.poCountFromLocation && m.fromLocation !== proj.poCountFromLocation) return false;
        if (proj.poCountToLocation   && m.toLocation   !== proj.poCountToLocation)   return false;
        if (cutoffDate && new Date(m.createdAt) < cutoffDate) return false;
        return true;
      });
      // Sales value: use PO price if set, else fall back to individual asset cost
      let salesValue = 0;
      if (proj.poPrice) {
        const isPack = proj.poBasis === "pack" && (proj.packQty ?? 0) > 0;
        const invoicedUnits = isPack
          ? Math.floor(qualifiedMovements.length / (proj.packQty ?? 1))
          : qualifiedMovements.length;
        salesValue = invoicedUnits * proj.poPrice;
      } else {
        salesValue = qualifiedMovements.reduce((sum, m) => sum + (assetMap.get(m.assetId)?.cost ?? 0), 0);
      }
      return { project: proj.name, value: salesValue, qty: qualifiedMovements.length, hasPoPrice: !!proj.poPrice };
    })
    .filter((r) => r.value > 0 || r.qty > 0)
    .sort((a, b) => b.value - a.value);

  // Smart Y-axis formatter: auto-scale to Thousands / Lakhs / Crores
  const maxSalesValue = Math.max(...projectSalesData.map((r) => r.value), 1);
  const yScale = maxSalesValue >= 1_00_00_000 ? { label: "Cr", div: 1_00_00_000 }
               : maxSalesValue >= 1_00_000    ? { label: "L",  div: 1_00_000 }
               : maxSalesValue >= 1_000       ? { label: "K",  div: 1_000 }
               :                               { label: "",    div: 1 };

  const formatYAxis   = (v: number) => `₹${(v / yScale.div).toFixed(v % yScale.div === 0 ? 0 : 1)}${yScale.label}`;
  const formatTooltip = (v: number) => `₹${v.toLocaleString("en-IN")}`;

  // ── Cumulative sales value line chart ────────────────────────────────────────
  const timeBuckets = (() => {
    const now = new Date();
    if (dayRange === "today") {
      return Array.from({ length: 24 }, (_, h) => {
        const s = new Date(now); s.setHours(h, 0, 0, 0);
        const e = new Date(now); e.setHours(h, 59, 59, 999);
        return { label: `${h}:00`, start: s, end: e };
      });
    }
    if (dayRange === "7" || dayRange === "30") {
      const days = Number(dayRange);
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(now);
        d.setDate(d.getDate() - (days - 1 - i));
        const s = new Date(d); s.setHours(0, 0, 0, 0);
        const e = new Date(d); e.setHours(23, 59, 59, 999);
        return { label: d.toLocaleDateString("default", { month: "short", day: "numeric" }), start: s, end: e };
      });
    }
    if (dayRange === "90") {
      return Array.from({ length: 13 }, (_, i) => {
        const s = new Date(now); s.setDate(s.getDate() - (12 - i) * 7); s.setHours(0, 0, 0, 0);
        const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999);
        return { label: `Wk ${i + 1}`, start: s, end: e };
      });
    }
    if (dayRange === "Q1" || dayRange === "Q2" || dayRange === "Q3" || dayRange === "Q4") {
      const qStart: Record<string, number> = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 };
      const startM = qStart[dayRange];
      const yr = now.getFullYear();
      return Array.from({ length: 3 }, (_, i) => {
        const s = new Date(yr, startM + i, 1);
        const e = new Date(yr, startM + i + 1, 0, 23, 59, 59, 999);
        return { label: s.toLocaleDateString("default", { month: "short" }), start: s, end: e };
      });
    }
    // "all" — last 12 months
    return Array.from({ length: 12 }, (_, i) => {
      const s = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const e = new Date(now.getFullYear(), now.getMonth() - 11 + i + 1, 0, 23, 59, 59, 999);
      return { label: s.toLocaleDateString("default", { month: "short", year: "2-digit" }), start: s, end: e };
    });
  })();

  // Flatten all PO-qualified movements with their value across every project
  const allQualifiedMvts = projects.flatMap((proj) => {
    if (proj.contractType === "agreement") return [];
    const projAssetIds = new Set(assets.filter((a) => a.projectId === proj.id).map((a) => a.id));
    return movements
      .filter((m) => {
        if (!projAssetIds.has(m.assetId)) return false;
        if (m.status !== "Completed" && m.status !== "In-Transit") return false;
        if (proj.poCountFromLocation && m.fromLocation !== proj.poCountFromLocation) return false;
        if (proj.poCountToLocation   && m.toLocation   !== proj.poCountToLocation)   return false;
        if (cutoffDate && new Date(m.createdAt) < cutoffDate) return false;
        return true;
      })
      .map((m) => ({
        date: new Date(m.createdAt),
        value: proj.poPrice ? proj.poPrice : (assetMap.get(m.assetId)?.cost ?? 0),
      }));
  });

  let runningTotal = 0;
  const cumulativeData = timeBuckets.map(({ label, start, end }) => {
    const periodValue = allQualifiedMvts
      .filter((m) => m.date >= start && m.date <= end)
      .reduce((s, m) => s + m.value, 0);
    runningTotal += periodValue;
    return { label, period: periodValue, cumulative: runningTotal };
  });

  const maxCumulative = Math.max(...cumulativeData.map((d) => d.cumulative), 1);
  const cumScale = maxCumulative >= 1_00_00_000 ? { label: "Cr", div: 1_00_00_000 }
                 : maxCumulative >= 1_00_000    ? { label: "L",  div: 1_00_000 }
                 : maxCumulative >= 1_000       ? { label: "K",  div: 1_000 }
                 :                               { label: "",    div: 1 };
  const formatCumY = (v: number) => `₹${(v / cumScale.div).toFixed(v % cumScale.div === 0 ? 0 : 1)}${cumScale.label}`;

  function handleExport() {
    const rows = filtered.map((t) => ({
      id:          t.id,
      date:        new Date(t.createdAt).toLocaleDateString(),
      type:        t.type,
      from:        t.fromLocation,
      destination: t.toLocation,
      assets:      t.assetIds.length,
      asset_ids:   t.assetIds.join(";"),
      carrier:     t.carrier ?? "",
      status:      t.status,
    }));
    exportCSV(rows as Record<string,unknown>[], `sales-report-${dayRange}d.csv`);
  }

  return (
    <div className="space-y-5">
      {/* Master WH indicator */}
      {masterWHs.length > 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Star className="h-5 w-5 text-amber-400 fill-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Sales from Master Warehouse{masterWHs.length > 1 ? "s" : ""}: {masterWHs.join(", ")}
            </p>
            <p className="text-xs text-amber-700">Showing all outbound dispatches originated from this location.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No Master Warehouse configured — go to Locations to designate one.
        </div>
      )}

      {/* Filters */}
      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        locationFilter={destFilter} locations={activeLocations} onLocationChange={setDestFilter}
        projectFilter={projectFilter} projects={projects.map((p) => ({ id: p.id, name: p.name }))} onProjectChange={setProjFilter}
        extraFilters={
          <>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 outline-none">
              <option value="All">All Types</option>
              <option>Outbound Dispatch</option>
              <option>Site-to-Site Transfer</option>
              <option>Project Transfer</option>
            </select>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Total Shipments</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalShipments}</p>
          <p className="mt-1 text-xs text-slate-500">Outbound dispatches</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Assets Shipped</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalAssetsShipped}</p>
          <p className="mt-1 text-xs text-slate-500">Total units dispatched</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Total Declared Value</p>
          <p className="mt-2 text-3xl font-bold text-emerald-700">
            {totalValue ? `₹${totalValue.toLocaleString("en-IN")}` : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Returnable asset value</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Destinations Served</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{uniqueDests.length}</p>
          <p className="mt-1 text-xs text-slate-500">Unique delivery sites</p>
        </div>
      </div>

      {/* Project-wise Sales Value Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-800">Project-wise Sales Value</h2>
          {yScale.label && (
            <span className="ml-auto text-xs text-slate-400 font-mono">Y-axis in ₹{yScale.label === "Cr" ? "Crores" : yScale.label === "L" ? "Lakhs" : "Thousands"}</span>
          )}
        </div>
        <p className="mb-4 text-xs text-slate-400">Based on PO-qualified dispatches within the selected period</p>
        {projectSalesData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Package className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No PO-based sales data in this period</p>
            <p className="text-xs mt-1">Set asset costs and PO configuration per project to see values here</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={projectSalesData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor="#1e293b" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#475569" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="project"
                tick={{ fontSize: 10, fill: "#64748b" }}
                angle={-30}
                textAnchor="end"
                interval={0}
                height={55}
              />
              <YAxis
                tickFormatter={formatYAxis}
                tick={{ fontSize: 10, fill: "#64748b" }}
                width={65}
              />
              <Tooltip
                formatter={(value: number | string | ReadonlyArray<number | string> | undefined) => [formatTooltip(Number(value ?? 0)), "Sales Value"] as [React.ReactNode, string]}
                labelStyle={{ fontWeight: 600, fontSize: 12 }}
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
              />
              <Bar dataKey="value" name="Sales Value" fill="url(#salesGrad)" radius={[4, 4, 0, 0]}>
                {projectSalesData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "#1e293b" : i === 1 ? "#334155" : i === 2 ? "#475569" : "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Cumulative Sales Value Line Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" />
          <h2 className="font-semibold text-slate-800">Cumulative Sales Value</h2>
          {cumScale.label && (
            <span className="ml-auto text-xs text-slate-400 font-mono">
              Y-axis in ₹{cumScale.label === "Cr" ? "Crores" : cumScale.label === "L" ? "Lakhs" : "Thousands"}
            </span>
          )}
        </div>
        <p className="mb-4 text-xs text-slate-400">Running total of PO-based sales across all projects</p>
        {cumulativeData.every((d) => d.cumulative === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <TrendingUp className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-sm">No sales value data in this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={cumulativeData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <defs>
                <linearGradient id="cumAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#64748b" }}
                angle={-30}
                textAnchor="end"
                interval={0}
                height={50}
              />
              <YAxis
                tickFormatter={formatCumY}
                tick={{ fontSize: 10, fill: "#64748b" }}
                width={65}
              />
              <Tooltip
                formatter={(value: number | string | ReadonlyArray<number | string> | undefined, name: string | number | undefined) => [
                  formatTooltip(Number(value ?? 0)),
                  name === "cumulative" ? "Cumulative Sales" : "Period Sales",
                ] as [React.ReactNode, string]}
                labelStyle={{ fontWeight: 600, fontSize: 12 }}
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="period" name="Period Sales" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
              <Line
                type="monotone"
                dataKey="cumulative"
                name="Cumulative Sales"
                stroke="#6366f1"
                strokeWidth={2.5}
                dot={{ fill: "#6366f1", r: 3 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* PO Amendment Summary */}
      {(() => {
        const poProjects = projects.filter((p) => p.contractType !== "agreement" && p.poQty);
        if (!poProjects.length) return null;

        const projAssetMap = new Map<string, Set<string>>();
        assets.forEach((a) => { if (a.projectId) { if (!projAssetMap.has(a.projectId)) projAssetMap.set(a.projectId, new Set()); projAssetMap.get(a.projectId)!.add(a.id); } });

        const rows = poProjects.map((proj) => {
          const projAssetIds = projAssetMap.get(proj.id) ?? new Set<string>();
          const dispatched = movements.filter((m) => {
            if (!projAssetIds.has(m.assetId)) return false;
            if (m.status !== "Completed" && m.status !== "In-Transit") return false;
            if (proj.poCountFromLocation && m.fromLocation !== proj.poCountFromLocation) return false;
            if (proj.poCountToLocation   && m.toLocation   !== proj.poCountToLocation)   return false;
            return true;
          });
          const invoicedUnits = proj.poBasis === "pack" && proj.packQty
            ? Math.floor(dispatched.length / proj.packQty)
            : dispatched.length;
          const poQty      = proj.poQty ?? 0;
          const remaining  = Math.max(0, poQty - invoicedUnits);
          const pct        = poQty ? Math.min(100, Math.round((invoicedUnits / poQty) * 100)) : 0;
          const overrun    = invoicedUnits > poQty;
          const salesValue = proj.poPrice ? invoicedUnits * proj.poPrice : null;
          return { proj, dispatched: dispatched.length, invoicedUnits, poQty, remaining, pct, overrun, salesValue };
        });

        return (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <FileText className="h-4 w-4 text-slate-500" />
              <h2 className="font-semibold text-slate-800">PO Amendment Summary</h2>
              <span className="ml-auto text-xs text-slate-400">{poProjects.length} active PO{poProjects.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    {["Project", "PO No.", "Price/Unit", "PO Qty", "Dispatched", "Invoiced Units", "Sales Value", "Remaining", "Utilization", "PO End Date", "Status"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ proj, dispatched, invoicedUnits, poQty, remaining, pct, overrun, salesValue }) => (
                    <tr key={proj.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{proj.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{proj.poNumber || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {proj.poPrice ? `₹${proj.poPrice.toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-700">{poQty}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{dispatched}</td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-800">
                        {invoicedUnits}
                        {proj.poBasis === "pack" && proj.packQty && (
                          <span className="ml-1 text-[10px] font-normal text-slate-400">({proj.packQty}/pack)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-emerald-700">
                        {salesValue != null ? `₹${salesValue.toLocaleString("en-IN")}` : <span className="text-slate-300 text-xs">Set price</span>}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold">
                        <span className={overrun ? "text-red-600" : "text-emerald-600"}>{overrun ? `+${invoicedUnits - poQty} over` : remaining}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 rounded-full bg-slate-100 overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${overrun ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className={`text-xs font-semibold ${overrun ? "text-red-600" : pct >= 80 ? "text-amber-600" : "text-slate-600"}`}>{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {proj.poEndDate ? new Date(proj.poEndDate).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          overrun          ? "bg-red-100 text-red-700" :
                          pct >= 90        ? "bg-amber-100 text-amber-700" :
                          proj.status === "Closed" ? "bg-slate-100 text-slate-500" :
                          "bg-emerald-100 text-emerald-700"
                        }`}>
                          {overrun ? "Over PO" : pct >= 90 ? "Near Limit" : proj.status === "Closed" ? "Closed" : "Active"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Shipment Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Shipment Ledger</h2>
          <span className="text-xs text-slate-400">{filtered.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {["Date", "Shipment ID", "Type", "From (Master WH)", "Destination", "Assets", "Declared Value", "Carrier", "Status"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No outbound dispatches from Master Warehouse in this period
                  </td>
                </tr>
              )}
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    #{t.id.slice(-8).toUpperCase()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 whitespace-nowrap">
                      {t.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                      <span className="text-xs font-medium text-amber-800">{t.fromLocation}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700 font-medium">{t.toLocation}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Package className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-mono font-bold text-slate-700">{t.assetIds.length}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono font-semibold text-emerald-700">
                    {(() => {
                      const v = t.assetIds.reduce((s, id) => s + (assets.find((a) => a.id === id)?.cost ?? 0), 0);
                      return v ? `₹${v.toLocaleString("en-IN")}` : "—";
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{t.carrier || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.status === "Completed" ? "bg-emerald-100 text-emerald-700" :
                      t.status === "Approved"  ? "bg-sky-100 text-sky-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>{t.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Destination summary footer */}
        {destBreakdown.length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">
            <p className="text-xs text-slate-500 mb-2 font-medium">Destination Summary</p>
            <div className="flex flex-wrap gap-2">
              {destBreakdown.map((d) => (
                <div key={d.destination} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                  <p className="text-xs font-semibold text-slate-700">{d.destination}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{d.shipments} trip{d.shipments !== 1 ? "s" : ""} · {d.assets} asset{d.assets !== 1 ? "s" : ""}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Scheduled Reports Tab ────────────────────────────────────────────────────
function ScheduledTab({ projects }: { projects: Project[] }) {
  const { profile } = useAuth();
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [showForm, setShowForm] = useState(false);
  const EMPTY_REPORT = {
    name: "", type: "Daily Summary" as ScheduledReport["type"],
    frequency: "Daily" as ScheduledReport["frequency"],
    recipients: [""], projectId: "",
    notifyOnOrder: false, notifyOnPickup: false,
  };
  const [newReport, setNewReport] = useState({ ...EMPTY_REPORT });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setReports(await fetchAll<ScheduledReport>("scheduled_reports"));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleEnabled(r: ScheduledReport) {
    await updateDocument("scheduled_reports", r.id, { enabled: !r.enabled });
    load();
  }
  async function deleteReport(r: ScheduledReport) {
    await deleteDocument("scheduled_reports", r.id);
    toast.success("Report deleted"); load();
  }
  async function createReport(e: React.FormEvent) {
    e.preventDefault();
    const recipients = newReport.recipients.filter((r) => r.trim());
    if (!recipients.length) { toast.error("Add at least one recipient"); return; }
    setSaving(true);
    try {
      await addDocument("scheduled_reports", {
        ...newReport,
        recipients,
        projectId: newReport.projectId || undefined,
        enabled: true,
      });
      toast.success("Scheduled report configured");
      setShowForm(false); setNewReport({ ...EMPTY_REPORT }); load();
    } catch { toast.error("Failed to create report"); }
    finally { setSaving(false); }
  }

  const pm = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-4">
      {/* Notification info banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">📧 Email Notification System</p>
        <p>Reports with <strong>Order Notify</strong> or <strong>Pickup Notify</strong> enabled will automatically send emails to recipients when those events occur. <strong>Location Inventory</strong> reports include the full location-wise status breakdown.</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          <Plus className="h-4 w-4" /> Configure Report
        </button>
      </div>
      {reports.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-400">
          <Clock className="mx-auto h-8 w-8 mb-2 opacity-30" /> No scheduled reports configured
        </div>
      )}
      <div className="space-y-3">
        {reports.map((r) => (
          <div key={r.id} className={`rounded-xl border border-slate-200 bg-white px-5 py-4 ${!r.enabled ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <FileText className="h-5 w-5 text-slate-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{r.name}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.type}</span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{r.frequency}</span>
                    {r.projectId && pm[r.projectId] && (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">{pm[r.projectId]}</span>
                    )}
                    {r.notifyOnOrder && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Order alerts</span>
                    )}
                    {r.notifyOnPickup && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">Pickup alerts</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                    <Mail className="h-3 w-3" />
                    {r.recipients.slice(0, 2).join(", ")}{r.recipients.length > 2 ? ` +${r.recipients.length - 2}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.lastSent && <span className="text-xs text-slate-400 font-mono hidden sm:inline">Last: {new Date(r.lastSent).toLocaleDateString()}</span>}
                <button onClick={() => toggleEnabled(r)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${r.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {r.enabled ? "Active" : "Paused"}
                </button>
                <button onClick={() => deleteReport(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h3 className="font-semibold text-slate-900">Configure Scheduled Report</h3>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <form onSubmit={createReport} className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Report Name *</label>
                <input required value={newReport.name} onChange={(e) => setNewReport((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  placeholder="e.g. Weekly Fleet Summary" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Report Type</label>
                  <select value={newReport.type} onChange={(e) => setNewReport((p) => ({ ...p, type: e.target.value as ScheduledReport["type"] }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    <option>Daily Summary</option>
                    <option>Weekly Asset Movement</option>
                    <option>KPI Report</option>
                    <option>Audit Report</option>
                    <option>Location Inventory</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Frequency</label>
                  <select value={newReport.frequency} onChange={(e) => setNewReport((p) => ({ ...p, frequency: e.target.value as ScheduledReport["frequency"] }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    <option>Daily</option><option>Weekly</option><option>Monthly</option>
                  </select>
                </div>
              </div>

              {/* Project scope */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Project Scope</label>
                <select value={newReport.projectId}
                  onChange={(e) => setNewReport((p) => ({ ...p, projectId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                  <option value="">All Projects (no filter)</option>
                  {projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>{proj.name} — {proj.client}</option>
                  ))}
                </select>
                {newReport.type === "Location Inventory" && (
                  <p className="mt-1 text-[10px] text-blue-600">Location Inventory report will include location-wise status breakdown sent to customers.</p>
                )}
              </div>

              {/* Email notification toggles */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Event Notifications (instant email on event)</p>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={newReport.notifyOnOrder}
                    onChange={(e) => setNewReport((p) => ({ ...p, notifyOnOrder: e.target.checked }))}
                    className="rounded" />
                  <div>
                    <span className="text-xs font-medium text-slate-700">Notify on New Order Request</span>
                    <p className="text-[10px] text-slate-400">Send email to recipients when a new order is created</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={newReport.notifyOnPickup}
                    onChange={(e) => setNewReport((p) => ({ ...p, notifyOnPickup: e.target.checked }))}
                    className="rounded" />
                  <div>
                    <span className="text-xs font-medium text-slate-700">Notify on New Pickup Request</span>
                    <p className="text-[10px] text-slate-400">Send email to recipients when a new pickup request is submitted</p>
                  </div>
                </label>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Recipient Emails *</label>
                {newReport.recipients.map((email, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input type="email" value={email}
                      onChange={(e) => { const r = [...newReport.recipients]; r[i] = e.target.value; setNewReport((p) => ({ ...p, recipients: r })); }}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                      placeholder="customer@company.com" />
                    {newReport.recipients.length > 1 && (
                      <button type="button" onClick={() => setNewReport((p) => ({ ...p, recipients: p.recipients.filter((_, j) => j !== i) }))}
                        className="rounded-lg border border-slate-200 px-2 text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setNewReport((p) => ({ ...p, recipients: [...p.recipients, ""] }))}
                  className="text-xs text-slate-500 hover:text-slate-700 underline">+ Add Email</button>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root Reports View ────────────────────────────────────────────────────────
// ─── Customer Movement History Tab ───────────────────────────────────────────
function CustomerHistoryTab({ locations }: { locations: Location[] }) {
  const [movements,  setMovements]  = useState<AssetMovement[]>([]);
  const [customers,  setCustomers]  = useState<Customer[]>([]);
  const [assets,     setAssets]     = useState<Asset[]>([]);

  const [custFilter, setCustFilter] = useState("");
  const [locFilter,  setLocFilter]  = useState("");
  const [dirFilter,  setDirFilter]  = useState<"all"|"received"|"sent">("all");
  const [search,     setSearch]     = useState("");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");

  useEffect(() => {
    Promise.all([
      fetchAll<AssetMovement>("movements"),
      fetchAll<Customer>("customers"),
      fetchAll<Asset>("assets"),
    ]).then(([m, c, a]) => { setMovements(m); setCustomers(c); setAssets(a); });
  }, []);

  const customerSiteLocs = locations.filter((l) => l.type === "Customer_Site").map((l) => l.name);

  const filtered = movements
    .filter((m) => {
      const involvesCustomerSite = customerSiteLocs.includes(m.fromLocation) || customerSiteLocs.includes(m.toLocation);
      if (!involvesCustomerSite) return false;
      if (locFilter && m.fromLocation !== locFilter && m.toLocation !== locFilter) return false;
      if (dirFilter === "received" && !customerSiteLocs.includes(m.toLocation)) return false;
      if (dirFilter === "sent"     && !customerSiteLocs.includes(m.fromLocation)) return false;
      if (search && !m.assetName.toLowerCase().includes(search.toLowerCase())) return false;
      if (dateFrom && m.createdAt < dateFrom) return false;
      if (dateTo   && m.createdAt > dateTo + "T23:59:59") return false;
      if (custFilter) {
        const cust = customers.find((c) => c.id === custFilter);
        if (!cust) return false;
        const custLocNames = locations.filter((l) => l.type === "Customer_Site" && l.name.toLowerCase().includes(cust.name.toLowerCase())).map((l) => l.name);
        if (!custLocNames.includes(m.fromLocation) && !custLocNames.includes(m.toLocation)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const totalReceived = filtered.filter((m) => customerSiteLocs.includes(m.toLocation)).length;
  const totalSent     = filtered.filter((m) => customerSiteLocs.includes(m.fromLocation)).length;
  const completed     = filtered.filter((m) => m.status === "Completed").length;

  function exportCSV() {
    const rows = filtered.map((m) => {
      const a = assets.find((x) => x.id === m.assetId);
      const dir = customerSiteLocs.includes(m.toLocation) ? "Received" : "Sent";
      return {
        date: new Date(m.createdAt).toLocaleDateString("en-IN"),
        asset_name: m.assetName,
        uuid: a?.uuid ?? "",
        direction: dir,
        from: m.fromLocation,
        to: m.toLocation,
        status: m.status,
        completed_date: m.completedAt ? new Date(m.completedAt).toLocaleDateString("en-IN") : "",
        notes: m.notes ?? "",
      };
    });
    if (!rows.length) { toast.error("No data to export"); return; }
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify((r as Record<string, unknown>)[h] ?? "")).join(","))].join("\n");
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `customer-history-${Date.now()}.csv` }).click();
    toast.success("Exported!");
  }

  return (
    <div className="space-y-5">
      {/* KPI summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Records", value: filtered.length, color: "text-slate-900", bg: "bg-slate-50", icon: Filter },
          { label: "Received",      value: totalReceived,   color: "text-emerald-700", bg: "bg-emerald-50", icon: LogIn },
          { label: "Sent Back",     value: totalSent,       color: "text-orange-700", bg: "bg-orange-50", icon: LogOut },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className={`rounded-2xl border border-slate-200 ${bg} p-4 flex items-center gap-4 shadow-sm`}>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">Filter History</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset…"
              className="w-full rounded-xl border border-slate-200 pl-8 pr-3 py-2 text-xs outline-none focus:border-slate-400 bg-slate-50" />
          </div>
          <select value={custFilter} onChange={(e) => setCustFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400 bg-slate-50">
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={locFilter} onChange={(e) => setLocFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400 bg-slate-50">
            <option value="">All Sites</option>
            {locations.filter((l) => l.type === "Customer_Site").map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
          <select value={dirFilter} onChange={(e) => setDirFilter(e.target.value as typeof dirFilter)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400 bg-slate-50">
            <option value="all">All Directions</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400 bg-slate-50" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400 bg-slate-50" />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-400">{filtered.length} record{filtered.length !== 1 ? "s" : ""} · {completed} completed</p>
          <div className="flex gap-2">
            <button onClick={() => { setCustFilter(""); setLocFilter(""); setDirFilter("all"); setSearch(""); setDateFrom(""); setDateTo(""); }}
              className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
              <X className="h-3 w-3" /> Clear
            </button>
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card-bento overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-center">Direction</th>
                <th className="px-4 py-3 text-left">From</th>
                <th className="px-4 py-3 text-left">To</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Completed</th>
                <th className="px-4 py-3 text-left">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <Users className="h-10 w-10 mx-auto text-slate-200 mb-2" />
                    <p className="text-sm text-slate-400">No customer movement records match your filters</p>
                  </td>
                </tr>
              )}
              {filtered.map((m) => {
                const isReceived = customerSiteLocs.includes(m.toLocation);
                const a = assets.find((x) => x.id === m.assetId);
                return (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[140px]">{m.assetName}</p>
                      {a?.uuid && <p className="text-[10px] text-slate-400 font-mono">{a.uuid}</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${isReceived ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>
                        {isReceived ? <><LogIn className="h-2.5 w-2.5" />Received</> : <><LogOut className="h-2.5 w-2.5" />Sent</>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{m.fromLocation}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{m.toLocation}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${m.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {m.completedAt ? new Date(m.completedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[120px] truncate">{m.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Retired Assets Tab ───────────────────────────────────────────────────────
function RetiredAssetsTab({ assets }: { assets: Asset[] }) {
  const retired = assets.filter((a) => a.status === "Retired");
  const categories = ["Damaged", "End of Life", "Lost", "Other"] as const;

  const countByCategory = categories.map((cat) => ({
    cat,
    count: retired.filter((a) => a.retireCategory === cat).length,
  }));

  function doExport() {
    exportCSV(
      retired.map((a) => ({
        Name: a.name,
        UUID: a.uuid,
        Category: a.retireCategory ?? "—",
        Reason: a.retireReason ?? "—",
        Location: a.location,
        RetiredAt: a.retiredAt ? new Date(a.retiredAt).toLocaleString() : "—",
      })),
      "retired-assets.csv"
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Total Retired</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">{retired.length}</p>
        </div>
        {countByCategory.map(({ cat, count }) => (
          <div key={cat} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{cat}</p>
            <p className="mt-1 text-3xl font-bold text-slate-800">{count}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card-bento overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Retired Asset List</h3>
          <button onClick={doExport}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
        {retired.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">No retired assets yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  {["SL No", "Asset Name", "UUID", "Category", "Location", "Notes", "Retired At"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {retired.map((a, i) => (
                  <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.uuid}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.retireCategory === "Damaged" ? "bg-red-100 text-red-700" :
                        a.retireCategory === "End of Life" ? "bg-slate-100 text-slate-600" :
                        a.retireCategory === "Lost" ? "bg-amber-100 text-amber-700" :
                        "bg-purple-100 text-purple-700"
                      }`}>{a.retireCategory ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{a.location}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{a.retireReason || "—"}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {a.retiredAt ? new Date(a.retiredAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CSV Parser (handles JSON.stringify-quoted values from exportCSV) ────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  function parseLine(line: string): string[] {
    const cols: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let val = ""; i++;
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
          else if (line[i] === '"')                    { i++; break; }
          else                                          { val += line[i]; i++; }
        }
        cols.push(val);
        if (line[i] === ",") i++;
      } else {
        const end = line.indexOf(",", i);
        if (end === -1) { cols.push(line.slice(i)); break; }
        cols.push(line.slice(i, end));
        i = end + 1;
      }
    }
    return cols;
  }

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] ?? "").trim(); });
    return row;
  });
}

// ─── Import Movement Section ──────────────────────────────────────────────────
type ImportStatus = "ready" | "duplicate" | "asset_not_found" | "invalid";
interface ImportRow {
  raw: Record<string, string>;
  index: number;
  asset: Asset | null;
  status: ImportStatus;
  reason?: string;
}

function ImportMovementSection({
  assets, projects, existingMovements, onImported, onClose,
}: {
  assets: Asset[];
  projects: Project[];
  existingMovements: AssetMovement[];
  onImported: () => void;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const fileRef   = useRef<HTMLInputElement>(null);
  const [rows,     setRows]     = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const [result,    setResult]    = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  // ── Parse & validate CSV text ─────────────────────────────────────────────
  function parseAndValidate(text: string) {
    const csvRows = parseCSV(text);
    if (!csvRows.length) { toast.error("No data rows found — check the file format"); return; }

    const seen = new Set<string>(); // detect intra-file duplicates

    const parsed: ImportRow[] = csvRows.map((raw, index) => {
      const uuid = (raw["UUID"]       || "").toLowerCase();
      const rfid = (raw["RFID Tag"]   || "").toLowerCase();
      const name = (raw["Asset Name"] || "").toLowerCase();
      const from = (raw["From Location"] || "").trim();
      const to   = (raw["To Location"]   || "").trim();
      const date = (raw["Date"]          || "").trim();

      if (!from || !to)
        return { raw, index, asset: null, status: "invalid" as const, reason: "Missing From or To location" };

      const asset = assets.find((a) =>
        (uuid && a.uuid.toLowerCase() === uuid) ||
        (rfid && (a.rfidTag ?? "").toLowerCase() === rfid) ||
        (name && a.name.toLowerCase() === name)
      ) ?? null;

      if (!asset)
        return { raw, index, asset: null, status: "asset_not_found" as const,
          reason: `Asset not found: "${raw["Asset Name"] || raw["UUID"] || rfid}"` };

      // Intra-file duplicate
      const key = `${asset.id}|${from}|${to}|${date}`;
      if (seen.has(key))
        return { raw, index, asset, status: "duplicate" as const, reason: "Duplicate row within this file" };

      // DB duplicate
      const dbDupe = existingMovements.some(
        (m) => m.assetId === asset.id && m.fromLocation === from &&
               m.toLocation === to && m.createdAt.slice(0, 10) === date
      );
      if (dbDupe)
        return { raw, index, asset, status: "duplicate" as const, reason: "Movement already recorded in system" };

      seen.add(key);
      return { raw, index, asset, status: "ready" as const };
    });

    setRows(parsed);
    setResult(null);
  }

  async function handleFile(file: File) {
    if (!file.name.match(/\.(csv|txt)$/i)) { toast.error("Please upload a CSV file (.csv)"); return; }
    const text = await file.text();
    parseAndValidate(text);
  }

  // ── Confirm import ────────────────────────────────────────────────────────
  async function doImport() {
    const ready = rows.filter((r) => r.status === "ready");
    if (!ready.length) { toast.error("No valid rows to import"); return; }
    setImporting(true);
    let created = 0;
    const errors: string[] = [];

    for (const row of ready) {
      try {
        const { raw, asset } = row;
        const from   = raw["From Location"].trim();
        const to     = raw["To Location"].trim();
        const type   = (["Checkout","Checkin","Transfer"].includes(raw["Type"]) ? raw["Type"] : "Checkout") as "Checkout" | "Checkin" | "Transfer";
        const status = raw["Status"] === "In-Transit" ? "In-Transit" : "Completed" as "In-Transit" | "Completed";
        const isoDate = raw["Date"]
          ? new Date(`${raw["Date"]}T${raw["Time"] || "00:00:00"}`).toISOString()
          : new Date().toISOString();
        const completedAt = status === "Completed"
          ? (raw["Completed At"] ? new Date(raw["Completed At"]).toISOString() : isoDate)
          : undefined;

        await addDocument("movements", {
          assetId:      asset!.id,
          assetName:    asset!.name,
          fromLocation: from,
          toLocation:   to,
          movementType: type,
          status,
          createdBy:    profile?.uid ?? "csv-import",
          createdAt:    isoDate,
          ...(completedAt ? { completedAt, completedBy: profile?.uid ?? "csv-import" } : {}),
          notes:        raw["Notes"] || "Imported from CSV",
        });

        // Update asset location & status
        if (status === "Completed") {
          await updateDocument("assets", asset!.id, { status: "Available", location: to });
        } else {
          await updateDocument("assets", asset!.id, { status: "In-Transit" });
        }

        created++;
      } catch (err: unknown) {
        errors.push(`Row ${row.index + 2}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    // Audit log
    if (created > 0) {
      await logAudit({
        userId:    profile?.uid ?? "",
        userEmail: profile?.email ?? "",
        action:    `CSV Import: ${created} movement record(s) created`,
        category:  "Transfer",
        details:   `Skipped: ${rows.length - ready.length}, Errors: ${errors.length}`,
      }).catch(() => {});
    }

    setImporting(false);
    setResult({ created, skipped: rows.filter((r) => r.status === "duplicate").length, errors });
    if (created > 0) {
      toast.success(`Import complete — ${created} movements created`);
      onImported();
    }
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  const readyCount = rows.filter((r) => r.status === "ready").length;
  const skipCount  = rows.filter((r) => r.status === "duplicate").length;
  const errorCount = rows.filter((r) => r.status === "asset_not_found" || r.status === "invalid").length;

  return (
    <div className="card-bento p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-indigo-600" />
          <h3 className="text-base font-bold text-slate-800">Import Movement Report (CSV)</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Template hint */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-700">
        <p className="font-semibold mb-1">Expected CSV columns:</p>
        <p className="font-mono text-[10px] text-indigo-600 break-all">
          Date, Time, Asset Name, UUID, RFID Tag, BLE Tag, From Location, To Location, Type, Status, Project, Completed At, Created By, Notes
        </p>
        <p className="mt-1.5 text-indigo-500">Use the <strong>CSV Download</strong> from this tab to get the correct format, fill in rows, and re-upload.</p>
      </div>

      {/* Drop zone */}
      {rows.length === 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed py-12 transition-all ${
            dragOver ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
          }`}>
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${dragOver ? "bg-indigo-600" : "bg-slate-100"}`}>
            <Upload className={`h-6 w-6 ${dragOver ? "text-white" : "text-slate-400"}`} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">Drop your CSV file here</p>
            <p className="text-xs text-slate-400 mt-0.5">or click to browse — .csv files only</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && !result && (
        <div className="space-y-4">
          {/* Summary pills */}
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> {readyCount} ready to import
            </span>
            {skipCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> {skipCount} duplicate{skipCount > 1 ? "s" : ""} — will skip
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                <XCircle className="h-3.5 w-3.5" /> {errorCount} error{errorCount > 1 ? "s" : ""} — will skip
              </span>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2.5 text-left">Row</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-left">Asset</th>
                  <th className="px-3 py-2.5 text-left">From</th>
                  <th className="px-3 py-2.5 text-left">To</th>
                  <th className="px-3 py-2.5 text-left">Type</th>
                  <th className="px-3 py-2.5 text-left">Movement Status</th>
                  <th className="px-3 py-2.5 text-left">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.index} className={
                    row.status === "ready"
                      ? "bg-white hover:bg-emerald-50/40"
                      : row.status === "duplicate"
                      ? "bg-amber-50/60 opacity-60"
                      : "bg-red-50/60 opacity-60"
                  }>
                    <td className="px-3 py-2 text-slate-400">{row.index + 2}</td>
                    <td className="px-3 py-2">
                      {row.status === "ready" && (
                        <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                        </span>
                      )}
                      {row.status === "duplicate" && (
                        <span className="flex items-center gap-1 text-amber-600 font-semibold">
                          <AlertTriangle className="h-3.5 w-3.5" /> Duplicate
                        </span>
                      )}
                      {(row.status === "asset_not_found" || row.status === "invalid") && (
                        <span className="flex items-center gap-1 text-red-600 font-semibold">
                          <XCircle className="h-3.5 w-3.5" /> Error
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.raw["Date"] || "—"}</td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-slate-800">{row.raw["Asset Name"] || "—"}</p>
                      <p className="font-mono text-[9px] text-slate-400">{row.raw["UUID"] || row.raw["RFID Tag"] || ""}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.raw["From Location"] || "—"}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{row.raw["To Location"] || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${
                        row.raw["Type"] === "Checkin"  ? "bg-emerald-100 text-emerald-700"
                        : row.raw["Type"] === "Transfer" ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"}`}>
                        {row.raw["Type"] || "Checkout"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${
                        row.raw["Status"] === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {row.raw["Status"] || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400 italic text-[10px] max-w-[180px] truncate">{row.reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button onClick={() => setRows([])}
              className="text-xs text-slate-400 hover:text-slate-600 underline">
              ← Upload a different file
            </button>
            <div className="flex gap-2">
              <button onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={doImport} disabled={importing || readyCount === 0}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-all">
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importing ? "Importing…" : `Import ${readyCount} Record${readyCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div className="space-y-3">
          <div className={`flex items-center gap-3 rounded-2xl p-4 ${result.created > 0 ? "bg-emerald-50 border border-emerald-200" : "bg-amber-50 border border-amber-200"}`}>
            {result.created > 0
              ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
              : <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />}
            <div>
              <p className="font-semibold text-slate-800">
                {result.created > 0 ? `Successfully imported ${result.created} movement record${result.created !== 1 ? "s" : ""}` : "Nothing was imported"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {result.skipped > 0 && `${result.skipped} duplicate${result.skipped !== 1 ? "s" : ""} skipped. `}
                {result.errors.length > 0 && `${result.errors.length} error${result.errors.length !== 1 ? "s" : ""}.`}
              </p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-red-700">Errors:</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-[10px] font-mono text-red-600">{e}</p>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setRows([]); setResult(null); }}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              Import another file
            </button>
            <button onClick={onClose}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Location-to-Location Movement Report Tab ─────────────────────────────────
function LocationMovementTab({
  movements, assets, projects, locations, onRefresh,
}: {
  movements: AssetMovement[];
  assets: Asset[];
  projects: Project[];
  locations: Location[];
  onRefresh: () => void;
}) {
  const [fromLoc,    setFromLoc]    = useState("");
  const [toLoc,      setToLoc]      = useState("");
  const [projectId,  setProjectId]  = useState("");
  const [dayRange,   setDayRange]   = useState<DayRange>("30");
  const [statusFilter, setStatus]   = useState<"" | "In-Transit" | "Completed">("");
  const [showImport,   setShowImport] = useState(false);

  // ── Filtered data ───────────────────────────────────────────────────────────
  const filtered = filterByDays(movements, dayRange).filter((m) => {
    if (fromLoc     && m.fromLocation !== fromLoc) return false;
    if (toLoc       && m.toLocation   !== toLoc)   return false;
    if (statusFilter && m.status      !== statusFilter) return false;
    if (projectId) {
      const asset = assets.find((a) => a.id === m.assetId);
      if (!asset || asset.projectId !== projectId) return false;
    }
    return true;
  });

  // ── KPI tiles ───────────────────────────────────────────────────────────────
  const uniqueAssets = new Set(filtered.map((m) => m.assetId)).size;
  const completed    = filtered.filter((m) => m.status === "Completed").length;
  const inTransit    = filtered.filter((m) => m.status === "In-Transit").length;
  const uniqueRoutes = new Set(filtered.map((m) => `${m.fromLocation}→${m.toLocation}`)).size;

  // ── Chart — daily movement count ────────────────────────────────────────────
  const dailyMap = new Map<string, number>();
  filtered.forEach((m) => {
    const day = m.createdAt.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  });
  const chartData = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date: date.slice(5), count })); // MM-DD for X axis

  // ── Route summary ────────────────────────────────────────────────────────────
  const routeMap = new Map<string, { count: number; assets: Set<string> }>();
  filtered.forEach((m) => {
    const key = `${m.fromLocation} → ${m.toLocation}`;
    const r = routeMap.get(key) ?? { count: 0, assets: new Set() };
    r.count++;
    r.assets.add(m.assetId);
    routeMap.set(key, r);
  });
  const routeSummary = Array.from(routeMap.entries())
    .map(([route, r]) => ({ route, trips: r.count, assets: r.assets.size }))
    .sort((a, b) => b.trips - a.trips);

  // ── CSV Export ───────────────────────────────────────────────────────────────
  function downloadCSV() {
    const rows = filtered.map((m) => {
      const asset  = assets.find((a) => a.id === m.assetId);
      const proj   = projects.find((p) => p.id === asset?.projectId);
      return {
        "Date":         m.createdAt.slice(0, 10),
        "Time":         new Date(m.createdAt).toLocaleTimeString("en-IN"),
        "Asset Name":   m.assetName,
        "UUID":         asset?.uuid ?? "",
        "RFID Tag":     asset?.rfidTag ?? "",
        "BLE Tag":      asset?.bleTag ?? "",
        "From Location": m.fromLocation,
        "To Location":  m.toLocation,
        "Type":         m.movementType,
        "Status":       m.status,
        "Project":      proj?.name ?? "",
        "Completed At": m.completedAt ? m.completedAt.slice(0, 10) : "",
        "Created By":   m.createdBy,
        "Notes":        m.notes ?? "",
      };
    });
    const label = [
      fromLoc ? `From_${fromLoc.replace(/\s+/g, "_")}` : "",
      toLoc   ? `To_${toLoc.replace(/\s+/g, "_")}` : "",
      dayRange,
    ].filter(Boolean).join("_") || "All";
    exportCSV(rows, `Movement_Report_${label}_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  // ── PDF Export ───────────────────────────────────────────────────────────────
  async function downloadPDF() {
    if (!filtered.length) { toast.error("No data to export"); return; }
    try {
      const { jsPDF }   = await import("jspdf");
      const autoTable   = (await import("jspdf-autotable")).default;
      const doc         = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      // Header
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("AKN Returnable Asset Tracking", 14, 14);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("Location-to-Location Movement Report", 14, 20);

      const meta = [
        fromLoc ? `From: ${fromLoc}` : "From: All",
        toLoc   ? `To: ${toLoc}`     : "To: All",
        `Period: ${dayRange}`,
        projectId ? `Project: ${projects.find((p) => p.id === projectId)?.name ?? projectId}` : "Project: All",
        `Generated: ${new Date().toLocaleString("en-IN")}`,
        `Total Records: ${filtered.length}`,
      ].join("   |   ");
      doc.setFontSize(8);
      doc.text(meta, 14, 26, { maxWidth: 260 });

      autoTable(doc, {
        startY: 32,
        head: [["#", "Date", "Asset Name", "UUID", "From Location", "To Location", "Type", "Status", "Project"]],
        body: filtered.map((m, i) => {
          const asset = assets.find((a) => a.id === m.assetId);
          const proj  = projects.find((p) => p.id === asset?.projectId);
          return [
            i + 1,
            m.createdAt.slice(0, 10),
            m.assetName,
            asset?.uuid ?? "",
            m.fromLocation,
            m.toLocation,
            m.movementType,
            m.status,
            proj?.name ?? "—",
          ];
        }),
        styles:    { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(`Page ${i} of ${pageCount} — AKN Returnable Asset Tracking`, 14, doc.internal.pageSize.height - 6);
      }

      const label = [
        fromLoc ? fromLoc.replace(/\s+/g, "_") : "All",
        toLoc   ? toLoc.replace(/\s+/g, "_")   : "All",
        dayRange,
        new Date().toISOString().slice(0, 10),
      ].join("_");
      doc.save(`Movement_Report_${label}.pdf`);
      toast.success("PDF downloaded");
    } catch {
      toast.error("Failed to generate PDF");
    }
  }

  const locNames = Array.from(new Set([
    ...locations.map((l) => l.name),
    ...movements.map((m) => m.fromLocation),
    ...movements.map((m) => m.toLocation),
  ])).filter(Boolean).sort();

  return (
    <div className="space-y-5">
      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="card-bento p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-indigo-600" />
            Location-to-Location Movement Report
          </h2>
          <div className="flex gap-2 flex-wrap">
            <button onClick={downloadCSV}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={downloadPDF}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
            <button onClick={() => setShowImport((v) => !v)}
              className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors ${
                showImport
                  ? "border-violet-400 bg-violet-600 text-white hover:bg-violet-700"
                  : "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"}`}>
              <Upload className="h-3.5 w-3.5" /> Upload & Import
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">From Location</label>
            <select value={fromLoc} onChange={(e) => setFromLoc(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
              <option value="">All locations</option>
              {locNames.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">To Location</label>
            <select value={toLoc} onChange={(e) => setToLoc(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
              <option value="">All locations</option>
              {locNames.filter((l) => l !== fromLoc).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Status</label>
            <select value={statusFilter} onChange={(e) => setStatus(e.target.value as "" | "In-Transit" | "Completed")}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
              <option value="">All statuses</option>
              <option value="Completed">Completed</option>
              <option value="In-Transit">In-Transit</option>
            </select>
          </div>
        </div>

        {/* Period filter */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Period</label>
          <FilterBar dayRange={dayRange} onDayRangeChange={setDayRange} />
        </div>
      </div>

      {/* ── Import panel ────────────────────────────────────────────────────── */}
      {showImport && (
        <ImportMovementSection
          assets={assets}
          projects={projects}
          existingMovements={movements}
          onImported={() => { onRefresh(); setShowImport(false); }}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* ── KPI tiles ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Movements", value: filtered.length,  color: "bg-indigo-600",  light: "bg-indigo-50 text-indigo-700"  },
          { label: "Unique Assets",   value: uniqueAssets,     color: "bg-violet-600",  light: "bg-violet-50 text-violet-700"  },
          { label: "Completed",       value: completed,        color: "bg-emerald-600", light: "bg-emerald-50 text-emerald-700"},
          { label: "In-Transit",      value: inTransit,        color: "bg-amber-500",   light: "bg-amber-50 text-amber-700"    },
        ].map(({ label, value, color, light }) => (
          <div key={label} className="card-bento p-4 flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${color}`}>
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Chart + Route Summary ────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Daily trend chart */}
        <div className="card-bento p-5 lg:col-span-2">
          <h3 className="mb-4 text-sm font-bold text-slate-700">Daily Movement Count</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }}
                  formatter={(v) => [`${v} movements`, "Count"]}
                />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-52 items-center justify-center text-sm text-slate-400">No movement data for selected filters</div>
          )}
        </div>

        {/* Route summary */}
        <div className="card-bento p-5">
          <h3 className="mb-4 text-sm font-bold text-slate-700">
            Top Routes
            <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-600">{uniqueRoutes} unique</span>
          </h3>
          <div className="space-y-2 max-h-[220px] overflow-y-auto">
            {routeSummary.length === 0 && <p className="text-xs text-slate-400">No routes</p>}
            {routeSummary.map(({ route, trips, assets: assetCount }) => (
              <div key={route} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-700">{route}</p>
                  <p className="text-[10px] text-slate-400">{assetCount} asset{assetCount !== 1 ? "s" : ""}</p>
                </div>
                <span className="ml-2 shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{trips}×</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Movement Table ───────────────────────────────────────────────────── */}
      <div className="card-bento overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-bold text-slate-800">
            Movement Records
            <span className="ml-2 text-xs font-normal text-slate-400">{filtered.length} records</span>
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Completed
            <span className="ml-2 h-2 w-2 rounded-full bg-amber-400" /> In-Transit
          </div>
        </div>
        <div className="overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">
              No movements match the selected filters
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left font-semibold">#</th>
                  <th className="px-4 py-3 text-left font-semibold">Date & Time</th>
                  <th className="px-4 py-3 text-left font-semibold">Asset</th>
                  <th className="px-4 py-3 text-left font-semibold">UUID</th>
                  <th className="px-4 py-3 text-left font-semibold">From</th>
                  <th className="px-4 py-3 text-left font-semibold">To</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m, i) => {
                  const asset = assets.find((a) => a.id === m.assetId);
                  const proj  = projects.find((p) => p.id === asset?.projectId);
                  const isCompleted = m.status === "Completed";
                  return (
                    <tr key={m.id} className="hover:bg-indigo-50/40 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-xs font-semibold text-slate-700">{m.createdAt.slice(0, 10)}</p>
                        <p className="text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold text-slate-800">{m.assetName}</p>
                        {asset?.rfidTag && <p className="text-[10px] font-mono text-slate-400">{asset.rfidTag}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{asset?.uuid ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-700">{m.fromLocation}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-800">
                        <span className="flex items-center gap-1">
                          <ArrowRight className="h-3 w-3 text-indigo-400 shrink-0" />
                          {m.toLocation}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          m.movementType === "Checkout" ? "bg-blue-100 text-blue-700"
                          : m.movementType === "Checkin" ? "bg-emerald-100 text-emerald-700"
                          : "bg-purple-100 text-purple-700"}`}>
                          {m.movementType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium w-fit ${
                          isCompleted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isCompleted ? "bg-emerald-500" : "bg-amber-400 animate-pulse"}`} />
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{proj?.name ?? <span className="text-slate-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Reports() {
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [orders,    setOrders]    = useState<Order[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [logs,      setLogs]      = useState<AuditLog[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState<"kpi" | "sales" | "movement" | "customer" | "scheduled" | "retired">("kpi");

  const load = useCallback(async () => {
    const [a, o, t, lg, locs, pr, mv] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<Order>("orders"),
      fetchAll<Transfer>("transfers"),
      fetchAll<AuditLog>("audit_logs"),
      fetchAll<Location>("locations"),
      fetchAll<Project>("projects"),
      fetchAll<AssetMovement>("movements"),
    ]);
    setAssets(a); setOrders(o); setTransfers(t); setLogs(lg);
    setLocations(locs); setProjects(pr); setMovements(mv);
  }, []);

  useEffect(() => { load(); }, [load]);

  const TABS = [
    { id: "kpi"       as const, label: "KPI Analytics",        icon: BarChart2    },
    { id: "sales"     as const, label: "Sales Report",          icon: ShoppingCart },
    { id: "movement"  as const, label: "Movement Report",       icon: ArrowRight   },
    { id: "customer"  as const, label: "Customer History",      icon: Users        },
    { id: "scheduled" as const, label: "Scheduled Reports",     icon: Clock        },
    { id: "retired"   as const, label: "Retired Assets",        icon: Package      },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-800 px-6 py-5 text-white shadow-lg shadow-indigo-200/40">
        <h1 className="text-2xl font-bold">Reports & KPI</h1>
        <p className="mt-1 text-sm text-slate-400">Analytics, customer history, sales performance, and automated reporting</p>
      </div>

      <div className="flex flex-wrap border-b border-slate-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-all ${
              activeTab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            }`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {activeTab === "kpi"       && <KPITab              assets={assets} orders={orders} transfers={transfers} logs={logs} locations={locations} projects={projects} movements={movements} />}
      {activeTab === "sales"     && <SalesTab            transfers={transfers} assets={assets} locations={locations} projects={projects} movements={movements} />}
      {activeTab === "movement"  && <LocationMovementTab movements={movements} assets={assets} projects={projects} locations={locations} onRefresh={load} />}
      {activeTab === "customer"  && <CustomerHistoryTab  locations={locations} />}
      {activeTab === "scheduled" && <ScheduledTab        projects={projects} />}
      {activeTab === "retired"   && <RetiredAssetsTab    assets={assets} />}
    </div>
  );
}
