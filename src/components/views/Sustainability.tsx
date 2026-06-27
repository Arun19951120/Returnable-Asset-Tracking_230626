"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, updateDocument } from "@/lib/storage";
import { Project, Asset, AssetMovement } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  TreePine, Droplets, Wind, Zap, Trash2, TrendingUp,
  Leaf, X, Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ─── Conversion factors ────────────────────────────────────────────────────────
const SUSTAIN = {
  corrugation: { trees: 0.017, waterL: 26.5, co2Kg: 1.5, kwh: 4.0, landfillKg: 3.2 },
  wood:        { trees: 0.015, waterL: 20.0, co2Kg: 1.2, kwh: 2.0, landfillKg: 1.0 },
};

function calcSustainability(woodKg: number, corrKg: number) {
  return {
    trees:      +(woodKg * SUSTAIN.wood.trees      + corrKg * SUSTAIN.corrugation.trees).toFixed(2),
    waterL:     +(woodKg * SUSTAIN.wood.waterL     + corrKg * SUSTAIN.corrugation.waterL).toFixed(1),
    co2Kg:      +(woodKg * SUSTAIN.wood.co2Kg      + corrKg * SUSTAIN.corrugation.co2Kg).toFixed(2),
    kwh:        +(woodKg * SUSTAIN.wood.kwh        + corrKg * SUSTAIN.corrugation.kwh).toFixed(2),
    landfillKg: +(woodKg * SUSTAIN.wood.landfillKg + corrKg * SUSTAIN.corrugation.landfillKg).toFixed(2),
  };
}

