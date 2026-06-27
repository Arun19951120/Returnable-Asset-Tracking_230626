"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAll, addDocument } from "@/lib/storage";
import { Project, Asset, Order, Expense } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  TrendingUp, TrendingDown, DollarSign, Plus, X, Loader2,
  ChevronDown, ChevronUp, BarChart2, Upload, FileText,
  Download, AlertCircle, CheckCircle2, Table2, Filter, Calendar, RefreshCw,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

const EXPENSE_CATEGORIES: Expense["category"][] = ["Purchase", "Maintenance", "Transport", "Labour", "Rent", "Other"];

const CSV_TEMPLATE = `date,project_name,category,description,amount
2025-01-15,Project Alpha,Purchase,Pallet purchase batch #1,45000
2025-02-01,Project Alpha,Maintenance,Repair corrugation boxes,8500
2025-03-10,Project Beta,Rent,Warehouse rent Q1,30000`;

interface CsvRow {
  row: number;
  date: string;
  project_name: string;
  category: string;
  description: string;
  amount: number;
  matchedProjectId: string | null;
  error?: string;
}

function parseCsv(text: string, projects: Project[]): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const idx = (key: string) => headers.indexOf(key);

  return lines.slice(1).map((line, i) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const date = cols[idx("date")] ?? "";
    const project_name = cols[idx("project_name")] ?? "";
    const category = cols[idx("category")] ?? "Other";
    const description = cols[idx("description")] ?? "";
    const rawAmount = cols[idx("amount")] ?? "0";
    const amount = parseFloat(rawAmount.replace(/[^0-9.]/g, ""));

    const matched = projects.find(
      (p) => p.name.toLowerCase() === project_name.toLowerCase()
    );

    const errors: string[] = [];
    if (!date) errors.push("missing date");
    if (!project_name) errors.push("missing project");
    if (isNaN(amount) || amount <= 0) errors.push("invalid amount");

    return {
      row: i + 2,
      date,
      project_name,
      category: EXPENSE_CATEGORIES.includes(category as Expense["category"]) ? category : "Other",
      description,
      amount: isNaN(amount) ? 0 : amount,
      matchedProjectId: matched?.id ?? null,
      error: errors.length ? errors.join(", ") : undefined,
    };
  });
}

