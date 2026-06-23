"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import type { PickupRequest, Location, ScheduledReport, Asset } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { Truck, Plus, X, Loader2, Package, Clock, CheckCircle2, Calendar } from "lucide-react";
import FilterBar, { DayRange, filterByDays } from "@/components/ui/FilterBar";
import { toast } from "sonner";

const STATUS_STYLES: Record<PickupRequest["status"], string> = {
  Open:      "bg-amber-100 text-amber-700",
  Scheduled: "bg-blue-100 text-blue-700",
  Completed: "bg-emerald-100 text-emerald-700",
};
const STATUS_ICONS: Record<PickupRequest["status"], React.ReactNode> = {
  Open:      <Clock className="h-3 w-3" />,
  Scheduled: <Calendar className="h-3 w-3" />,
  Completed: <CheckCircle2 className="h-3 w-3" />,
};

export default function PickupRequests() {
  const { profile } = useAuth();
  const isCustomer = profile?.role === "Customer";

  const [requests,  setRequests]  = useState<PickupRequest[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [dayRange,       setDayRange]       = useState<DayRange>("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter,   setStatusFilter]   = useState("All");
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState({ location: "", notes: "", assetIds: [] as string[] });
  const [loading,   setLoading]   = useState(false);

  const load = useCallback(async () => {
    const [r, l, a] = await Promise.all([
      fetchAll<PickupRequest>("pickup_requests"),
      fetchAll<Location>("locations"),
      fetchAll<Asset>("assets"),
    ]);
    setRequests(r.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLocations(l.filter((x) => x.status === "Active"));
    setAssets(a);
  }, []);

  useEffect(() => { load(); }, [load]);

  const myLocs = isCustomer && profile?.allowedLocations?.length ? profile.allowedLocations : null;

  // Customers only see their own requests (from their locations)
  const baseRequests = isCustomer
    ? requests.filter((r) => r.requestedBy === profile?.uid || (myLocs && myLocs.includes(r.location)))
    : requests;

  const filtered = filterByDays(baseRequests, dayRange).filter((r) => {
    const matchLoc    = !locationFilter || r.location === locationFilter;
    const matchStatus = statusFilter === "All" || r.status === statusFilter;
    return matchLoc && matchStatus;
  });

  const locationNames = (myLocs ? locations.filter((l) => myLocs.includes(l.name)) : locations).map((l) => l.name);

  // Assets available at customer's locations
  const myAvailableAssets = isCustomer && myLocs
    ? assets.filter((a) => myLocs.includes(a.location) && a.status === "Available")
    : assets.filter((a) => a.status === "Available");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await addDocument("pickup_requests", {
        requestedBy: profile?.uid ?? "",
        location: form.location,
        assetIds: form.assetIds,
        status: "Open",
        createdAt: new Date().toISOString(),
        notes: form.notes || undefined,
      });
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Pickup request at ${form.location}`,
        category: "Pickup", details: form.assetIds.join(", "),
      });

      // Email notifications
      const allReports = await fetchAll<ScheduledReport>("scheduled_reports");
      const notifyReports = allReports.filter((r) => r.enabled && r.notifyOnPickup);
      const recipients = [...new Set(notifyReports.flatMap((r) => r.recipients))];
      if (recipients.length > 0) {
        await addDocument("notifications", {
          title: isCustomer ? "Customer Pickup Request" : "Pickup Request Submitted",
          message: `Pickup at ${form.location} by ${profile?.displayName ?? profile?.email}${form.notes ? ` — ${form.notes}` : ""}. Notified: ${recipients.join(", ")}`,
          type: "info", read: false, createdAt: new Date().toISOString(),
        });
        toast.success(`Request submitted — ${recipients.length} admin${recipients.length > 1 ? "s" : ""} notified`);
      } else {
        toast.success("Pickup request submitted");
      }

      setShowForm(false);
      setForm({ location: "", notes: "", assetIds: [] });
      load();
    } catch { toast.error("Failed to submit"); }
    finally { setLoading(false); }
  }

  async function advanceStatus(req: PickupRequest) {
    if (isCustomer) return;
    const next: Record<PickupRequest["status"], PickupRequest["status"]> = {
      Open: "Scheduled", Scheduled: "Completed", Completed: "Completed",
    };
    if (next[req.status] === req.status) return;
    await updateDocument("pickup_requests", req.id, { status: next[req.status] });
    toast.success(`Marked as ${next[req.status]}`); load();
  }

  const openCount = filtered.filter((r) => r.status === "Open").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-6 py-5 text-white shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              {isCustomer ? "Customer Portal" : "Operations"}
            </p>
            <h1 className="mt-1 text-2xl font-bold">Pickup Requests</h1>
            <p className="mt-1 text-sm text-slate-400">
              {isCustomer ? "Request asset collection from your site" : "Manage scheduled asset pickups"}
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold text-amber-400">{openCount}</p>
              <p className="text-xs text-slate-300">Open</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400">
          {["All", "Open", "Scheduled", "Completed"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <button onClick={() => setShowForm(true)} className="ml-auto flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          <Plus className="h-4 w-4" /> {isCustomer ? "Request Pickup" : "New Request"}
        </button>
      </div>

      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        locationFilter={locationFilter} locations={locationNames} onLocationChange={setLocationFilter}
      />

      {/* Requests list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center">
            <Truck className="h-10 w-10 mx-auto text-slate-200 mb-2" />
            <p className="text-sm text-slate-400">No pickup requests found</p>
            {isCustomer && <p className="text-xs text-slate-400 mt-1">Click "Request Pickup" to schedule an asset collection from your site</p>}
          </div>
        )}
        {filtered.map((req) => {
          const reqAssets = req.assetIds.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
          const notes = (req as unknown as Record<string, unknown>).notes as string | undefined;
          return (
            <div key={req.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${req.status === "Completed" ? "bg-emerald-100" : req.status === "Scheduled" ? "bg-blue-100" : "bg-amber-100"}`}>
                  <Truck className={`h-5 w-5 ${req.status === "Completed" ? "text-emerald-600" : req.status === "Scheduled" ? "text-blue-600" : "text-amber-600"}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-800">{req.location}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[req.status]}`}>
                      {STATUS_ICONS[req.status]}{req.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-slate-400">
                      {req.assetIds.length} asset{req.assetIds.length !== 1 ? "s" : ""}
                      {reqAssets.length > 0 && `: ${reqAssets.slice(0, 2).map((a) => a.name).join(", ")}${reqAssets.length > 2 ? ` +${reqAssets.length - 2}` : ""}`}
                    </p>
                    <span className="text-slate-200">·</span>
                    <p className="text-xs text-slate-400">{new Date(req.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                  </div>
                  {notes && <p className="text-xs text-slate-500 italic mt-0.5">"{notes}"</p>}
                </div>
              </div>
              {!isCustomer && req.status !== "Completed" && (
                <button onClick={() => advanceStatus(req)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap">
                  {req.status === "Open" ? "Schedule →" : "Complete →"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-slate-900">{isCustomer ? "Request Asset Pickup" : "New Pickup Request"}</h3>
                {isCustomer && <p className="text-xs text-slate-400 mt-0.5">Admin team will schedule the collection</p>}
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Pickup Location *</label>
                <select required value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50">
                  <option value="">Select location…</option>
                  {locationNames.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>

              {/* Asset selection */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Assets to Pick Up
                  <span className="ml-1 text-slate-400 font-normal">(optional — select from available)</span>
                </label>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-100">
                  {myAvailableAssets.filter((a) => !form.location || a.location === form.location).length === 0 && (
                    <p className="px-3 py-3 text-xs text-slate-400 text-center">
                      {form.location ? `No available assets at ${form.location}` : "Select a location first"}
                    </p>
                  )}
                  {myAvailableAssets.filter((a) => !form.location || a.location === form.location).map((a) => {
                    const checked = form.assetIds.includes(a.id);
                    return (
                      <label key={a.id} className={`flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-white transition-colors ${checked ? "bg-white" : ""}`}>
                        <input type="checkbox" checked={checked} className="rounded"
                          onChange={() => setForm((p) => ({
                            ...p,
                            assetIds: checked ? p.assetIds.filter((x) => x !== a.id) : [...p.assetIds, a.id],
                          }))} />
                        <Package className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">{a.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{a.uuid}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {form.assetIds.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">{form.assetIds.length} asset{form.assetIds.length > 1 ? "s" : ""} selected</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Notes / Reason</label>
                <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={2} placeholder={isCustomer ? "Why do you need pickup? Any special instructions…" : "Optional notes…"}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50 resize-none" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={loading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isCustomer ? "Submit Request" : "Create Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
