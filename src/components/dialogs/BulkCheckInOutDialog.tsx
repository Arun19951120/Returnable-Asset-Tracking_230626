"use client";

import { useEffect, useState } from "react";
import { updateDocument, addDocument, logAudit, fetchAll } from "@/lib/storage";
import { Asset, Location, Project } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { X, Loader2, Package, Download, CheckCircle2, AlertCircle, List, LayoutList, Tag, Bluetooth, MapPin } from "lucide-react";
import { toast } from "sonner";
import { generateAssetsDC } from "@/lib/dc";
import type { DCOptions, DCLineMode } from "@/lib/dc";

interface Props {
  assetIds: string[];
  locations: Location[];
  onClose: () => void;
  initialMode?: Mode;
  initialDestination?: string;  // pre-filled & locked — no re-asking when set
}

type Mode = "checkout" | "checkin" | "transfer";

const MODE_CONFIG: Record<Mode, { label: string; statusOptions: Asset["status"][]; color: string }> = {
  checkout: { label: "Bulk Check-Out", statusOptions: ["In-Transit"],               color: "bg-orange-600" },
  checkin:  { label: "Bulk Check-In",  statusOptions: ["Available", "Maintenance"], color: "bg-emerald-600" },
  transfer: { label: "Bulk Transfer",  statusOptions: ["In-Transit", "Available"],  color: "bg-purple-600" },
};