export default function Sustainability() {
  const { profile } = useAuth();
  const isAdmin   = profile?.role === "Admin";
  const isManager = profile?.role === "Manager";
  const canConfigure = isAdmin || isManager;

  const [projects,  setProjects]  = useState<Project[]>([]);
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [loading,   setLoading]   = useState(true);

  const [editId,   setEditId]   = useState<string | null>(null);
  const [woodVal,  setWoodVal]  = useState("");
  const [corrVal,  setCorrVal]  = useState("");
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, a, m] = await Promise.all([
      fetchAll<Project>("projects"),
      fetchAll<Asset>("assets"),
      fetchAll<AssetMovement>("movements"),
    ]);

    // Filter projects by user's assigned projects (for non-admin roles)
    const userProjects = (profile?.role === "Admin" || profile?.role === "Manager")
      ? p
      : p.filter((proj) =>
          // show project if user has it in their projects array OR has an asset in it
          (profile?.projects?.includes(proj.id)) ||
          a.some((asset) => asset.projectId === proj.id && asset.customerId === profile?.uid)
        );

    setProjects(userProjects);
    setAssets(a);
    setMovements(m);
    setLoading(false);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setSaving(true);
    try {
      await updateDocument("projects", editId, {
        woodPerAsset:        woodVal !== "" ? Number(woodVal) : 0,
        corrugationPerAsset: corrVal !== "" ? Number(corrVal) : 0,
      });
      toast.success("Sustainability config saved");
      setEditId(null);
      load();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  // ── Compute rows ──
  let grandTrees = 0, grandWater = 0, grandCO2 = 0, grandKwh = 0, grandLandfill = 0;
  const rows = projects.map((proj) => {
    const projAssetIds = new Set(assets.filter((a) => a.projectId === proj.id).map((a) => a.id));
    const count = movements.filter((m) => {
      if (!projAssetIds.has(m.assetId)) return false;
      if (m.status !== "Completed" && m.status !== "In-Transit") return false;
      if ((proj as Project & { poCountFromLocation?: string }).poCountFromLocation &&
          m.fromLocation !== (proj as Project & { poCountFromLocation?: string }).poCountFromLocation) return false;
      if ((proj as Project & { poCountToLocation?: string }).poCountToLocation &&
          m.toLocation !== (proj as Project & { poCountToLocation?: string }).poCountToLocation) return false;
      return true;
    }).length;
    const woodKg = (proj.woodPerAsset ?? 0) * count;
    const corrKg = (proj.corrugationPerAsset ?? 0) * count;
    const s      = calcSustainability(woodKg, corrKg);
    grandTrees    += s.trees;
    grandWater    += s.waterL;
    grandCO2      += s.co2Kg;
    grandKwh      += s.kwh;
    grandLandfill += s.landfillKg;
    return { proj, count, woodKg, corrKg, ...s };
  });

  const metrics = [
    { label: "Trees Saved",       value: grandTrees.toFixed(1),    unit: "trees",  icon: TreePine,  color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
    { label: "Water Saved",       value: grandWater >= 1000 ? (grandWater / 1000).toFixed(1) : grandWater.toFixed(0), unit: grandWater >= 1000 ? "kL" : "L", icon: Droplets, color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-200" },
    { label: "CO₂ Avoided",       value: grandCO2 >= 1000 ? (grandCO2 / 1000).toFixed(2) : grandCO2.toFixed(1), unit: grandCO2 >= 1000 ? "tonnes" : "kg", icon: Wind,     color: "text-teal-600",   bg: "bg-teal-50",   border: "border-teal-200" },
    { label: "Electricity Saved", value: grandKwh.toFixed(1),      unit: "kWh",    icon: Zap,       color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200" },
    { label: "Landfill Avoided",  value: grandLandfill >= 1000 ? (grandLandfill / 1000).toFixed(2) : grandLandfill.toFixed(1), unit: grandLandfill >= 1000 ? "tonnes" : "kg", icon: Trash2, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
  ];

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero banner */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-700 px-6 py-5 text-white shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Environmental Impact</p>
            <h1 className="mt-1 text-2xl font-bold">Sustainability Dashboard</h1>
            <p className="mt-1 text-sm text-emerald-300">
              Wood &amp; corrugation saved per asset cycle — your real impact on the planet
            </p>
            {!canConfigure && profile?.role && (
              <p className="mt-2 text-xs text-emerald-400 bg-white/10 rounded-lg px-3 py-1.5 inline-block">
                Showing projects assigned to your account
              </p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
              <Leaf className="h-5 w-5 text-emerald-300" />
              <div>
                <p className="text-xl font-bold">{assets.length}</p>
                <p className="text-xs text-emerald-300">Total Assets</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
              <TreePine className="h-5 w-5 text-emerald-300" />
              <div>
                <p className="text-xl font-bold">{projects.length}</p>
                <p className="text-xs text-emerald-300">Projects</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grand total KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {metrics.map(({ label, value, unit, icon: Icon, color, bg, border }) => (
          <div key={label} className={`rounded-2xl border ${border} ${bg} p-4 text-center`}>
            <Icon className={`h-6 w-6 mx-auto mb-1.5 ${color}`} />
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-0.5">{unit}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Methodology note */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
        <p className="font-semibold mb-1">Calculation methodology (per kg of material avoided):</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
          <p>🪵 <strong>Wood:</strong> 0.015 trees · 20L water · 1.2kg CO₂ · 2kWh · 1kg landfill</p>
          <p>📦 <strong>Corrugation:</strong> 0.017 trees · 26.5L water · 1.5kg CO₂ · 4kWh · 3.2kg landfill</p>
        </div>
      </div>

      {/* Per-project breakdown */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Project-wise Sustainability</h3>
          {canConfigure && (
            <p className="text-xs text-slate-400">Click ✎ Configure to set material savings per asset</p>
          )}
        </div>

        <div className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-400">
              {projects.length === 0 ? "No projects assigned to your account" : "No projects configured"}
            </div>
          )}
          {rows.map(({ proj, count, woodKg, corrKg, trees, waterL, co2Kg, kwh, landfillKg }) => (
            <div key={proj.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-slate-800">{proj.name}</h4>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${proj.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {proj.status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {count} dispatch{count !== 1 ? "es" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{proj.client}</p>

                  <div className="flex flex-wrap gap-3 mt-2 text-[11px]">
                    <span className="text-slate-500">
                      🪵 Wood: <strong>{proj.woodPerAsset ?? 0} kg</strong>/asset → <strong>{woodKg.toFixed(1)} kg</strong> total
                    </span>
                    <span className="text-slate-500">
                      📦 Corrugation: <strong>{proj.corrugationPerAsset ?? 0} kg</strong>/asset → <strong>{corrKg.toFixed(1)} kg</strong> total
                    </span>
                  </div>

                  {(woodKg > 0 || corrKg > 0) && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[
                        { icon: TreePine, val: trees,                                               unit: "trees",    col: "bg-emerald-100 text-emerald-700" },
                        { icon: Droplets, val: waterL >= 1000 ? (waterL/1000).toFixed(1) : waterL.toFixed(0), unit: waterL >= 1000 ? "kL" : "L", col: "bg-blue-100 text-blue-700" },
                        { icon: Wind,     val: co2Kg >= 1000 ? (co2Kg/1000).toFixed(2) : co2Kg.toFixed(1), unit: co2Kg >= 1000 ? "t CO₂" : "kg CO₂", col: "bg-teal-100 text-teal-700" },
                        { icon: Zap,      val: kwh.toFixed(1),                                      unit: "kWh",      col: "bg-yellow-100 text-yellow-700" },
                        { icon: Trash2,   val: landfillKg >= 1000 ? (landfillKg/1000).toFixed(2) : landfillKg.toFixed(1), unit: landfillKg >= 1000 ? "t" : "kg landfill", col: "bg-orange-100 text-orange-700" },
                      ].map(({ icon: Icon, val, unit, col }) => (
                        <span key={unit} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${col}`}>
                          <Icon className="h-3 w-3" />{val} {unit}
                        </span>
                      ))}
                    </div>
                  )}
                  {woodKg === 0 && corrKg === 0 && (
                    <p className="mt-1 text-[11px] text-slate-400 italic">
                      {canConfigure ? "No material config — click ✎ Configure to set kg/asset values" : "Environmental data not yet configured for this project"}
                    </p>
                  )}
                </div>

                {canConfigure && (
                  <button
                    onClick={() => { setEditId(proj.id); setWoodVal(String(proj.woodPerAsset ?? "")); setCorrVal(String(proj.corrugationPerAsset ?? "")); }}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-colors shrink-0"
                  >
                    ✎ Configure
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {rows.length > 0 && (
          <div className="border-t border-slate-200 bg-emerald-50 px-5 py-3">
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-emerald-800">
              <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Total Impact:</span>
              <span><TreePine className="inline h-3 w-3 mr-0.5" />{grandTrees.toFixed(1)} trees</span>
              <span><Droplets className="inline h-3 w-3 mr-0.5" />{grandWater >= 1000 ? (grandWater/1000).toFixed(1) + " kL" : grandWater.toFixed(0) + " L"} water</span>
              <span><Wind className="inline h-3 w-3 mr-0.5" />{grandCO2.toFixed(1)} kg CO₂</span>
              <span><Zap className="inline h-3 w-3 mr-0.5" />{grandKwh.toFixed(1)} kWh</span>
              <span><Trash2 className="inline h-3 w-3 mr-0.5" />{grandLandfill.toFixed(1)} kg landfill</span>
            </div>
          </div>
        )}
      </div>

      {/* Configure modal — Admin/Manager only */}
      {editId && canConfigure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-slate-900">Material Config</h3>
                <p className="text-xs text-slate-400">{projects.find((p) => p.id === editId)?.name}</p>
              </div>
              <button onClick={() => setEditId(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <form onSubmit={saveConfig} className="p-5 space-y-4">
              <p className="text-xs text-slate-500 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
                Enter the kg of each material that one asset replaces per cycle. Multiplied by dispatch count = total material saved.
              </p>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">🪵 Wood saved per asset (kg)</label>
                <input type="number" min={0} step={0.01} value={woodVal} placeholder="e.g. 2.5"
                  onChange={(e) => setWoodVal(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 bg-slate-50" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">📦 Corrugation saved per asset (kg)</label>
                <input type="number" min={0} step={0.01} value={corrVal} placeholder="e.g. 1.8"
                  onChange={(e) => setCorrVal(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 bg-slate-50" />
              </div>
              {(woodVal || corrVal) && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 space-y-0.5">
                  <p className="font-semibold mb-1">Preview per asset per cycle:</p>
                  {(() => {
                    const s = calcSustainability(Number(woodVal) || 0, Number(corrVal) || 0);
                    return [
                      `🌳 ${s.trees} trees saved`,
                      `💧 ${s.waterL} L water saved`,
                      `🌬 ${s.co2Kg} kg CO₂ avoided`,
                      `⚡ ${s.kwh} kWh electricity saved`,
                      `🗑 ${s.landfillKg} kg landfill avoided`,
                    ].map((l) => <p key={l}>{l}</p>);
                  })()}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditId(null)}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
