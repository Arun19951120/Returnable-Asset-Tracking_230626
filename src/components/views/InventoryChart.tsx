"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll } from "@/lib/storage";
import type { Asset, Location, Project, Customer } from "@/lib/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { X, Download, Users, MapPin, BarChart3, PieChart as PieIcon, RefreshCw } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  Available:    "#10b981",
  "In-Transit": "#f59e0b",
  Maintenance:  "#ef4444",
};
const STATUSES = ["Available", "In-Transit", "Maintenance"] as const;

function exportCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

export default function InventoryChart() {
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [projectFilter,  setProjectFilter]  = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [viewMode,       setViewMode]       = useState<"location" | "customer">("location");

  const load = useCallback(async () => {
    const [a, l, p, c] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<Location>("locations"),
      fetchAll<Project>("projects"),
      fetchAll<Customer>("customers"),
    ]);
    setAssets(a);
    setLocations(l.filter((x) => x.status === "Active"));
    setProjects(p.filter((x) => x.status === "Active"));
    setCustomers(c.filter((x) => x.status === "Active"));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filtered dataset ───────────────────────────────────────────────────────
  let filteredAssets = assets;
  if (projectFilter) filteredAssets = filteredAssets.filter((a) => a.projectId === projectFilter);
  if (locationFilter) filteredAssets = filteredAssets.filter((a) => a.location === locationFilter);

  // Build per-location chart rows
  const locScope = locationFilter ? locations.filter((l) => l.name === locationFilter) : locations;
  const locChartData = locScope
    .map((loc) => {
      const la = filteredAssets.filter((a) => a.location === loc.name);
      const entry: Record<string, string | number> = { location: loc.name };
      STATUSES.forEach((s) => { entry[s] = la.filter((a) => a.status === s).length; });
      entry.total = la.length;
      entry._top  = 0;
      return entry;
    })
    .filter((d) => (d.total as number) > 0)
    .sort((a, b) => (b.total as number) - (a.total as number));

  // Build per-customer chart rows (customer = user with Customer role + allowedLocations)
  // We need to load users to map customer users → their locations
  // For now we derive "customer" rows by type = Customer_Site
  const customerSites = locations.filter((l) => l.type === "Customer_Site");
  const custChartData = (customerFilter ? customerSites.filter((l) => {
    // crude match — customerFilter is a customer name
    const cust = customers.find((c) => c.id === customerFilter);
    if (!cust) return false;
    return l.name.toLowerCase().includes(cust.name.toLowerCase()) ||
      filteredAssets.some((a) => a.location === l.name && a.customerId === customerFilter);
  }) : customerSites)
    .map((loc) => {
      const la = filteredAssets.filter((a) => a.location === loc.name);
      const entry: Record<string, string | number> = { location: loc.name };
      STATUSES.forEach((s) => { entry[s] = la.filter((a) => a.status === s).length; });
      entry.total = la.length;
      entry._top  = 0;
      return entry;
    })
    .filter((d) => (d.total as number) > 0)
    .sort((a, b) => (b.total as number) - (a.total as number));

  const activeChartData = viewMode === "customer" ? custChartData : locChartData;

  const totals: Record<string, number> = { total: filteredAssets.length };
  STATUSES.forEach((s) => { totals[s] = filteredAssets.filter((a) => a.status === s).length; });
  const pieData = STATUSES.map((s) => ({ name: s, value: totals[s] })).filter((d) => d.value > 0);

  // ── Label renderers ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TotalStackLabel = (props: any) => {
    const x = Number(props.x ?? 0), y = Number(props.y ?? 0), w = Number(props.width ?? 0);
    const idx = Number(props.index ?? 0);
    const total = (activeChartData[idx]?.total as number) ?? 0;
    if (!total || !w) return <g />;
    return (
      <text x={x + w / 2} y={y - 4} fill="#334155" textAnchor="middle" fontSize={10} fontWeight="bold">
        {total}
      </text>
    );
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SegmentLabel = (props: any) => {
    const x = Number(props.x ?? 0), y = Number(props.y ?? 0), w = Number(props.width ?? 0), h = Number(props.height ?? 0);
    const v = Number(props.value ?? 0);
    if (!v || h < 14) return <g />;
    return (
      <text x={x + w / 2} y={y + h / 2 + 4} fill="white" textAnchor="middle" fontSize={9} fontWeight="bold">{v}</text>
    );
  };

  function handleExport() {
    const rows = activeChartData.map((row) => ({
      location: row.location, total: row.total,
      available: row.Available, dispatched: row.Dispatched,
      in_transit: row["In-Transit"], maintenance: row.Maintenance,
    }));
    exportCSV(rows as Record<string, unknown>[], `inventory-${viewMode}-${Date.now()}.csv`);
  }

  const selectedProject = projects.find((p) => p.id === projectFilter);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory Charts</h1>
          <p className="text-sm text-slate-500">
            {viewMode === "location" ? "Location-wise" : "Customer-site"} status breakdown
            {selectedProject ? ` — ${selectedProject.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            <button onClick={() => setViewMode("location")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "location" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              <MapPin className="h-3.5 w-3.5" /> By Location
            </button>
            <button onClick={() => setViewMode("customer")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "customer" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              <Users className="h-3.5 w-3.5" /> By Customer
            </button>
          </div>
          {/* Filters */}
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-500">
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-500">
            <option value="">All Locations</option>
            {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
          {viewMode === "customer" && (
            <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-500">
              <option value="">All Customers</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {(projectFilter || locationFilter || customerFilter) && (
            <button onClick={() => { setProjectFilter(""); setLocationFilter(""); setCustomerFilter(""); }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-slate-400 hover:bg-slate-50">
              <X className="h-4 w-4" />
            </button>
          )}
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Total Assets</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totals.total}</p>
          <p className="mt-0.5 text-xs text-slate-500">{activeChartData.length} location{activeChartData.length !== 1 ? "s" : ""}</p>
        </div>
        {STATUSES.map((s) => (
          <div key={s} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{s}</p>
            <p className="mt-2 text-3xl font-bold" style={{ color: STATUS_COLORS[s] }}>{totals[s]}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {totals.total > 0 ? `${Math.round((totals[s] / totals.total) * 100)}%` : "—"}
            </p>
          </div>
        ))}
      </div>

      {/* Customer×Location matrix (only in customer view) */}
      {viewMode === "customer" && (
        <div className="card-bento overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 bg-gradient-to-r from-slate-50 to-white">
            <Users className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-800">Customer × Location Inventory</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3 text-left">Customer Site</th>
                  <th className="px-4 py-3 text-center">Total</th>
                  {STATUSES.map((s) => (
                    <th key={s} className="px-4 py-3 text-center" style={{ color: STATUS_COLORS[s] }}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {custChartData.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-xs">No customer-site inventory data</td></tr>
                )}
                {custChartData.map((row) => {
                  const locObj = locations.find((l) => l.name === row.location);
                  const assetList = filteredAssets.filter((a) => a.location === row.location);
                  // Try to find customer from assets at this location
                  const custId = assetList.find((a) => a.customerId)?.customerId;
                  const custObj = customers.find((c) => c.id === custId);
                  return (
                    <tr key={row.location as string} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-800">{row.location as string}</p>
                        {custObj && <p className="text-[10px] text-slate-400 mt-0.5">Customer: {custObj.name}</p>}
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700 font-medium">
                          {locObj?.type?.replace(/_/g, " ") ?? "Site"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-bold font-mono text-slate-800">{row.total as number}</td>
                      {STATUSES.map((s) => (
                        <td key={s} className="px-4 py-3 text-center">
                          {(row[s] as number) > 0 ? (
                            <span className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold"
                              style={{ backgroundColor: STATUS_COLORS[s] + "25", color: STATUS_COLORS[s] }}>
                              {row[s] as number}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {custChartData.length > 0 && (
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-5 py-3 text-slate-700">TOTAL</td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-900">
                      {custChartData.reduce((s, r) => s + (r.total as number), 0)}
                    </td>
                    {STATUSES.map((s) => (
                      <td key={s} className="px-4 py-3 text-center font-mono font-bold" style={{ color: STATUS_COLORS[s] }}>
                        {custChartData.reduce((sum, r) => sum + (r[s] as number), 0)}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-800">
              {viewMode === "location" ? "Location" : "Customer Site"}-wise Status (Stacked)
            </h2>
          </div>
          {activeChartData.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <BarChart3 className="h-10 w-10 opacity-30" />
              <p className="text-sm">No inventory data for this selection</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={activeChartData} margin={{ top: 22, right: 16, left: 0, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="location" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={(value, name) => [value, name]} labelStyle={{ fontWeight: 600 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {STATUSES.map((s) => (
                  <Bar key={s} dataKey={s} stackId="a" fill={STATUS_COLORS[s]} name={s} radius={s === "Maintenance" ? [3, 3, 0, 0] : [0, 0, 0, 0]}>
                    <LabelList dataKey={s} content={SegmentLabel} />
                  </Bar>
                ))}
                <Bar dataKey="_top" stackId="a" fill="none" legendType="none" isAnimationActive={false} label={TotalStackLabel} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <PieIcon className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-800">Overall Split</h2>
          </div>
          {pieData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-16">No data</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={({ name, value, percent }) => `${name}: ${value} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                    labelLine>
                    {pieData.map((entry, i) => <Cell key={i} fill={STATUS_COLORS[entry.name]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-2">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[d.name] }} />
                    <span className="flex-1 text-slate-600">{d.name}</span>
                    <span className="font-mono font-bold text-slate-700">{d.value}</span>
                    <span className="text-slate-400">{totals.total > 0 ? `${Math.round(d.value / totals.total * 100)}%` : ""}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Location detail table */}
      <div className="card-bento overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-800">Location Inventory Detail</h2>
          </div>
          <span className="text-xs text-slate-400">{locChartData.length} locations with assets</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-center">Total</th>
                {STATUSES.map((s) => <th key={s} className="px-4 py-3 text-center" style={{ color: STATUS_COLORS[s] }}>{s}</th>)}
                <th className="px-4 py-3 text-right">% Fleet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {locChartData.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-slate-400 text-xs">No inventory data</td></tr>
              )}
              {locChartData.map((row) => {
                const locObj = locations.find((l) => l.name === row.location);
                return (
                  <tr key={row.location as string} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        {locObj?.isMasterWarehouse && <span className="text-purple-500">⭐</span>}
                        {row.location as string}
                        {locObj?.isMasterWarehouse && <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-700">MASTER</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        {locObj?.type?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-bold font-mono text-slate-700">{row.total as number}</td>
                    {STATUSES.map((s) => (
                      <td key={s} className="px-4 py-3 text-center">
                        {(row[s] as number) > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold"
                            style={{ backgroundColor: STATUS_COLORS[s] + "20", color: STATUS_COLORS[s] }}>
                            {row[s] as number}
                          </span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-500">
                      {totals.total > 0 ? `${((row.total as number / totals.total) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
              {locChartData.length > 0 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-5 py-3 text-slate-700">TOTAL</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-center font-mono font-bold text-slate-900">{totals.total}</td>
                  {STATUSES.map((s) => (
                    <td key={s} className="px-4 py-3 text-center font-mono font-bold" style={{ color: STATUS_COLORS[s] }}>{totals[s]}</td>
                  ))}
                  <td className="px-4 py-3 text-right text-slate-500">100%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
