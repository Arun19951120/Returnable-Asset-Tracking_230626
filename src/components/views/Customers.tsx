"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import { Customer } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { Plus, X, Edit2, Loader2, Building2, Mail, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";

const empty: Omit<Customer, "id" | "createdAt"> = {
  name: "", contactEmail: "", contactPhone: "", address: "", slaTarget: 7, status: "Active",
};

export default function Customers() {
  const { profile } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setCustomers(await fetchAll<Customer>("customers"));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...empty }); setShowForm(true); }
  function openEdit(c: Customer) { setEditing(c); setForm({ name: c.name, contactEmail: c.contactEmail, contactPhone: c.contactPhone ?? "", address: c.address ?? "", slaTarget: c.slaTarget ?? 7, status: c.status }); setShowForm(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateDocument("customers", editing.id, { ...form });
        toast.success("Customer updated");
      } else {
        await addDocument("customers", { ...form });
        toast.success("Customer added");
      }
      await logAudit({ userId: profile?.uid ?? "", userEmail: profile?.email ?? "", action: `${editing ? "Updated" : "Created"} customer: ${form.name}`, category: "User", details: form.contactEmail });
      setShowForm(false);
      load();
    } catch { toast.error("Failed to save customer"); }
    finally { setSaving(false); }
  }

  const active = customers.filter((c) => c.status === "Active").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500">{active} active accounts · {customers.length} total</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          <Plus className="h-4 w-4" /> Add Customer
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {customers.map((c) => (
          <div key={c.id} className={`rounded-xl border bg-white p-5 ${c.status === "Inactive" ? "opacity-60" : "border-slate-200"}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
                <Building2 className="h-5 w-5 text-slate-600" />
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.status}</span>
                <button onClick={() => openEdit(c)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Edit2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <p className="font-bold text-slate-900">{c.name}</p>
            <div className="mt-3 space-y-1.5 text-xs text-slate-500">
              <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{c.contactEmail}</div>
              {c.contactPhone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{c.contactPhone}</div>}
              {c.address && <div className="flex items-start gap-1.5"><MapPin className="h-3 w-3 mt-0.5 shrink-0" />{c.address}</div>}
            </div>
            {c.slaTarget && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs text-slate-500">SLA Target</span>
                <span className="font-mono text-xs font-bold text-slate-700">{c.slaTarget} days</span>
              </div>
            )}
          </div>
        ))}
        {customers.length === 0 && (
          <div className="col-span-3 rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-400">No customers yet</div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-900">{editing ? "Edit Customer" : "Add Customer"}</h3>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Company Name</label>
                  <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Contact Email</label>
                  <input required type="email" value={form.contactEmail} onChange={(e) => setForm((p) => ({ ...p, contactEmail: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
                  <input value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
                  <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">SLA Target (days)</label>
                  <input type="number" min={1} value={form.slaTarget} onChange={(e) => setForm((p) => ({ ...p, slaTarget: +e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as Customer["status"] }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    <option>Active</option><option>Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600">Cancel</button>
                <button type="submit" disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {editing ? "Save" : "Add Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
