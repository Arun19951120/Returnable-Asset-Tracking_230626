"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll } from "@/lib/storage";
import type { Asset, AssetCycle, Project } from "@/lib/types";
import {
  RotateCcw, Download, Search, CheckCircle2, RefreshCw,
  Calendar, MapPin, TrendingUp,
} from "lucide-react";

export default function CycleReport() {
  const [cycles,   setCycles]   = useState<AssetCycle[]>([]);
  const [assets,   setAssets]   = useState<Asset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [assetFilter,   setAssetFilter]   = useState("");
  const [statusFilter,  setStatusFilter]  = useState<"All"|"Active"|"Completed">("All");
  const [projectFilter, setProjectFilter] = useState("");

  const load = useCallback(async () => {
    const [cy, a, p] = await Promise.all([
      fetchAll<AssetCycle>("asset_cycles"),
      fetchAll<Asset>("assets"),
      fetchAll<Project>("projects"),
    ]);
    setCycles(cy); setAssets(a); setProjects(p.filter((x) => x.status === "Active"));
  }, []);

  useEffect(() => { load(); }, [load]);

  const enriched = cycles.map((c) => {
    const a    = assets.find((x) => x.id === c.assetId);
    const proj = projects.find((p) => p.id === a?.projectId);
    return { ...c, asset: a, project: proj };
  });

  const filtered = enriched
    .filter((c) => !assetFilter || c.assetName.toLowerCase().includes(assetFilter.toLowerCase()) || c.asset?.uuid.toLowerCase().includes(assetFilter.toLowerCase()))
    .filter((c) => statusFilter === "All" || c.status === statusFilter)
    .filter((c) => !projectFilter || c.asset?.projectId === projectFilter)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const totalCompleted = cycles.filter((c) => c.status === "Completed").length;
  const totalActive    = cycles.filter((c) => c.status === "Active").length;
  const avgDuration    = cycles.filter((c) => c.durationDays != null).length
    ? Math.round(cycles.filter((c) => c.durationDays != null).reduce((s, c) => s + (c.durationDays ?? 0), 0)
        / cycles.filter((c) => c.durationDays != null).length)
    : 0;
  const maxCycleAsset  = assets.reduce(
    (best, a) => ((a.cycleCount ?? 0) > (best.cycleCount ?? 0) ? a : best),
    assets[0] ?? ({} as Asset)
  );

  function exportCSV() {
    const rows = filtered.map((c) => ({
      asset: c.assetName, uuid: c.asset?.uuid ?? "", project: c.project?.name ?? "",
      cycle: c.cycleNumber, started: c.startedAt, completed: c.completedAt ?? "",
      duration_days: c.durationDays ?? "", locations: c.locationsVisited.join(" → "), status: c.status,
    }));
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify((r as Record<string, unknown>)[h] ?? "")).join(","))].join("\n");
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "cycle-report.csv" }).click();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-800 px-6 py-5 text-white shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">Operations</p>
            <h1 className="mt-1 text-2xl font-bold">Cycle Report</h1>
            <p className="mt-1 text-sm text-indigo-300">Track round-trip cycles from master warehouse → field → return</p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold text-amber-400">{totalActive}</p>
              <p className="text-xs text-indigo-300">Open Cycles</p>
            </div>
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold text-emerald-400">{totalCompleted}</p>
              <p className="text-xs text-indigo-300">Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Cycles",  value: cycles.length,                   color: "text-slate-900",   bg: "bg-slate-50" },
          { label: "Completed",     value: totalCompleted,                  color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Active (Open)", value: totalActive,                     color: "text-amber-600",   bg: "bg-amber-50" },
          { label: "Avg Duration",  value: avgDuration ? `${avgDuration}d` : "—", color: "text-blue-600", bg: "bg-blue-50" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`rounded-2xl border border-slate-200 ${bg} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {maxCycleAsset && (maxCycleAsset.cycleCount ?? 0) > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-indigo-500 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-indigo-700">Most Active Asset</p>
            <p className="text-sm font-bold text-indigo-900">
              {maxCycleAsset.name}
              <span className="ml-2 text-xs font-normal text-indigo-600">
                {maxCycleAsset.cycleCount} completed cycle{(maxCycleAsset.cycleCount ?? 0) > 1 ? "s" : ""}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}
            placeholder="Search asset name / UUID…"
            className="rounded-xl border border-slate-200 pl-8 pr-3 py-2 text-xs bg-white outline-none focus:border-slate-400 w-52" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white outline-none focus:border-slate-400">
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
        </select>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white outline-none focus:border-slate-400">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={load} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button onClick={exportCSV}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="card-bento overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-center">Cycle #</th>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-left">Completed</th>
                <th className="px-4 py-3 text-center">Duration</th>
                <th className="px-4 py-3 text-left">Route</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <RotateCcw className="h-10 w-10 mx-auto text-slate-200 mb-2" />
                    <p className="text-sm text-slate-400">No cycle records match your filters</p>
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800 truncate max-w-[140px]">{c.assetName}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{c.asset?.uuid}</p>
                    {c.project && (
                      <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-700">{c.project.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 mx-auto">
                      {c.cycleNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                    <Calendar className="inline h-3 w-3 mr-1 text-slate-400" />
                    {new Date(c.startedAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                    {c.completedAt
                      ? <><Calendar className="inline h-3 w-3 mr-1 text-emerald-400" />{new Date(c.completedAt).toLocaleDateString("en-IN")}</>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.durationDays != null
                      ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{c.durationDays}d</span>
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="flex flex-wrap items-center gap-1">
                      {c.locationsVisited.map((loc, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">
                            <MapPin className="inline h-2.5 w-2.5 mr-0.5" />{loc}
                          </span>
                          {i < c.locationsVisited.length - 1 && <span className="text-slate-300 text-[9px]">→</span>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {c.status === "Completed"
                        ? <><CheckCircle2 className="inline h-3 w-3 mr-0.5" />Done</>
                        : <><RotateCcw className="inline h-3 w-3 mr-0.5" />Active</>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
