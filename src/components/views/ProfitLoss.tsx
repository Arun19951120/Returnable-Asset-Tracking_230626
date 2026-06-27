"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument } from "@/lib/storage";
import { Project, Asset, Order, Expense } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  TrendingUp, TrendingDown, DollarSign, Plus, X, Loader2,
  ChevronDown, ChevronUp, BarChart2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

const EXPENSE_CATEGORIES: Expense["category"][] = ["Purchase", "Maintenance", "Transport", "Labour", "Rent", "Other"];

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
  const [selectedProject, setSelectedProject] = useState<string>("all");
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

  function calcPL(projectId: string) {
    const projectAssets = assets.filter((a) => a.projectId === projectId);
    const assetCost = projectAssets.reduce((s, a) => s + (a.cost ?? 0), 0);
    const projectExpenses = expenses.filter((e) => e.projectId === projectId);
    const totalExpenses = projectExpenses.reduce((s, e) => s + e.amount, 0) + assetCost;

    // Revenue: dispatched orders for assets in this project
    const projectAssetIds = new Set(projectAssets.map((a) => a.id));
    const projectOrders = orders.filter(
      (o) => projectAssetIds.has(o.assetId) && (o.status === "Dispatched" || o.status === "Received")
    );
    // Estimate revenue from project's poPrice × completed order count
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

  const filteredProjects = selectedProject === "all" ? projects : projects.filter((p) => p.id === selectedProject);

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
        <div className="flex gap-2">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all"
          >
            <Plus className="h-4 w-4" /> Add Expense
          </button>
        </div>
      </div>

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