export default function BulkCheckInOutDialog({ assetIds, locations, onClose, initialMode, initialDestination }: Props) {
  const { profile }   = useAuth();
  const [mode, setMode]               = useState<Mode>(initialMode ?? "checkout");
  const [allLocations, setAllLocs]    = useState<Location[]>(locations);
  const [allAssets, setAllAssets]     = useState<Asset[]>([]);
  const [projects, setProjects]       = useState<Project[]>([]);
  const [targetProject, setTargetProject] = useState("");
  const [destination, setDest]        = useState(initialDestination ?? "");
  const [newStatus, setStatus]        = useState<Asset["status"]>("In-Transit");
  const lockedDest = !!initialDestination;  // destination is pre-set — no dropdown needed
  const [loading, setLoading]         = useState(false);
  const [done, setDone]               = useState(false);
  const [errors, setErrors]           = useState<string[]>([]);
  const [destError, setDestError]     = useState(false);

  // DC options
  const [genDC, setGenDC]             = useState(false);
  const [dcLineMode, setDcLineMode]   = useState<DCLineMode>("individual");
  const [showRFID, setShowRFID]       = useState(false);
  const [showBLE, setShowBLE]         = useState(false);
  const [vehicleNo, setVehicleNo]     = useState("");
  const [driverName, setDriverName]   = useState("");
  const [hsnCode, setHsnCode]         = useState("998549");

  useEffect(() => {
    fetchAll<Location>("locations").then((all) => setAllLocs(all.filter((l) => l.status === "Active")));
    fetchAll<Asset>("assets").then(setAllAssets);
    fetchAll<Project>("projects").then((all) => setProjects(all.filter((p) => p.status === "Active")));
  }, []);

  useEffect(() => {
    setStatus(MODE_CONFIG[mode].statusOptions[0]);
    setErrors([]);
    setDestError(false);
  }, [mode]);

  const selectedAssets = allAssets.filter((a) => assetIds.includes(a.id));

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): string[] {
    const errs: string[] = [];
    if (!destination.trim()) {
      errs.push("Destination / location is required");
      setDestError(true);
    } else {
      setDestError(false);
    }
    if (assetIds.length === 0) {
      errs.push("No assets selected — select at least one asset");
    }
    if (mode === "transfer" && !targetProject) {
      errs.push("Select the project to transfer these assets to");
    }
    return errs;
  }

  function dcOptions(): DCOptions {
    return { lineMode: dcLineMode, showRFID, showBLE, vehicleNo: vehicleNo.trim(), driverName: driverName.trim(), hsnCode: hsnCode.trim() || "998549" };
  }

  async function handleSubmit(withDC: boolean) {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setLoading(true);
    try {
      const dest = destination.trim();
      await Promise.all(
        assetIds.map((id) =>
          updateDocument("assets", id, {
            status: newStatus,
            location: dest,
            ...(mode === "transfer" && targetProject ? { projectId: targetProject } : {}),
            lastUpdated: new Date().toISOString(),
          })
        )
      );

      // When checking out, create movement records + send global notification
      if (mode === "checkout") {
        const fromLoc = selectedAssets[0]?.location ?? "—";
        await Promise.all(
          selectedAssets.map((a) =>
            addDocument("movements", {
              assetId: a.id,
              assetName: a.name,
              fromLocation: fromLoc,
              toLocation: dest,
              movementType: "Checkout",
              status: "In-Transit",
              createdBy: profile?.uid ?? "",
              createdAt: new Date().toISOString(),
            })
          )
        );
        // Build summary grouped by description
        const descMap = new Map<string, number>();
        selectedAssets.forEach((a) => {
          const key = a.description?.trim() || a.name;
          descMap.set(key, (descMap.get(key) ?? 0) + 1);
        });
        const summary = [...descMap.entries()].map(([d, q]) => `• ${d} × ${q}`).join("\n");
        try {
          await addDocument("notifications", {
            title: `📦 Incoming Shipment — ${dest}`,
            message: `${assetIds.length} item${assetIds.length > 1 ? "s" : ""} dispatched from ${fromLoc}:\n${summary}`,
            type: "warning",
            read: false,
            createdAt: new Date().toISOString(),
          });
        } catch { /* non-blocking */ }
      }

      await logAudit({
        userId: profile?.uid ?? "unknown",
        userEmail: profile?.email ?? "unknown",
        action: `${MODE_CONFIG[mode].label}: ${assetIds.length} assets → ${dest} [${newStatus}]`,
        category: "Asset",
        details: `Asset IDs: ${assetIds.join(", ")}`,
      });

      if (withDC && selectedAssets.length) {
        await generateAssetsDC(
          selectedAssets,
          selectedAssets[0]?.location ?? "—",
          dest,
          MODE_CONFIG[mode].label,
          dcOptions(),
          undefined,
          allLocations,
          undefined,
          undefined,
          projects
        );
      }

      setDone(true);
    } catch {
      toast.error("Bulk update failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadDC() {
    if (!selectedAssets.length) return;
    await generateAssetsDC(
      selectedAssets,
      selectedAssets[0]?.location ?? "—",
      destination.trim() || "—",
      MODE_CONFIG[mode].label,
      dcOptions(),
      undefined,
      allLocations,
      undefined,
      undefined,
      projects
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 z-10">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-slate-600" />
            <h3 className="font-semibold text-slate-900">Bulk Transaction</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{assetIds.length} assets</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Success state ── */}
        {done ? (
          <div className="p-6 text-center space-y-4">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <div>
              <p className="font-semibold text-slate-900">{MODE_CONFIG[mode].label} Completed</p>
              <p className="text-sm text-slate-500 mt-1">
                {assetIds.length} assets → <span className="font-medium text-slate-700">{destination}</span>
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Close
              </button>
              {mode !== "checkin" && (
                <button onClick={handleDownloadDC}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
                  <Download className="h-4 w-4" /> Download DC
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Mode selector — hidden when initialMode locks the mode */}
            {!initialMode ? (
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                {(Object.entries(MODE_CONFIG) as [Mode, typeof MODE_CONFIG[Mode]][]).map(([m, cfg]) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`rounded-lg py-2 text-xs font-semibold transition-all ${
                      mode === m ? `${cfg.color} text-white shadow-sm` : "bg-white text-slate-500 hover:bg-slate-100 border border-transparent"
                    }`}>
                    {cfg.label.replace("Bulk ", "")}
                  </button>
                ))}
              </div>
            ) : (
              <div className={`rounded-xl px-4 py-2.5 text-xs font-bold text-white text-center ${MODE_CONFIG[mode].color}`}>
                {MODE_CONFIG[mode].label}
              </div>
            )}

            {/* Validation errors */}
            {errors.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-xs font-semibold text-red-700">Cannot proceed — please fix:</p>
                </div>
                {errors.map((e, i) => <p key={i} className="text-xs text-red-600 pl-6">• {e}</p>)}
              </div>
            )}

            {/* Asset chips */}
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium text-slate-500 mb-2">Applying to {assetIds.length} assets</p>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {selectedAssets.slice(0, 12).map((a) => (
                  <span key={a.id} className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600" title={a.name}>
                    {a.uuid.slice(-8).toUpperCase()}
                  </span>
                ))}
                {assetIds.length > 12 && <span className="text-xs text-slate-400">+{assetIds.length - 12} more</span>}
              </div>
            </div>

            {/* Destination */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {mode === "checkin" ? "Check-In Location" : mode === "transfer" ? "Transfer To Location" : "Dispatch To Location"}
              </label>
              {lockedDest ? (
                /* Pre-filled from SmartMovementPanel — show as locked label */
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span className="text-sm font-semibold text-emerald-800">{destination}</span>
                  <span className="ml-auto text-[10px] text-emerald-600 font-medium">Auto-filled</span>
                </div>
              ) : (
                <>
                  <input
                    required
                    list="bulk-loc-suggestions"
                    value={destination}
                    onChange={(e) => { setDest(e.target.value); setDestError(false); setErrors([]); }}
                    placeholder="Type or select a location…"
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
                      destError ? "border-red-400 bg-red-50 focus:border-red-500" : "border-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    }`}
                  />
                  <datalist id="bulk-loc-suggestions">
                    {allLocations.map((l) => <option key={l.id} value={l.name} />)}
                  </datalist>
                  {destError && <p className="mt-1 text-[10px] text-red-500 font-medium">⚠ This field is required</p>}
                </>
              )}
            </div>

            {/* Transfer target project */}
            {mode === "transfer" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Transfer To Project *</label>
                <select value={targetProject} onChange={(e) => { setTargetProject(e.target.value); setErrors([]); }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                  <option value="">— Select project —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.client})</option>)}
                </select>
                <p className="mt-1 text-[10px] text-slate-400">All {assetIds.length} selected assets will be reassigned to this project.</p>
              </div>
            )}

            {/* Status picker */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Set Status After Transaction</label>
              <div className="grid grid-cols-2 gap-2">
                {MODE_CONFIG[mode].statusOptions.map((s) => (
                  <button type="button" key={s} onClick={() => setStatus(s)}
                    className={`rounded-lg border py-2 text-xs font-medium transition-colors ${
                      newStatus === s ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* ── DC Options — only for checkout / transfer, not check-in ─────── */}
            {mode !== "checkin" && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              {/* Toggle header */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700">Delivery Challan (DC) Options</p>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs text-slate-500">Generate DC</span>
                  <div
                    className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${genDC ? "bg-slate-800" : "bg-slate-200"}`}
                    onClick={() => setGenDC((v) => !v)}>
                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${genDC ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                </label>
              </div>

              {genDC && (
                <div className="space-y-3">
                  {/* Line mode selector */}
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">DC Format</p>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Option 01 */}
                    <button type="button"
                      onClick={() => setDcLineMode("individual")}
                      className={`flex items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                        dcLineMode === "individual"
                          ? "border-slate-800 bg-slate-800 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}>
                      <List className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold">Option 01 — Individual</p>
                        <p className={`text-[10px] mt-0.5 leading-tight ${dcLineMode === "individual" ? "text-slate-300" : "text-slate-400"}`}>
                          One line per asset — UUID, price &amp; value per row
                        </p>
                      </div>
                    </button>

                    {/* Option 02 */}
                    <button type="button"
                      onClick={() => setDcLineMode("cumulative")}
                      className={`flex items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                        dcLineMode === "cumulative"
                          ? "border-slate-800 bg-slate-800 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}>
                      <LayoutList className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold">Option 02 — Cumulative</p>
                        <p className={`text-[10px] mt-0.5 leading-tight ${dcLineMode === "cumulative" ? "text-slate-300" : "text-slate-400"}`}>
                          Grouped by type + UUID/RFID/BLE list at bottom
                        </p>
                      </div>
                    </button>
                  </div>

                  {/* Column toggles */}
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide pt-1">Show in DC columns</p>
                  <div className="flex gap-3">
                    {/* RFID toggle */}
                    <label className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer select-none transition-colors ${
                      showRFID ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}>
                      <input type="checkbox" className="sr-only" checked={showRFID} onChange={(e) => setShowRFID(e.target.checked)} />
                      <Tag className={`h-3.5 w-3.5 ${showRFID ? "text-indigo-600" : "text-slate-400"}`} />
                      <div>
                        <p className={`text-xs font-semibold ${showRFID ? "text-indigo-700" : "text-slate-600"}`}>RFID Tag</p>
                        <p className="text-[10px] text-slate-400">Include RFID column</p>
                      </div>
                      <div className={`ml-auto h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
                        showRFID ? "border-indigo-600 bg-indigo-600" : "border-slate-300"
                      }`}>
                        {showRFID && <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 text-white fill-white"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                    </label>

                    {/* BLE toggle */}
                    <label className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer select-none transition-colors ${
                      showBLE ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}>
                      <input type="checkbox" className="sr-only" checked={showBLE} onChange={(e) => setShowBLE(e.target.checked)} />
                      <Bluetooth className={`h-3.5 w-3.5 ${showBLE ? "text-blue-600" : "text-slate-400"}`} />
                      <div>
                        <p className={`text-xs font-semibold ${showBLE ? "text-blue-700" : "text-slate-600"}`}>BLE Tag</p>
                        <p className="text-[10px] text-slate-400">Include BLE column</p>
                      </div>
                      <div className={`ml-auto h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
                        showBLE ? "border-blue-600 bg-blue-600" : "border-slate-300"
                      }`}>
                        {showBLE && <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 text-white fill-white"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                    </label>
                  </div>

                  {/* HSN Code */}
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">HSN Code</label>
                    <input value={hsnCode} onChange={(e) => setHsnCode(e.target.value)}
                      placeholder="998549"
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-400" />
                  </div>

                  {/* Carrier details */}
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide pt-1">Carrier / Vehicle Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Vehicle No.</label>
                      <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)}
                        placeholder="MH-12-AB-1234"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Driver Name</label>
                      <input value={driverName} onChange={(e) => setDriverName(e.target.value)}
                        placeholder="Driver name"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-400" />
                    </div>
                  </div>

                  {/* Preview hint */}
                  <p className="text-[10px] text-slate-400 italic">
                    {dcLineMode === "individual"
                      ? `Each asset → 1 row: Asset Name | UUID${showRFID ? " | RFID" : ""}${showBLE ? " | BLE" : ""} | Unit Price | Qty 1 | Total`
                      : `Grouped by type: Asset Name | 1st UUID${showRFID ? " | RFID" : ""}${showBLE ? " | BLE" : ""} | Unit Price | Total Qty | Total Value + Shipped Item Details at bottom`
                    }
                  </p>
                </div>
              )}
            </div>}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={() => handleSubmit(genDC)} disabled={loading}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${MODE_CONFIG[mode].color}`}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : genDC ? <Download className="h-3.5 w-3.5" /> : null}
                {genDC ? "Confirm + Download DC" : "Confirm"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