function fmt(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function ProfitLoss() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [selectedProject,  setSelectedProject]  = useState<string>("all");
  const [selectedStatus,   setSelectedStatus]   = useState<"all" | "Active" | "Closed">("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [duration,         setDuration]         = useState<string>("all");
  const [dateFrom,         setDateFrom]         = useState<string>("");
  const [dateTo,           setDateTo]           = useState<string>("");
  const [showFilters,      setShowFilters]       = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [form, setForm] = useState({
    projectId: "",
    category: "Purchase" as Expense["category"],
    description: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importTab, setImportTab] = useState<"csv" | "doc">("csv");
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvError, setCsvError] = useState("");
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvDone, setCsvDone] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [docDone, setDocDone] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, a, o, e] = await Promise.all([
      fetchAll<Project>("projects"),
      fetchAll<Asset>("assets"),
      fetchAll<Order>("orders"),
      fetchAll<Expense>("expenses"),
    ]);
    setProjects(p.filter((x) => x.status === "Active" || x.status === "Closed"));
    setAssets(a);
    setOrders(o);
    setExpenses(e);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Date range helpers ────────────────────────────────────────────────────────
  function getDateRange(): { from: Date | null; to: Date | null } {
    const now = new Date();
    if (duration === "custom") {
      return {
        from: dateFrom ? new Date(dateFrom) : null,
        to:   dateTo   ? new Date(dateTo + "T23:59:59") : null,
      };
    }
    const y = now.getFullYear(), m = now.getMonth();
    if (duration === "this_month")  return { from: new Date(y, m, 1),      to: now };
    if (duration === "last_month")  return { from: new Date(y, m - 1, 1),  to: new Date(y, m, 0, 23, 59, 59) };
    if (duration === "q1")          return { from: new Date(y, 0, 1),      to: new Date(y, 2, 31, 23, 59, 59) };
    if (duration === "q2")          return { from: new Date(y, 3, 1),      to: new Date(y, 5, 30, 23, 59, 59) };
    if (duration === "q3")          return { from: new Date(y, 6, 1),      to: new Date(y, 8, 30, 23, 59, 59) };
    if (duration === "q4")          return { from: new Date(y, 9, 1),      to: new Date(y, 11, 31, 23, 59, 59) };
    if (duration === "last_3m")     return { from: new Date(y, m - 3, 1),  to: now };
    if (duration === "last_6m")     return { from: new Date(y, m - 6, 1),  to: now };
    if (duration === "this_year")   return { from: new Date(y, 0, 1),      to: now };
    if (duration === "last_year")   return { from: new Date(y - 1, 0, 1),  to: new Date(y - 1, 11, 31, 23, 59, 59) };
    return { from: null, to: null };
  }

  function inRange(dateStr: string, from: Date | null, to: Date | null) {
    if (!from && !to) return true;
    const d = new Date(dateStr);
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  }

  function calcPL(projectId: string) {
    const { from, to } = getDateRange();
    const projectAssets = assets.filter((a) => a.projectId === projectId);
    const assetCost = projectAssets.reduce((s, a) => s + (a.cost ?? 0), 0);

    const projectExpenses = expenses.filter((e) => {
      if (e.projectId !== projectId) return false;
      if (selectedCategory !== "all" && e.category !== selectedCategory) return false;
      if (!inRange(e.date, from, to)) return false;
      return true;
    });
    const totalExpenses = projectExpenses.reduce((s, e) => s + e.amount, 0) + assetCost;

    const projectAssetIds = new Set(projectAssets.map((a) => a.id));
    const projectOrders = orders.filter((o) => {
      if (!projectAssetIds.has(o.assetId)) return false;
      if (o.status !== "Dispatched" && o.status !== "Received") return false;
      if (!inRange(o.updatedAt, from, to)) return false;
      return true;
    });
    const proj = projects.find((p) => p.id === projectId);
    const revenue = proj?.poPrice ? proj.poPrice * projectOrders.length : 0;

    const pl = revenue - totalExpenses;
    return { revenue, totalExpenses, pl, projectOrders: projectOrders.length, projectExpenses };
  }

  async function handleAddExpense() {
    if (!form.projectId || !form.description || !form.amount) return;
    setSaving(true);
    await addDocument("expenses", {
      projectId: form.projectId,
      category: form.category,
      description: form.description,
      amount: parseFloat(form.amount),
      date: form.date,
      createdBy: profile?.displayName ?? "Admin",
      createdAt: new Date().toISOString(),
    });
    setShowForm(false);
    setForm({ projectId: "", category: "Purchase", description: "", amount: "", date: new Date().toISOString().slice(0, 10) });
    setSaving(false);
    load();
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");
    setCsvDone(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text, projects);
      if (rows.length === 0) { setCsvError("No data rows found. Check your file format."); return; }
      setCsvRows(rows);
    };
    reader.readAsText(file);
  }

  async function handleCsvImport() {
    const valid = csvRows.filter((r) => !r.error && r.matchedProjectId);
    if (!valid.length) return;
    setCsvImporting(true);
    for (const row of valid) {
      await addDocument("expenses", {
        projectId: row.matchedProjectId!,
        category: row.category as Expense["category"],
        description: row.description || "Imported",
        amount: row.amount,
        date: row.date,
        createdBy: profile?.displayName ?? "Admin",
        createdAt: new Date().toISOString(),
      });
    }
    setCsvImporting(false);
    setCsvDone(true);
    load();
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocUploading(true);
    setDocDone(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (res.ok) {
      const { url, name } = await res.json();
      await addDocument("pl_documents", {
        url,
        name,
        uploadedBy: profile?.displayName ?? "Admin",
        uploadedAt: new Date().toISOString(),
      });
      setDocDone(name);
    }
    setDocUploading(false);
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pl_import_template.csv";
    a.click();
  }

  const filteredProjects = projects.filter((p) => {
    if (selectedProject !== "all" && p.id !== selectedProject) return false;
    if (selectedStatus   !== "all" && p.status !== selectedStatus) return false;
    return true;
  });

  const activeFilterCount = [
    duration !== "all",
    selectedProject !== "all",
    selectedStatus !== "all",
    selectedCategory !== "all",
    duration === "custom" && (dateFrom || dateTo),
  ].filter(Boolean).length;

  function resetFilters() {
    setDuration("all");
    setSelectedProject("all");
    setSelectedStatus("all");
    setSelectedCategory("all");
    setDateFrom("");
    setDateTo("");
  }

  // Summary across all or selected projects
  const summary = filteredProjects.reduce(
    (acc, p) => {
      const { revenue, totalExpenses, pl } = calcPL(p.id);
      return { revenue: acc.revenue + revenue, expenses: acc.expenses + totalExpenses, pl: acc.pl + pl };
    },
    { revenue: 0, expenses: 0, pl: 0 }
  );

  const chartData = projects.map((p) => {
    const { revenue, totalExpenses, pl } = calcPL(p.id);
    return { name: p.name.slice(0, 14), revenue, expenses: totalExpenses, pl };
  });

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">P&amp;L Analysis</h1>
          <p className="text-sm text-slate-500">Profit &amp; Loss per project — Admin only</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all ${
              showFilters || activeFilterCount > 0
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { setShowImport(true); setImportTab("csv"); setCsvRows([]); setCsvError(""); setCsvDone(false); setDocDone(null); }}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all"
          >
            <Upload className="h-4 w-4" /> Import
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all"
          >
            <Plus className="h-4 w-4" /> Add Expense
          </button>
        </div>
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-indigo-500" />
              <p className="text-sm font-semibold text-slate-800">Filter P&amp;L Data</p>
            </div>
            {activeFilterCount > 0 && (
              <button onClick={resetFilters}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors">
                <RefreshCw className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Duration */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600">
                <Calendar className="h-3 w-3" /> Duration
              </label>
              <select value={duration} onChange={(e) => setDuration(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                <option value="all">All Time</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="last_3m">Last 3 Months</option>
                <option value="last_6m">Last 6 Months</option>
                <option value="this_year">This Year</option>
                <option value="last_year">Last Year</option>
                <option value="q1">Q1 (Jan–Mar)</option>
                <option value="q2">Q2 (Apr–Jun)</option>
                <option value="q3">Q3 (Jul–Sep)</option>
                <option value="q4">Q4 (Oct–Dec)</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {/* Project */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Project</label>
              <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                <option value="all">All Projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Expense Category */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Expense Category</label>
              <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                <option value="all">All Categories</option>
                {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>

            {/* Project Status */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Project Status</label>
              <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value as "all" | "Active" | "Closed")}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                <option value="all">Active &amp; Closed</option>
                <option value="Active">Active only</option>
                <option value="Closed">Closed only</option>
              </select>
            </div>
          </div>

          {/* Custom date range */}
          {duration === "custom" && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">From Date</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">To Date</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>
          )}

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-indigo-100">
              {duration !== "all" && (
                <span className="flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
                  <Calendar className="h-3 w-3" />
                  {duration === "custom" ? `${dateFrom || "…"} → ${dateTo || "…"}` : duration.replace(/_/g, " ")}
                  <button onClick={() => { setDuration("all"); setDateFrom(""); setDateTo(""); }} className="ml-1 hover:text-indigo-200"><X className="h-3 w-3" /></button>
                </span>
              )}
              {selectedProject !== "all" && (
                <span className="flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white">
                  {projects.find((p) => p.id === selectedProject)?.name}
                  <button onClick={() => setSelectedProject("all")} className="ml-1 hover:text-violet-200"><X className="h-3 w-3" /></button>
                </span>
              )}
              {selectedCategory !== "all" && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
                  {selectedCategory}
                  <button onClick={() => setSelectedCategory("all")} className="ml-1 hover:text-emerald-200"><X className="h-3 w-3" /></button>
                </span>
              )}
              {selectedStatus !== "all" && (
                <span className="flex items-center gap-1 rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white">
                  {selectedStatus}
                  <button onClick={() => setSelectedStatus("all")} className="ml-1 hover:text-amber-200"><X className="h-3 w-3" /></button>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Revenue", value: summary.revenue, icon: DollarSign, color: "emerald" },
          { label: "Total Expenses", value: summary.expenses, icon: TrendingDown, color: "red" },
          { label: "Net P&L", value: summary.pl, icon: TrendingUp, color: summary.pl >= 0 ? "indigo" : "red" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-${color}-100`}>
                <Icon className={`h-4 w-4 text-${color}-600`} />
              </div>
            </div>
            <p className={`text-2xl font-bold ${value < 0 ? "text-red-600" : color === "red" ? "text-red-600" : "text-slate-900"}`}>
              {fmt(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-bold text-slate-800">Revenue vs Expenses by Project</h2>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barGap={4} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => "₹" + (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(value: number | string | ReadonlyArray<number | string> | undefined) => value != null && typeof value === "number" ? fmt(value) : String(value ?? "")} />
              <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-project breakdown */}
      <div className="space-y-3">
        {filteredProjects.map((proj) => {
          const { revenue, totalExpenses, pl, projectOrders, projectExpenses } = calcPL(proj.id);
          const expanded = expandedProject === proj.id;
          return (
            <div key={proj.id} className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <button
                onClick={() => setExpandedProject(expanded ? null : proj.id)}
                className="flex w-full items-center justify-between p-4 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-2.5 w-2.5 rounded-full bg-indigo-500 shrink-0" />
                  <p className="font-semibold text-slate-900 truncate">{proj.name}</p>
                  <span className="hidden sm:inline text-xs text-slate-400">{proj.client}</span>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <div className="hidden sm:flex flex-col items-end">
                    <p className="text-[10px] text-slate-400 uppercase">Revenue</p>
                    <p className="text-sm font-bold text-emerald-600">{fmt(revenue)}</p>
                  </div>
                  <div className="hidden sm:flex flex-col items-end">
                    <p className="text-[10px] text-slate-400 uppercase">Expenses</p>
                    <p className="text-sm font-bold text-red-500">{fmt(totalExpenses)}</p>
                  </div>
                  <div className="flex flex-col items-end">
                    <p className="text-[10px] text-slate-400 uppercase">P&amp;L</p>
                    <p className={`text-sm font-bold ${pl >= 0 ? "text-indigo-600" : "text-red-600"}`}>{fmt(pl)}</p>
                  </div>
                  {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </button>

              {expanded && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: "Dispatched Orders", value: projectOrders.toString(), unit: "" },
                      { label: "PO Unit Price", value: proj.poPrice ? fmt(proj.poPrice) : "—", unit: "" },
                      { label: "Asset Costs", value: fmt(assets.filter(a => a.projectId === proj.id).reduce((s, a) => s + (a.cost ?? 0), 0)), unit: "" },
                      { label: "Other Expenses", value: fmt(projectExpenses.reduce((s, e) => s + e.amount, 0)), unit: "" },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
                        <p className="text-sm font-bold text-slate-900 mt-1">{value}</p>
                      </div>
                    ))}
                  </div>

                  {projectExpenses.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-2">Expense Entries</p>
                      <div className="space-y-1.5">
                        {projectExpenses.map((exp) => (
                          <div key={exp.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{exp.category}</span>
                              <p className="text-sm text-slate-700 truncate">{exp.description}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <p className="text-xs text-slate-400">{exp.date}</p>
                              <p className="text-sm font-semibold text-red-600">{fmt(exp.amount)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredProjects.length === 0 && (
          <div className="flex h-32 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200">
            <p className="text-sm text-slate-400">No projects found</p>
          </div>
        )}
      </div>

      {/* Import Old P&L Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-900">Import Old P&amp;L Data</h2>
                <p className="text-xs text-slate-500 mt-0.5">Bring in historical records from CSV or upload a document for reference</p>
              </div>
              <button onClick={() => setShowImport(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 shrink-0">
              {([["csv", "CSV Data Import", Table2], ["doc", "Upload Document", FileText]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setImportTab(id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                    importTab === id ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {/* ── CSV tab ── */}
              {importTab === "csv" && (
                <div className="space-y-4">
                  {!csvRows.length && !csvDone && (
                    <>
                      {/* Template download */}
                      <div className="flex items-start gap-3 rounded-xl bg-indigo-50 border border-indigo-100 p-4">
                        <AlertCircle className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-indigo-800">Use the CSV template</p>
                          <p className="text-xs text-indigo-600 mt-0.5">
                            Required columns: <code className="bg-indigo-100 px-1 rounded">date</code>,{" "}
                            <code className="bg-indigo-100 px-1 rounded">project_name</code>,{" "}
                            <code className="bg-indigo-100 px-1 rounded">category</code>,{" "}
                            <code className="bg-indigo-100 px-1 rounded">description</code>,{" "}
                            <code className="bg-indigo-100 px-1 rounded">amount</code>
                          </p>
                          <p className="text-xs text-indigo-500 mt-1">
                            Categories: {EXPENSE_CATEGORIES.join(", ")}
                          </p>
                        </div>
                        <button onClick={downloadTemplate}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
                          <Download className="h-3 w-3" /> Template
                        </button>
                      </div>

                      <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFile} />
                      <button onClick={() => csvRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-10 hover:border-indigo-300 hover:bg-indigo-50 transition-all">
                        <Upload className="h-8 w-8 text-slate-400" />
                        <p className="text-sm text-slate-500">Click to select your CSV file</p>
                      </button>

                      {csvError && (
                        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
                          <AlertCircle className="h-4 w-4 shrink-0" />{csvError}
                        </div>
                      )}
                    </>
                  )}

                  {csvDone && (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                      <p className="text-base font-bold text-slate-900">Import Complete!</p>
                      <p className="text-sm text-slate-500">{csvRows.filter((r) => !r.error && r.matchedProjectId).length} expense records imported successfully.</p>
                      <button onClick={() => { setShowImport(false); setCsvRows([]); }}
                        className="mt-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
                        Done
                      </button>
                    </div>
                  )}

                  {csvRows.length > 0 && !csvDone && (
                    <>
                      {/* Summary */}
                      <div className="flex gap-3">
                        <div className="flex-1 rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
                          <p className="text-lg font-bold text-emerald-700">{csvRows.filter((r) => !r.error && r.matchedProjectId).length}</p>
                          <p className="text-xs text-emerald-600">Ready to import</p>
                        </div>
                        <div className="flex-1 rounded-xl bg-red-50 border border-red-100 p-3 text-center">
                          <p className="text-lg font-bold text-red-700">{csvRows.filter((r) => r.error || !r.matchedProjectId).length}</p>
                          <p className="text-xs text-red-600">Rows with issues</p>
                        </div>
                        <div className="flex-1 rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                          <p className="text-lg font-bold text-slate-700">{fmt(csvRows.filter((r) => !r.error && r.matchedProjectId).reduce((s, r) => s + r.amount, 0))}</p>
                          <p className="text-xs text-slate-500">Total value</p>
                        </div>
                      </div>

                      {/* Preview table */}
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              {["Row", "Date", "Project", "Category", "Description", "Amount", "Status"].map((h) => (
                                <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {csvRows.map((row) => {
                              const ok = !row.error && row.matchedProjectId;
                              return (
                                <tr key={row.row} className={ok ? "" : "bg-red-50"}>
                                  <td className="px-3 py-2 text-slate-400">{row.row}</td>
                                  <td className="px-3 py-2 text-slate-700">{row.date || "—"}</td>
                                  <td className="px-3 py-2">
                                    <span className={row.matchedProjectId ? "text-slate-700" : "text-red-600 font-semibold"}>
                                      {row.project_name || "—"}
                                    </span>
                                    {!row.matchedProjectId && <span className="ml-1 text-red-400">(not found)</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{row.category}</span>
                                  </td>
                                  <td className="px-3 py-2 text-slate-700 max-w-[150px] truncate">{row.description || "—"}</td>
                                  <td className="px-3 py-2 font-semibold text-slate-800">{fmt(row.amount)}</td>
                                  <td className="px-3 py-2">
                                    {ok
                                      ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />OK</span>
                                      : <span className="text-red-500">{row.error || "project not found"}</span>
                                    }
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex gap-3">
                        <button onClick={() => { setCsvRows([]); if (csvRef.current) csvRef.current.value = ""; }}
                          className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                          Clear
                        </button>
                        <button
                          onClick={handleCsvImport}
                          disabled={csvImporting || !csvRows.some((r) => !r.error && r.matchedProjectId)}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                          {csvImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          {csvImporting ? "Importing…" : `Import ${csvRows.filter((r) => !r.error && r.matchedProjectId).length} rows`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Document tab ── */}
              {importTab === "doc" && (
                <div className="space-y-4">
                  {docDone ? (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                      <p className="text-base font-bold text-slate-900">Document Uploaded!</p>
                      <p className="text-sm text-slate-500 break-all max-w-xs">{docDone}</p>
                      <button onClick={() => { setShowImport(false); setDocDone(null); }}
                        className="mt-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
                        Done
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-100 p-4">
                        <FileText className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                        <p className="text-sm text-slate-600">
                          Upload your old P&amp;L statement as a PDF or Excel file. It will be stored as a reference document — useful for audits and historical comparison.
                        </p>
                      </div>

                      <input ref={docRef} type="file" accept=".pdf,.xls,.xlsx,.csv" className="hidden" onChange={handleDocUpload} />
                      <button onClick={() => docRef.current?.click()} disabled={docUploading}
                        className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-12 hover:border-indigo-300 hover:bg-indigo-50 transition-all disabled:opacity-60">
                        {docUploading
                          ? <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
                          : <Upload className="h-8 w-8 text-slate-400" />}
                        <p className="text-sm text-slate-500">
                          {docUploading ? "Uploading…" : "Click to select PDF, Excel, or CSV"}
                        </p>
                        <p className="text-xs text-slate-400">Up to 10 MB</p>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Add Expense</h2>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Project *</label>
                <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Expense["category"] })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                  {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Description *</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Pallet repair batch #4"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Amount (₹) *</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleAddExpense} disabled={saving || !form.projectId || !form.description || !form.amount}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {saving ? "Saving…" : "Add Expense"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
