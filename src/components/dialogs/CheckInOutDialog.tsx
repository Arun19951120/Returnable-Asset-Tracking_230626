"use client";

import { useEffect, useState } from "react";
import { updateDocument, addDocument, logAudit, fetchAll } from "@/lib/storage";
import { Asset, Location, Project } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { X, Loader2, ArrowRight, MapPin, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { generateAssetsDC } from "@/lib/dc";

interface Props {
  asset: Asset;
  locations: Location[];
  onClose: () => void;
  initialMode?: Mode;
  checkInAllowedLocs?: string[];
  checkOutAllowedLocs?: string[];
}

type Mode = "checkout" | "checkin" | "transfer";

const MODE_CONFIG: Record<Mode, { label: string; statusOptions: Asset["status"][]; color: string; accentBorder: string }> = {
  checkout: { label: "Check-Out",  statusOptions: ["In-Transit"],                            color: "bg-orange-600", accentBorder: "border-orange-400" },
  checkin:  { label: "Check-In",   statusOptions: ["Available", "Maintenance"],              color: "bg-emerald-600", accentBorder: "border-emerald-400" },
  transfer: { label: "Transfer",   statusOptions: ["In-Transit", "Available"],               color: "bg-purple-600", accentBorder: "border-purple-400" },
};

export default function CheckInOutDialog({ asset, locations, onClose, initialMode, checkInAllowedLocs, checkOutAllowedLocs }: Props) {
  const { profile } = useAuth();
  const isCustomer = profile?.role === "Customer";
  // Customers can only Check-Out / Check-In — no Transfer.
  const modes: Mode[] = isCustomer ? ["checkout", "checkin"] : ["checkout", "checkin", "transfer"];

  const [mode, setMode]           = useState<Mode>(initialMode ?? "checkout");
  const [activeLocs, setActiveLocs] = useState<Location[]>(locations);
  const [destination, setDest]    = useState("");
  const [newStatus, setStatus]    = useState<Asset["status"]>("In-Transit");
  const [notes, setNotes]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);
  const [errors, setErrors]       = useState<string[]>([]);
  const [destError, setDestError] = useState(false);
  const [projects, setProjects]   = useState<Project[]>([]);
  const [targetProject, setTargetProject] = useState(asset.projectId ?? "");

  // Fetch active projects for the Transfer target-project selector.
  useEffect(() => {
    fetchAll<Project>("projects").then((all) => setProjects(all.filter((p) => p.status === "Active")));
  }, []);

  // Fetch active locations once; mode filtering happens in memory below.
  useEffect(() => {
    fetchAll<Location>("locations").then((all) =>
      setActiveLocs(all.filter((l) => l.status === "Active"))
    );
  }, []);

  // Mode-specific allowed destinations, derived without refetching
  const allLocations =
    mode === "checkin" && checkInAllowedLocs?.length
      ? activeLocs.filter((l) => checkInAllowedLocs.includes(l.name))
      : mode === "checkout" && checkOutAllowedLocs?.length
        ? activeLocs.filter((l) => checkOutAllowedLocs.includes(l.name))
        : activeLocs;

  useEffect(() => {
    setStatus(MODE_CONFIG[mode].statusOptions[0]);
    setErrors([]);
    setDestError(false);
    // Pre-fill the destination from the configured flow:
    // check-out → next stop in project flow; check-in → the asset's own location.
    if (mode === "checkout") {
      setDest(checkOutAllowedLocs?.length ? checkOutAllowedLocs[0] : "");
    } else if (mode === "checkin") {
      setDest(checkInAllowedLocs?.length === 1 ? checkInAllowedLocs[0] : asset.location);
    } else {
      setDest("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate(): string[] {
    const errs: string[] = [];
    if (!destination.trim()) {
      errs.push("Destination / location is required");
      setDestError(true);
    } else {
      setDestError(false);
    }
    if (mode === "transfer" && destination.trim() === asset.location) {
      errs.push("Transfer destination must be different from current location");
      setDestError(true);
    }
    if (mode === "transfer" && !targetProject) {
      errs.push("Select the project to transfer this asset to");
    }
    if (mode === "checkin" && asset.status === "Available") {
      errs.push(`Asset is already marked "Available" — it may already be checked in`);
    }
    if (mode === "checkout" && asset.status === "In-Transit") {
      errs.push(`Asset is currently "In-Transit" — complete the previous movement first`);
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setLoading(true);
    try {
      const changedProject = mode === "transfer" && targetProject && targetProject !== (asset.projectId ?? "");
      await updateDocument("assets", asset.id, {
        status: newStatus,
        location: destination.trim(),
        ...(mode === "transfer" && targetProject ? { projectId: targetProject } : {}),
        lastUpdated: new Date().toISOString(),
      });
      // Capture a movement record so each asset carries its full transaction history
      await addDocument("movements", {
        assetId: asset.id,
        assetName: asset.name,
        fromLocation: asset.location,
        toLocation: destination.trim(),
        movementType: mode === "checkout" ? "Checkout" : mode === "checkin" ? "Checkin" : "Transfer",
        status: newStatus === "In-Transit" ? "In-Transit" : "Completed",
        createdBy: profile?.uid ?? "",
        createdAt: new Date().toISOString(),
        completedBy: newStatus === "In-Transit" ? undefined : (profile?.uid ?? ""),
        completedAt: newStatus === "In-Transit" ? undefined : new Date().toISOString(),
        notes: [notes.trim(), changedProject ? `Project reassigned` : ""].filter(Boolean).join(" · ") || undefined,
      });
      await logAudit({
        userId: profile?.uid ?? "unknown",
        userEmail: profile?.email ?? "unknown",
        action: `${MODE_CONFIG[mode].label}: ${asset.name} · ${asset.location} → ${destination.trim()} [${newStatus}]${changedProject ? " (project changed)" : ""}`,
        category: "Asset",
        details: `ID: ${asset.id} | UUID: ${asset.uuid}${notes ? ` | Notes: ${notes}` : ""}`,
      });
      setDone(true);
    } catch {
      toast.error("Failed to update asset");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadDC() {
    await generateAssetsDC(
      [asset],
      asset.location,
      destination.trim() || "—",
      MODE_CONFIG[mode].label,
      "uuid",
      undefined,
      allLocations
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-900">Asset Transaction</h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{asset.uuid}</p>
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
                {asset.name} → <span className="font-medium text-slate-700">{destination}</span>
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
          <>
            {/* Mode selector */}
            <div className={`grid gap-1 border-b border-slate-100 bg-slate-50 px-4 py-3 ${modes.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {modes.map((m) => {
                const cfg = MODE_CONFIG[m];
                return (
                <button key={m} onClick={() => setMode(m)}
                  className={`rounded-lg py-2 text-xs font-semibold transition-all ${
                    mode === m ? `${cfg.color} text-white shadow-sm` : "bg-white text-slate-500 hover:bg-slate-100 border border-slate-200"
                  }`}>
                  {cfg.label}
                </button>
                );
              })}
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Validation errors */}
              {errors.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    <p className="text-xs font-semibold text-red-700">Cannot proceed — please fix the following:</p>
                  </div>
                  {errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600 pl-6">• {e}</p>
                  ))}
                </div>
              )}

              {/* Asset info */}
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 truncate">{asset.name}</p>
                  <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-400">
                    <MapPin className="h-3 w-3" />
                    <span>Currently at: <span className="font-medium text-slate-600">{asset.location}</span></span>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  asset.status === "Available" ? "bg-emerald-100 text-emerald-700" :
                  asset.status === "In-Transit" ? "bg-amber-100 text-amber-700" :
                  "bg-red-100 text-red-700"}`}>
                  {asset.status}
                </span>
              </div>

              {/* Transfer flow arrow */}
              {mode === "transfer" && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 bg-white">
                  <div className="flex-1 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">From</p>
                    <p className="text-sm font-semibold text-slate-700">{asset.location}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
                  <div className="flex-1 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">To</p>
                    <p className="text-sm font-semibold text-slate-500">{destination || "—"}</p>
                  </div>
                </div>
              )}

              {/* Destination */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {mode === "checkin" ? "Check-In Location *" : mode === "transfer" ? "Transfer Destination *" : "Dispatch To Location *"}
                </label>
                <input
                  required
                  list="loc-suggestions"
                  value={destination}
                  onChange={(e) => { setDest(e.target.value); setDestError(false); setErrors([]); }}
                  placeholder="Type or select a location…"
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
                    destError ? "border-red-400 bg-red-50 focus:border-red-500" : "border-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  }`}
                />
                <datalist id="loc-suggestions">
                  {allLocations.map((l) => <option key={l.id} value={l.name} />)}
                </datalist>
                {destError && <p className="mt-1 text-[10px] text-red-500 font-medium">⚠ This field is required</p>}
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
                </div>
              )}

              {/* Status */}
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

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Notes (optional)</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Carrier name, reference no., remarks…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose}
                  className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60 transition-colors ${MODE_CONFIG[mode].color}`}>
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm {MODE_CONFIG[mode].label}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
