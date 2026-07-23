"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchAll, updateDocument, logAudit } from "@/lib/storage";
import { Asset, AssetMovement, Transfer, Location, Project } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  X, Loader2, Save, History, LogOut, LogIn, ArrowRightLeft, Package, MapPin, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { projectFlow } from "@/lib/flow";
import { LocationCostEditor, setCostEntry, scopeCosts } from "@/components/LocationCostEditor";

interface Props {
  asset: Asset;
  locations: Location[];
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

const STATUS_OPTIONS: Asset["status"][] = [
  "Available", "In-Transit", "Maintenance", "Under Repair", "Damaged", "Lost", "Retired",
];

const TYPE_META: Record<string, { Icon: typeof LogOut; cls: string; label: string }> = {
  Checkout: { Icon: LogOut, cls: "text-blue-500 bg-blue-50 border-blue-200", label: "Check-Out" },
  Checkin:  { Icon: LogIn, cls: "text-emerald-500 bg-emerald-50 border-emerald-200", label: "Check-In" },
  Transfer: { Icon: ArrowRightLeft, cls: "text-violet-500 bg-violet-50 border-violet-200", label: "Transfer" },
};

export default function AssetDetailDialog({ asset, locations, projects, onClose, onSaved }: Props) {
  const { profile } = useAuth();
  const [tab, setTab] = useState<"details" | "history">("details");
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: asset.name,
    description: asset.description ?? "",
    cost: asset.cost ?? 0,
    healthScore: asset.healthScore ?? 100,
    status: asset.status,
    location: asset.location,
    projectId: asset.projectId ?? "",
    rfidTag: asset.rfidTag ?? "",
    bleTag: asset.bleTag ?? "",
    conditionNotes: asset.conditionNotes ?? "",
  });
  const [locCosts, setLocCosts] = useState<Record<string, number>>(asset.locationCosts ?? {});

  const pm = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);
  // Flow locations of the asset's (possibly reassigned) project
  const flowLocs = useMemo(() => projectFlow(projects.find((p) => p.id === form.projectId)), [projects, form.projectId]);

  useEffect(() => {
    Promise.all([fetchAll<AssetMovement>("movements"), fetchAll<Transfer>("transfers")])
      .then(([m, t]) => {
        setMovements(m.filter((x) => x.assetId === asset.id));
        setTransfers(t.filter((x) => x.assetIds?.includes(asset.id)));
      })
      .finally(() => setLoadingHistory(false));
  }, [asset.id]);

  // Unified, date-sorted timeline of movements + transfers
  const timeline = useMemo(() => {
    const fromMovs = movements.map((m) => ({
      id: m.id, at: m.createdAt, type: m.movementType as string,
      from: m.fromLocation, to: m.toLocation, status: m.status, notes: m.notes,
    }));
    const fromTx = transfers.map((t) => ({
      id: t.id, at: t.createdAt, type: t.type.includes("Transfer") ? "Transfer" : "Transfer",
      from: t.fromLocation, to: t.toLocation, status: t.status, notes: t.notes,
    }));
    return [...fromMovs, ...fromTx].sort((a, b) => b.at.localeCompare(a.at));
  }, [movements, transfers]);

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Asset name is required"); return; }
    setSaving(true);
    try {
      await updateDocument("assets", asset.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        cost: Number(form.cost) || 0,
        locationCosts: (() => { const lc = scopeCosts(locCosts, flowLocs); return Object.keys(lc).length ? lc : undefined; })(),
        healthScore: Number(form.healthScore) || 0,
        status: form.status,
        location: form.location.trim(),
        projectId: form.projectId || undefined,
        rfidTag: form.rfidTag.trim() || undefined,
        bleTag: form.bleTag.trim() || undefined,
        conditionNotes: form.conditionNotes.trim() || undefined,
        lastUpdated: new Date().toISOString(),
      });
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Edited asset: ${form.name}`, category: "Asset",
        details: `UUID: ${asset.uuid}`,
      });
      toast.success("Asset updated");
      onSaved();
      onClose();
    } catch { toast.error("Failed to save asset"); }
    finally { setSaving(false); }
  }

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100">
              <Package className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 truncate">{asset.name}</p>
              <p className="text-xs font-mono text-slate-400">{asset.uuid}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-1 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <button onClick={() => setTab("details")}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${tab === "details" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-200"}`}>
            Details
          </button>
          <button onClick={() => setTab("history")}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${tab === "history" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-200"}`}>
            <History className="h-3.5 w-3.5" /> Movement History{timeline.length ? ` (${timeline.length})` : ""}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "details" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Asset Name *</label>
                <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Description / Category</label>
                <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Assign to Project</label>
                <select value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))} className={`${inputCls} bg-white`}>
                  <option value="">— No Project —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.client})</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as Asset["status"] }))} className={`${inputCls} bg-white`}>
                  {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Location</label>
                <input list="detail-loc" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} className={inputCls} />
                <datalist id="detail-loc">{locations.map((l) => <option key={l.id} value={l.name} />)}</datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Unit Cost / Declared Value (₹)</label>
                <input type="number" min={0} value={form.cost} onChange={(e) => setForm((p) => ({ ...p, cost: +e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Health Score (0–100)</label>
                <input type="number" min={0} max={100} value={form.healthScore} onChange={(e) => setForm((p) => ({ ...p, healthScore: +e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Cycles Completed</label>
                <input disabled value={asset.cycleCount ?? 0} className={`${inputCls} bg-slate-50 text-slate-400`} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">RFID Tag</label>
                <input value={form.rfidTag} onChange={(e) => setForm((p) => ({ ...p, rfidTag: e.target.value }))} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">BLE Tag</label>
                <input value={form.bleTag} onChange={(e) => setForm((p) => ({ ...p, bleTag: e.target.value }))} className={`${inputCls} font-mono`} />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Condition Notes</label>
                <textarea rows={2} value={form.conditionNotes} onChange={(e) => setForm((p) => ({ ...p, conditionNotes: e.target.value }))} className={`${inputCls} resize-none`} />
              </div>
              <div className="col-span-2">
                <LocationCostEditor locations={flowLocs} value={locCosts}
                  onSet={(loc, raw) => setCostEntry(setLocCosts, loc, raw)} />
              </div>
            </div>
          ) : (
            /* History timeline */
            loadingHistory ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
            ) : timeline.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">No movement or transfer history yet for this asset.</div>
            ) : (
              <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
                {timeline.map((ev) => {
                  const meta = TYPE_META[ev.type] ?? TYPE_META.Transfer;
                  const Icon = meta.Icon;
                  return (
                    <li key={ev.id} className="relative">
                      <span className={`absolute -left-[26px] flex h-5 w-5 items-center justify-center rounded-full border bg-white ${meta.cls}`}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-800">{meta.label}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ev.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{ev.status}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <MapPin className="h-3 w-3 text-slate-400" />
                          <span className="font-medium text-slate-600">{ev.from || "—"}</span>
                          <ArrowRightLeft className="h-3 w-3 text-slate-300" />
                          <span className="font-medium text-slate-600">{ev.to || "—"}</span>
                        </div>
                        {ev.notes && <p className="mt-1 text-[11px] text-slate-400">{ev.notes}</p>}
                        <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                          <Clock className="h-3 w-3" />
                          {new Date(ev.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )
          )}
        </div>

        {/* Footer */}
        {tab === "details" && (
          <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-5 py-4">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
