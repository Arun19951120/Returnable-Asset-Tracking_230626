"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import type { Order, Location, Project, ScheduledReport, Asset } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Plus, X, Loader2, Download, Package, ClipboardList, CheckCircle2,
  Clock, Truck, ArrowRight, Search, Filter,
} from "lucide-react";
import FilterBar, { DayRange, filterByDays } from "@/components/ui/FilterBar";
import { toast } from "sonner";

const STATUS_STYLES: Record<Order["status"], string> = {
  Pending:    "bg-amber-100 text-amber-700",
  Approved:   "bg-sky-100 text-sky-700",
  Dispatched: "bg-blue-100 text-blue-700",
  Received:   "bg-emerald-100 text-emerald-700",
};
const STATUS_ICONS: Record<Order["status"], React.ReactNode> = {
  Pending:    <Clock className="h-3 w-3" />,
  Approved:   <CheckCircle2 className="h-3 w-3" />,
  Dispatched: <Truck className="h-3 w-3" />,
  Received:   <Package className="h-3 w-3" />,
};

function exportCSV(orders: Order[]) {
  const headers = ["id", "carrier", "origin", "destination", "status", "createdAt"];
  const csv = [headers.join(","), ...orders.map((o) => headers.map((h) => JSON.stringify((o as unknown as Record<string, unknown>)[h] ?? "")).join(","))].join("\n");
  Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "orders-export.csv" }).click();
  toast.success("Orders exported");
}

