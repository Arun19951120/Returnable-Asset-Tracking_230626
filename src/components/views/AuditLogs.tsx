"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll } from "@/lib/storage";
import { AuditLog } from "@/lib/types";
import { Search, Download } from "lucide-react";
import FilterBar, { DayRange, filterByDays } from "@/components/ui/FilterBar";
import { toast } from "sonner";

const CATEGORY_STYLES: Record<AuditLog["category"], string> = {
  Asset: "bg-blue-100 text-blue-700", Order: "bg-amber-100 text-amber-700",
  User: "bg-purple-100 text-purple-700", Role: "bg-slate-100 text-slate-600",
  Pickup: "bg-emerald-100 text-emerald-700", Transfer: "bg-orange-100 text-orange-700",
  Report: "bg-pink-100 text-pink-700", Project: "bg-indigo-100 text-indigo-700",
};

function exportCSV(logs: AuditLog[]) {
  const headers = ["timestamp", "userEmail", "category", "action", "details"];
  const csv = [headers.join(","), ...logs.map((l) => headers.map((h) => JSON.stringify((l as unknown as Record<string, unknown>)[h] ?? "")).join(","))].join("\n");
  Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "audit-logs.csv" }).click();
  toast.success("Audit logs exported");
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [dayRange, setDayRange] = useState<DayRange>("30");

  const load = useCallback(async () => {
    const data = await fetchAll<AuditLog>("audit_logs");
    setLogs(data.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filterByDays(logs, dayRange, "timestamp").filter((log) => {
    const matchSearch = !search || log.action.toLowerCase().includes(search.toLowerCase()) || log.userEmail.toLowerCase().includes(search.toLowerCase());
    return matchSearch && (categoryFilter === "All" || log.category === categoryFilter);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
          <p className="text-sm text-slate-500">{filtered.length} entries · compliance trail</p>
        </div>
        <button onClick={() => exportCSV(filtered)} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        extraFilters={
          <>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 outline-none">
              {["All", "Asset", "Order", "Transfer", "User", "Role", "Pickup", "Report"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-3 text-xs outline-none focus:border-slate-400 w-44" />
            </div>
          </>
        }
      />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Timestamp", "User", "Category", "Action", "Details"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-slate-400">No log entries found</td></tr>}
            {filtered.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{log.userEmail}</td>
                <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[log.category]}`}>{log.category}</span></td>
                <td className="px-4 py-3 text-slate-800">{log.action}</td>
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-slate-400">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
