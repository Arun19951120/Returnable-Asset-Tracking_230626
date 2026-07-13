"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument } from "@/lib/storage";
import { Location } from "@/lib/types";
import { MapPin, Plus, X, Edit2, Loader2, Star, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const empty = {
  name: "",
  type: "Customer Site" as NonNullable<Location["type"]>,
  status: "Active" as Location["status"],
  address: "", gst: "", isMasterWarehouse: false,
  contactName: "", contactEmail: "", contactPhone: "",
};

export default function LocationManagement() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLocations(await fetchAll<Location>("locations"));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...empty }); setShowForm(true); }
  function openEdit(l: Location) {
    setEditing(l);
    setForm({
      name: l.name,
      type: l.type ?? (l.isMasterWarehouse ? "Rustoppers Warehouse" : "Customer Site"),
      status: l.status, address: l.address ?? "", gst: l.gst ?? "",
      isMasterWarehouse: l.isMasterWarehouse ?? false,
      contactName: l.contactName ?? "", contactEmail: l.contactEmail ?? "", contactPhone: l.contactPhone ?? "",
    });
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Only one Master Warehouse allowed — warn if another already exists
      if (form.isMasterWarehouse && !editing?.isMasterWarehouse) {
        const existing = locations.find((l) => l.isMasterWarehouse && l.id !== editing?.id);
        if (existing) {
          toast.error(`"${existing.name}" is already the Master Warehouse. Unset it first.`);
          setSaving(false); return;
        }
      }

      // Customer Sites can never be a Master Warehouse
      const payload = { ...form, isMasterWarehouse: form.type === "Rustoppers Warehouse" ? form.isMasterWarehouse : false };
      if (editing) {
        await updateDocument("locations", editing.id, payload);
        toast.success("Location updated");
      } else {
        await addDocument("locations", payload);
        toast.success("Location added");
      }
      setShowForm(false); load();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  const masterWH = locations.find((l) => l.isMasterWarehouse);
  const active = locations.filter((l) => l.status === "Active").length;

  return (
    <div className="space-y-5">
      {/* Master Warehouse banner */}
      {masterWH ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3">
          <Star className="h-5 w-5 text-amber-500 shrink-0 fill-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">Master Warehouse: {masterWH.name}</p>
            <p className="text-xs text-amber-700">All new assets must be initially registered at this location before dispatch.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-3">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">No Master Warehouse designated. Add one to enable asset registration.</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers &amp; Locations</h1>
          <p className="text-sm text-slate-500">Each customer is a location — {active} active · {locations.length} total</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          <Plus className="h-4 w-4" /> Add Customer / Location
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Name", "Type", "Master WH", "Contact", "Address / GST", "Status", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {locations.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-slate-400">No customers / locations yet</td></tr>
            )}
            {locations.map((loc) => (
              <tr key={loc.id} className={`hover:bg-slate-50 ${loc.status === "Inactive" ? "opacity-60" : ""}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {loc.isMasterWarehouse
                      ? <Star className="h-4 w-4 text-amber-400 shrink-0 fill-amber-400" />
                      : <MapPin className="h-4 w-4 text-slate-300 shrink-0" />}
                    <span className={`font-medium ${loc.isMasterWarehouse ? "text-amber-800" : "text-slate-800"}`}>
                      {loc.name}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    loc.type === "Rustoppers Warehouse" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {loc.type ?? "Customer Site"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {loc.isMasterWarehouse
                    ? <span className="flex items-center gap-1 text-xs font-semibold text-amber-600"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Master</span>
                    : <span className="text-xs text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {loc.contactName || loc.contactEmail ? (
                    <div>
                      <p className="text-xs font-medium text-slate-700">{loc.contactName || "—"}</p>
                      <p className="text-[10px] text-slate-400">{loc.contactEmail}{loc.contactPhone ? ` · ${loc.contactPhone}` : ""}</p>
                    </div>
                  ) : <span className="text-xs text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 max-w-xs">
                  <p className="text-slate-500 text-xs truncate">{loc.address || "—"}</p>
                  {loc.gst && <p className="text-[10px] font-mono text-indigo-500 mt-0.5">GST: {loc.gst}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${loc.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {loc.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(loc)}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                    <Edit2 className="h-3 w-3" /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-900">{editing ? "Edit Customer / Location" : "Add Customer / Location"}</h3>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Location Name (Organization Name) *</label>
                <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  placeholder="e.g. ACME Industries Pvt Ltd" />
                <p className="mt-1 text-[10px] text-slate-400">Printed on the Delivery Challan as consignor / consignee name.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Location Type</label>
                  <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as NonNullable<Location["type"]> }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 bg-white">
                    <option>Rustoppers Warehouse</option>
                    <option>Customer Site</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as Location["status"] }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    <option>Active</option><option>Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Full Address</label>
                <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  placeholder="Block, Street, City…" />
                <p className="mt-1 text-[10px] text-slate-400">Printed on the Delivery Challan.</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">GST Details</label>
                <input value={form.gst} onChange={(e) => setForm((p) => ({ ...p, gst: e.target.value.toUpperCase() }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 font-mono"
                  placeholder="e.g. 33AABCU9603R1ZM" />
                <p className="mt-1 text-[10px] text-slate-400">GSTIN printed on the Delivery Challan.</p>
              </div>

              {/* Customer contact details */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-600">Customer Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Contact Name</label>
                    <input value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
                      placeholder="Jane Smith" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
                    <input value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
                      placeholder="+91 98765 43210" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                  <input type="email" value={form.contactEmail} onChange={(e) => setForm((p) => ({ ...p, contactEmail: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
                    placeholder="contact@customer.com" />
                </div>
              </div>

              {/* Master Warehouse toggle — only relevant for Rustoppers Warehouse */}
              {form.type === "Rustoppers Warehouse" && (
                <div className={`rounded-xl border-2 p-4 transition-colors cursor-pointer ${form.isMasterWarehouse ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:border-slate-300"}`}
                  onClick={() => setForm((p) => ({ ...p, isMasterWarehouse: !p.isMasterWarehouse }))}>
                  <div className="flex items-center gap-3">
                    <Star className={`h-5 w-5 ${form.isMasterWarehouse ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">Designate as Master Warehouse</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Assets can <strong>only</strong> be initially registered at the Master Warehouse. Only one site may hold this designation.
                      </p>
                    </div>
                    <div className={`h-5 w-9 rounded-full transition-colors ${form.isMasterWarehouse ? "bg-amber-400" : "bg-slate-200"}`}>
                      <div className={`mt-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.isMasterWarehouse ? "translate-x-4 ml-0.5" : "ml-0.5"}`} />
                    </div>
                  </div>
                </div>
              )}

              {form.isMasterWarehouse && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠️ Setting this as Master Warehouse will restrict asset registration to this location only.
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {editing ? "Save" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