export default function Orders() {
  const { profile } = useAuth();
  const isCustomer = profile?.role === "Customer";

  const [orders,    setOrders]    = useState<Order[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [dayRange,       setDayRange]       = useState<DayRange>("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter,   setStatusFilter]   = useState("All");
  const [search,         setSearch]         = useState("");
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState({ carrier: "", origin: "", destination: "", assetId: "", projectId: "", notes: "" });
  const [loading,   setLoading]   = useState(false);

  const load = useCallback(async () => {
    const [o, l, p, a] = await Promise.all([
      fetchAll<Order>("orders"),
      fetchAll<Location>("locations"),
      fetchAll<Project>("projects"),
      fetchAll<Asset>("assets"),
    ]);
    setOrders(o.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLocations(l.filter((x) => x.status === "Active"));
    setProjects(p.filter((x) => x.status === "Active"));
    setAssets(a);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Customer sees only their location orders, scoped to their projects
  const myProjects = isCustomer && profile?.projects?.length
    ? projects.filter((p) => profile.projects!.includes(p.name))
    : projects;

  const myLocs = isCustomer && profile?.allowedLocations?.length
    ? profile.allowedLocations
    : null;

  const baseOrders = isCustomer
    ? orders.filter((o) =>
        (myLocs ? myLocs.includes(o.origin) || myLocs.includes(o.destination) : true) &&
        (o.createdBy === profile?.uid || myProjects.some((p) => (o as unknown as Record<string,unknown>).projectId === p.id))
      )
    : orders;

  const filtered = filterByDays(baseOrders, dayRange).filter((o) => {
    const matchLoc    = !locationFilter || o.origin === locationFilter || o.destination === locationFilter;
    const matchStatus = statusFilter === "All" || o.status === statusFilter;
    const matchSearch = !search || o.carrier.toLowerCase().includes(search.toLowerCase()) || o.origin.toLowerCase().includes(search.toLowerCase()) || o.destination.toLowerCase().includes(search.toLowerCase());
    return matchLoc && matchStatus && matchSearch;
  });

  const locationNames = (myLocs ? locations.filter((l) => myLocs.includes(l.name)) : locations).map((l) => l.name);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const orderData = {
        ...form,
        status: "Pending" as const,
        createdBy: profile?.uid ?? "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addDocument("orders", orderData);
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Order created: ${form.origin} → ${form.destination}`,
        category: "Order", details: JSON.stringify(form),
      });

      // Notify configured email recipients
      const allReports = await fetchAll<ScheduledReport>("scheduled_reports");
      const notifyReports = allReports.filter((r) => r.enabled && r.notifyOnOrder);
      const recipients = [...new Set(notifyReports.flatMap((r) => r.recipients))];
      if (recipients.length > 0) {
        await addDocument("notifications", {
          title: isCustomer ? "Customer Order Request" : "New Order Created",
          message: `Order by ${profile?.displayName ?? profile?.email} (${form.origin} → ${form.destination})${form.notes ? ` — ${form.notes}` : ""}. Notified: ${recipients.join(", ")}`,
          type: "info", read: false, createdAt: new Date().toISOString(),
        });
        toast.success(`Order submitted — ${recipients.length} admin${recipients.length > 1 ? "s" : ""} notified`);
      } else {
        toast.success("Order submitted successfully");
      }

      setShowForm(false);
      setForm({ carrier: "", origin: "", destination: "", assetId: "", projectId: "", notes: "" });
      load();
    } catch { toast.error("Failed to create order"); }
    finally { setLoading(false); }
  }

  async function advanceStatus(order: Order) {
    if (isCustomer) return; // Customers cannot advance status
    const next: Record<Order["status"], Order["status"]> = { Pending: "Approved", Approved: "Dispatched", Dispatched: "Received", Received: "Received" };
    if (next[order.status] === order.status) return;
    await updateDocument("orders", order.id, { status: next[order.status], updatedAt: new Date().toISOString() });
    toast.success(`Marked as ${next[order.status]}`); load();
  }

  const pending    = filtered.filter((o) => o.status === "Pending").length;
  const dispatched = filtered.filter((o) => o.status === "Dispatched").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-6 py-5 text-white shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              {isCustomer ? "Customer Portal" : "Operations"}
            </p>
            <h1 className="mt-1 text-2xl font-bold">Orders</h1>
            <p className="mt-1 text-sm text-slate-400">
              {isCustomer ? "Place and track your asset orders" : "Manage asset order requests"}
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold text-amber-400">{pending}</p>
              <p className="text-xs text-slate-300">Pending</p>
            </div>
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold text-blue-400">{dispatched}</p>
              <p className="text-xs text-slate-300">Dispatched</p>
            </div>
          </div>
        </div>
      </div>

      {isCustomer && myProjects.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No projects are assigned to your account. Contact your administrator to get project access before placing orders.
        </div>
      )}

      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search orders…"
            className="rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-xs outline-none focus:border-slate-400 w-44" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400">
          {["All", "Pending", "Approved", "Dispatched", "Received"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          {!isCustomer && (
            <button onClick={() => exportCSV(filtered)} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          )}
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            <Plus className="h-4 w-4" /> {isCustomer ? "Place Order" : "New Order"}
          </button>
        </div>
      </div>

      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        locationFilter={locationFilter} locations={locationNames} onLocationChange={setLocationFilter}
      />

      {/* Orders table */}
      <div className="overflow-x-auto card-bento">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Order ID", "Carrier", "Route", "Project", "Status", "Date", !isCustomer ? "Action" : ""].filter(Boolean).map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <ClipboardList className="h-10 w-10 mx-auto text-slate-200 mb-2" />
                  <p className="text-sm text-slate-400">No orders found</p>
                  {isCustomer && <p className="text-xs text-slate-400 mt-1">Click "Place Order" to request assets from your project</p>}
                </td>
              </tr>
            )}
            {filtered.map((order) => {
              const proj = projects.find((p) => (order as unknown as Record<string,unknown>).projectId === p.id);
              return (
                <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">#{order.id.slice(-8).toUpperCase()}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{order.carrier || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    <div className="flex items-center gap-1">
                      <span>{order.origin}</span>
                      <ArrowRight className="h-3 w-3 text-slate-300" />
                      <span>{order.destination}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {proj ? <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">{proj.name}</span> : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]}`}>
                      {STATUS_ICONS[order.status]}{order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  {!isCustomer && (
                    <td className="px-4 py-3">
                      {order.status !== "Received" && (
                        <button onClick={() => advanceStatus(order)} className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                          Advance →
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Order form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-slate-900">{isCustomer ? "Place Order Request" : "Create Order"}</h3>
                {isCustomer && <p className="text-xs text-slate-400 mt-0.5">Your request will be sent to the admin team</p>}
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              {/* Project selector — required for customers */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Project {isCustomer && <span className="text-red-500">*</span>}
                </label>
                <select
                  required={isCustomer}
                  value={form.projectId}
                  onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50">
                  <option value="">— Select project —</option>
                  {myProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {/* Origin */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Ship From (Origin) *</label>
                <select required value={form.origin}
                  onChange={(e) => setForm((p) => ({ ...p, origin: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50">
                  <option value="">— Select origin —</option>
                  {locations.map((l) => <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>)}
                </select>
              </div>

              {/* Destination */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Deliver To (Destination) *</label>
                <select required value={form.destination}
                  onChange={(e) => setForm((p) => ({ ...p, destination: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50">
                  <option value="">— Select destination —</option>
                  {locationNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* Carrier — optional for customer */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Carrier / Logistics {!isCustomer && <span className="text-red-500">*</span>}
                </label>
                <input required={!isCustomer} value={form.carrier}
                  onChange={(e) => setForm((p) => ({ ...p, carrier: e.target.value }))}
                  placeholder={isCustomer ? "Optional — leave blank if unknown" : "Enter carrier name…"}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50" />
              </div>

              {/* Asset picker */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Asset (optional)</label>
                <select value={form.assetId}
                  onChange={(e) => setForm((p) => ({ ...p, assetId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50">
                  <option value="">— Any / To be assigned —</option>
                  {assets.filter((a) => a.status === "Available").map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.uuid})</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Notes / Requirements</label>
                <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2}
                  placeholder="Describe what you need, quantity, urgency…"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50 resize-none" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={loading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isCustomer ? "Submit Request" : "Create Order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
