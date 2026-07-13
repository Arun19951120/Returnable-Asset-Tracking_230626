"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, deleteDocument, logAudit } from "@/lib/storage";
import { Project, Asset, Transfer, Location, Notification, AssetMovement } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Plus, X, Loader2, AlertTriangle, RefreshCw,
  Calendar, ClipboardList, Leaf, ChevronDown, ChevronUp,
  TreePine, Droplets, Wind, Zap, Trash2, Package,
  TrendingUp, Bell, Upload, FileText, Eye, Download,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
interface ProjectAlert {
  projectId: string;
  projectName: string;
  type: "project_end";
  message: string;
}

// ─── Sustainability conversion factors ───────────────────────────────────────
// Per kg of material avoided
const SUSTAIN = {
  corrugation: { trees: 0.017, waterL: 26.5, co2Kg: 1.5,  kwh: 4.0,  landfillKg: 3.2 },
  wood:        { trees: 0.015, waterL: 20.0, co2Kg: 1.2,  kwh: 2.0,  landfillKg: 1.0 },
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

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  target.setHours(23, 59, 59, 999);
  return Math.floor((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const EMPTY_FORM = {
  name: "", client: "", status: "Active" as Project["status"],
  startDate: "", endDate: "",
  allowedLocations: [] as string[],
};

const EMPTY_PO = {
  projectId: "",
  contractType: "po" as "po" | "agreement",
  // PO fields
  poNumber: "", poQty: "" as string | number,
  poEndDate: "", minQtyAlert: "" as string | number,
  poFileUrl: "", poFileName: "",
  poPrice: "" as string | number,
  // PO counting config
  poCountFromLocation: "", poCountToLocation: "",
  poBasis: "asset" as "asset" | "pack",
  packQty: "" as string | number,
  // Agreement fields
  agreementStartDate: "", agreementEndDate: "",
  agreementFileUrl: "", agreementFileName: "",
};

// ─── Month label helper ───────────────────────────────────────────────────────
function monthKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

// ─── PO Details Tab ───────────────────────────────────────────────────────────
function PODetailsTab({
  projects, assets, movements, locations, onUpdated,
}: { projects: Project[]; assets: Asset[]; movements: AssetMovement[]; locations: Location[]; onUpdated: () => void }) {
  const [editPO, setEditPO] = useState<typeof EMPTY_PO | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"po" | "agreement" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const poFileRef   = useRef<HTMLInputElement>(null);
  const agrFileRef  = useRef<HTMLInputElement>(null);

  // Generic file upload
  async function handleFileUpload(file: File, kind: "po" | "agreement") {
    if (!editPO) return;
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("prefix", `${kind.toUpperCase()}_${editPO.projectId.slice(0, 8)}`);
      const res  = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Upload failed"); return; }
      if (kind === "po") {
        setEditPO((p) => p && ({ ...p, poFileUrl: data.url, poFileName: data.name }));
      } else {
        setEditPO((p) => p && ({ ...p, agreementFileUrl: data.url, agreementFileName: data.name }));
      }
      toast.success(`"${data.name}" uploaded`);
    } catch { toast.error("Upload failed"); }
    finally { setUploading(null); }
  }

  // Month-on-month utilization — counts at dispatch (In-Transit) not just receipt (Completed)
  function getMonthlyUtil(proj: Project) {
    const projAssetIds = new Set(assets.filter((a) => a.projectId === proj.id).map((a) => a.id));

    // Count from dispatch: both In-Transit and Completed movements count; filter by from/to route if configured
    const filtered = movements.filter((m) => {
      if (!projAssetIds.has(m.assetId)) return false;
      if (m.status !== "Completed" && m.status !== "In-Transit") return false;
      if (proj.poCountFromLocation && m.fromLocation !== proj.poCountFromLocation) return false;
      if (proj.poCountToLocation   && m.toLocation   !== proj.poCountToLocation)   return false;
      return true;
    });

    const map: Record<string, number> = {};
    filtered.forEach((m) => {
      // Use dispatch date (createdAt) as the billing event — not receipt date
      const k = monthKey(m.createdAt);
      map[k] = (map[k] ?? 0) + 1;
    });

    const keys = Object.keys(map).sort();
    let cumAssets = 0;
    return keys.map((k) => {
      cumAssets += map[k];
      const isPack    = proj.poBasis === "pack" && (proj.packQty ?? 0) > 0;
      const packSize  = isPack ? (proj.packQty ?? 1) : 1;
      const invoiced  = isPack ? map[k] / packSize : map[k];
      const cumInvoiced = isPack ? cumAssets / packSize : cumAssets;
      return {
        key: k,
        label: monthLabel(k),
        movements: map[k],          // raw movement count
        invoiced: +invoiced.toFixed(2),     // invoiced qty this month
        cumAssets,                  // cumulative movements
        cumInvoiced: +cumInvoiced.toFixed(2), // cumulative invoiced qty
      };
    });
  }

  async function savePO(e: React.FormEvent) {
    e.preventDefault();
    if (!editPO?.projectId) return;
    setSaving(true);
    try {
      const isAgr = editPO.contractType === "agreement";
      const data: Partial<Project> = {
        contractType: editPO.contractType,
        // Agreement fields
        agreementStartDate: isAgr ? (editPO.agreementStartDate || undefined) : undefined,
        agreementEndDate:   isAgr ? (editPO.agreementEndDate   || undefined) : undefined,
        agreementFileUrl:   editPO.agreementFileUrl  || undefined,
        agreementFileName:  editPO.agreementFileName || undefined,
        // PO fields
        poNumber:    !isAgr ? (editPO.poNumber || undefined) : undefined,
        poQty:       !isAgr && editPO.poQty !== "" ? Number(editPO.poQty) : undefined,
        poEndDate:   !isAgr ? (editPO.poEndDate || undefined) : undefined,
        minQtyAlert: !isAgr && editPO.minQtyAlert !== "" ? Number(editPO.minQtyAlert) : undefined,
        poFileUrl:   editPO.poFileUrl  || undefined,
        poFileName:  editPO.poFileName || undefined,
        // PO counting config
        poCountFromLocation: !isAgr ? (editPO.poCountFromLocation || undefined) : undefined,
        poCountToLocation:   !isAgr ? (editPO.poCountToLocation   || undefined) : undefined,
        poBasis:   !isAgr ? editPO.poBasis : undefined,
        packQty:   !isAgr && editPO.poBasis === "pack" && editPO.packQty !== "" ? Number(editPO.packQty) : undefined,
        poPrice:   !isAgr && editPO.poPrice !== "" ? Number(editPO.poPrice) : undefined,
      };
      await updateDocument("projects", editPO.projectId, data);

      // PO qty alert check
      if (!isAgr && editPO.minQtyAlert !== "" && editPO.poQty !== "") {
        const proj = projects.find((p) => p.id === editPO.projectId);
        if (proj) {
          const used = assets.filter((a) => a.projectId === proj.id).length;
          const remaining = Number(editPO.poQty) - used;
          if (remaining <= Number(editPO.minQtyAlert)) {
            await addDocument("notifications", {
              title: "PO Qty Alert",
              message: `Project "${proj.name}" — only ${remaining} units remaining (threshold: ${editPO.minQtyAlert})`,
              type: "warning", read: false, createdAt: new Date().toISOString(),
            } as Omit<Notification, "id">);
          }
        }
      }

      toast.success(`${editPO.contractType === "agreement" ? "Agreement" : "PO"} details saved`);
      setEditPO(null);
      onUpdated();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  async function checkAndNotify(proj: Project) {
    if (!proj.poQty || !proj.minQtyAlert) return;
    const used = assets.filter((a) => a.projectId === proj.id).length;
    const remaining = proj.poQty - used;
    if (remaining <= proj.minQtyAlert) {
      await addDocument("notifications", {
        title: "PO Qty Alert",
        message: `Project "${proj.name}" — only ${remaining} units remaining out of PO qty ${proj.poQty} (threshold: ${proj.minQtyAlert})`,
        type: "warning", read: false, createdAt: new Date().toISOString(),
      } as Omit<Notification, "id">);
      toast.warning(`PO alert sent for ${proj.name}`);
    } else {
      toast.info(`${proj.name}: ${remaining} units remaining — above threshold`);
    }
  }

  function openEdit(proj: Project) {
    setEditPO({
      projectId:           proj.id,
      contractType:        proj.contractType ?? "po",
      poNumber:            proj.poNumber ?? "",
      poQty:               proj.poQty ?? "",
      poEndDate:           proj.poEndDate ?? "",
      minQtyAlert:         proj.minQtyAlert ?? "",
      poFileUrl:           proj.poFileUrl ?? "",
      poFileName:          proj.poFileName ?? "",
      poPrice:             proj.poPrice ?? "",
      poCountFromLocation: proj.poCountFromLocation ?? "",
      poCountToLocation:   proj.poCountToLocation   ?? "",
      poBasis:             proj.poBasis ?? "asset",
      packQty:             proj.packQty ?? "",
      agreementStartDate:  proj.agreementStartDate ?? "",
      agreementEndDate:    proj.agreementEndDate   ?? "",
      agreementFileUrl:    proj.agreementFileUrl   ?? "",
      agreementFileName:   proj.agreementFileName  ?? "",
    });
  }

  const configured = projects.filter((p) => p.contractType || p.poNumber || p.poQty || p.agreementStartDate);
  const unconfigured = projects.filter((p) => !p.contractType && !p.poNumber && !p.poQty && !p.agreementStartDate);

  // Reusable upload zone
  function UploadZone({ kind, fileUrl, fileName }: { kind: "po"|"agreement"; fileUrl: string; fileName: string }) {
    const ref = kind === "po" ? poFileRef : agrFileRef;
    const isUp = uploading === kind;
    const accent = kind === "agreement" ? { border: "border-purple-300", bg: "bg-purple-50", text: "text-purple-600", btn: "bg-purple-600 hover:bg-purple-700", label: "text-purple-800" } : { border: "border-blue-300", bg: "bg-blue-50", text: "text-blue-600", btn: "bg-blue-600 hover:bg-blue-700", label: "text-blue-800" };
    return (
      <div>
        {fileUrl && (
          <div className={`mb-2 flex items-center gap-2 rounded-xl border ${accent.border} ${accent.bg} px-3 py-2`}>
            <FileText className={`h-4 w-4 shrink-0 ${accent.text}`} />
            <p className={`flex-1 truncate text-xs font-medium ${accent.label}`}>{fileName}</p>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer"
              className={`rounded-lg ${accent.btn} px-2.5 py-1 text-[10px] font-semibold text-white`}>View</a>
            <button type="button"
              onClick={() => kind === "po"
                ? setEditPO((p) => p && ({ ...p, poFileUrl: "", poFileName: "" }))
                : setEditPO((p) => p && ({ ...p, agreementFileUrl: "", agreementFileName: "" }))
              }
              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-100">Remove</button>
          </div>
        )}
        <div
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 cursor-pointer transition-colors
            ${isUp ? `${accent.border} ${accent.bg}` : `border-slate-200 bg-slate-50 hover:${accent.border} hover:${accent.bg}`}`}
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f, kind); }}>
          {isUp ? (
            <><Loader2 className={`h-6 w-6 animate-spin ${accent.text}`} /><p className={`text-xs font-medium ${accent.text}`}>Uploading…</p></>
          ) : (
            <><Upload className="h-6 w-6 text-slate-300" /><p className="text-xs font-medium text-slate-600">{fileUrl ? "Replace file" : "Click or drag & drop"}</p><p className="text-[10px] text-slate-400">PDF · PNG · JPG · DOCX — max 10 MB</p></>
          )}
          <input ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, kind); e.target.value = ""; }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-800 px-6 py-5 text-white shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">Contracts & Orders</p>
            <h2 className="mt-1 text-2xl font-bold">PO / Agreement Details</h2>
            <p className="mt-1 text-sm text-blue-300">Track PO utilization month-on-month or manage agreement-based projects</p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold">{projects.filter((p) => p.contractType === "po" || p.poNumber).length}</p>
              <p className="text-xs text-blue-300">PO-based</p>
            </div>
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center backdrop-blur">
              <p className="text-2xl font-bold">{projects.filter((p) => p.contractType === "agreement").length}</p>
              <p className="text-xs text-blue-300">Agreement</p>
            </div>
          </div>
        </div>
      </div>

      {/* Project cards */}
      {configured.map((proj) => {
        const isAgr      = proj.contractType === "agreement";
        const monthly    = getMonthlyUtil(proj);
        const isPack     = !isAgr && proj.poBasis === "pack" && (proj.packQty ?? 0) > 0;
        const packSize   = isPack ? (proj.packQty ?? 1) : 1;
        // Cumulative invoiced from monthly data
        const cumInvoiced = monthly.length > 0 ? monthly[monthly.length - 1].cumInvoiced : 0;
        const used        = isPack ? cumInvoiced : (monthly.length > 0 ? monthly[monthly.length - 1].cumAssets : 0);
        const remaining   = !isAgr && (proj.poQty ?? 0) > 0 ? Math.max(0, proj.poQty! - used) : null;
        const pct         = !isAgr && proj.poQty ? Math.min(100, Math.round((used / proj.poQty) * 100)) : 0;
        const atAlert     = !isAgr && proj.minQtyAlert && remaining !== null && remaining <= proj.minQtyAlert;
        const isOpen      = expanded === proj.id;

        // Agreement validity
        const agrDays = isAgr && proj.agreementEndDate ? daysUntil(proj.agreementEndDate) : null;
        const agrExpired = agrDays !== null && agrDays < 0;

        return (
          <div key={proj.id} className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${atAlert ? "border-red-300" : agrExpired ? "border-red-300" : "border-slate-200"}`}>
            {/* Card header */}
            <div className="flex items-center gap-4 px-5 py-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900">{proj.name}</h3>
                  {/* Contract type badge */}
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${isAgr ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                    {isAgr ? "📋 Agreement" : "📄 PO Based"}
                  </span>
                  {atAlert && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"><AlertTriangle className="h-3 w-3" /> Low Stock</span>}
                  {agrExpired && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"><AlertTriangle className="h-3 w-3" /> Expired</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${proj.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{proj.status}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{proj.client}</p>
              </div>

              {/* KPI chips */}
              <div className="hidden sm:flex gap-3 text-center">
                {isAgr ? (
                  <>
                    {proj.agreementStartDate && (
                      <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-2">
                        <p className="text-[10px] text-purple-400 uppercase tracking-wider">Start</p>
                        <p className="text-sm font-bold text-purple-800">{new Date(proj.agreementStartDate).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"2-digit" })}</p>
                      </div>
                    )}
                    {proj.agreementEndDate && (
                      <div className={`rounded-lg px-3 py-2 border ${agrExpired ? "bg-red-50 border-red-200" : agrDays !== null && agrDays <= 30 ? "bg-amber-50 border-amber-200" : "bg-purple-50 border-purple-200"}`}>
                        <p className={`text-[10px] uppercase tracking-wider ${agrExpired ? "text-red-400" : "text-purple-400"}`}>End</p>
                        <p className={`text-sm font-bold ${agrExpired ? "text-red-700" : "text-purple-800"}`}>{new Date(proj.agreementEndDate).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"2-digit" })}</p>
                      </div>
                    )}
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                      <p className="text-[10px] text-emerald-500 uppercase tracking-wider">Assets Used</p>
                      <p className="text-sm font-bold text-emerald-700">{used}</p>
                    </div>
                  </>
                ) : (
                  <>
                    {proj.poNumber && <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2"><p className="text-[10px] text-slate-400 uppercase tracking-wider">PO No.</p><p className="text-sm font-bold text-slate-800 font-mono">{proj.poNumber}</p></div>}
                    {proj.poPrice != null && <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2"><p className="text-[10px] text-blue-400 uppercase tracking-wider">Price/Unit</p><p className="text-sm font-bold text-blue-700">₹{proj.poPrice.toLocaleString("en-IN")}</p></div>}
                    {proj.poQty && (
                      <>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2"><p className="text-[10px] text-slate-400 uppercase tracking-wider">PO Qty</p><p className="text-sm font-bold text-slate-800">{proj.poQty}</p></div>
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2"><p className="text-[10px] text-emerald-500 uppercase tracking-wider">Used</p><p className="text-sm font-bold text-emerald-700">{used}</p></div>
                        <div className={`rounded-lg px-3 py-2 border ${atAlert ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}><p className={`text-[10px] uppercase tracking-wider ${atAlert ? "text-red-500" : "text-amber-500"}`}>Remaining</p><p className={`text-sm font-bold ${atAlert ? "text-red-700" : "text-amber-700"}`}>{remaining}</p></div>
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-2 shrink-0">
                {!isAgr && <button onClick={() => checkAndNotify(proj)} title="Check qty alert" className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300 transition-colors"><Bell className="h-4 w-4" /></button>}
                <button onClick={() => openEdit(proj)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Edit</button>
                <button onClick={() => setExpanded(isOpen ? null : proj.id)} className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-50">
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* PO progress bar */}
            {!isAgr && proj.poQty && (
              <div className="px-5 pb-3 space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-400">
                    Utilization {isPack ? `(Pack basis: ${proj.packQty} assets/pack)` : "(Asset basis)"}
                  </span>
                  <span className="text-[10px] font-mono font-semibold text-slate-600">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full transition-all ${atAlert ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                </div>
                {/* Movement route — always visible, counted at dispatch */}
                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                  Counting dispatches:&nbsp;
                  <span className="font-semibold text-slate-700">
                    {proj.poCountFromLocation || "Any location"} → {proj.poCountToLocation || "Any location"}
                  </span>
                  {(!proj.poCountFromLocation || !proj.poCountToLocation) && (
                    <button onClick={() => openEdit(proj)} className="ml-1 text-blue-500 underline hover:text-blue-700">set route</button>
                  )}
                </p>
                {proj.poEndDate && <p className="text-[10px] text-slate-400">PO expires: {new Date(proj.poEndDate).toLocaleDateString("en-IN")}{daysUntil(proj.poEndDate) <= 30 && daysUntil(proj.poEndDate) >= 0 && <span className="ml-1 text-red-500 font-semibold">({daysUntil(proj.poEndDate)}d left)</span>}</p>}
                {proj.minQtyAlert && <p className="text-[10px] text-slate-400">Alert threshold: {proj.minQtyAlert} {isPack ? "packs" : "units"} remaining</p>}
              </div>
            )}

            {/* Agreement validity bar */}
            {isAgr && proj.agreementStartDate && proj.agreementEndDate && (
              <div className="px-5 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-400">Agreement validity</span>
                  {agrDays !== null && <span className={`text-[10px] font-semibold ${agrExpired ? "text-red-500" : agrDays <= 30 ? "text-amber-500" : "text-emerald-600"}`}>{agrExpired ? "Expired" : `${agrDays}d remaining`}</span>}
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  {(() => {
                    const total = new Date(proj.agreementEndDate).getTime() - new Date(proj.agreementStartDate).getTime();
                    const elapsed = Date.now() - new Date(proj.agreementStartDate).getTime();
                    const p2 = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
                    return <div className={`h-2 rounded-full transition-all ${agrExpired ? "bg-red-400" : agrDays !== null && agrDays <= 30 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${p2}%` }} />;
                  })()}
                </div>
              </div>
            )}

            {/* Uploaded documents */}
            {(proj.poFileUrl || proj.agreementFileUrl) && (
              <div className="mx-5 mb-2 flex flex-wrap gap-2">
                {proj.poFileUrl && (
                  <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 flex-1 min-w-0">
                    <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                    <p className="flex-1 truncate text-xs font-semibold text-blue-800">{proj.poFileName ?? "PO Document"}</p>
                    <a href={proj.poFileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-blue-700"><Eye className="h-3 w-3" /> View</a>
                    <a href={proj.poFileUrl} download={proj.poFileName} className="flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-50"><Download className="h-3 w-3" /></a>
                  </div>
                )}
                {proj.agreementFileUrl && (
                  <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 flex-1 min-w-0">
                    <FileText className="h-4 w-4 text-purple-500 shrink-0" />
                    <p className="flex-1 truncate text-xs font-semibold text-purple-800">{proj.agreementFileName ?? "Agreement"}</p>
                    <a href={proj.agreementFileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-purple-700"><Eye className="h-3 w-3" /> View</a>
                    <a href={proj.agreementFileUrl} download={proj.agreementFileName} className="flex items-center gap-1 rounded-lg border border-purple-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-purple-700 hover:bg-purple-50"><Download className="h-3 w-3" /></a>
                  </div>
                )}
              </div>
            )}

            {/* Monthly utilization */}
            {isOpen && (
              <div className="border-t border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Month-on-Month Utilization</p>
                  {!isAgr && (
                    <span className="text-[10px] rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-blue-700 font-medium">
                      {proj.poCountFromLocation || "Any"} → {proj.poCountToLocation || "Any"} · at dispatch
                    </span>
                  )}
                </div>
                {monthly.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-3">
                    {!isAgr && (proj.poCountFromLocation || proj.poCountToLocation)
                      ? `No completed movements from "${proj.poCountFromLocation || "Any"}" → "${proj.poCountToLocation || "Any"}" yet`
                      : "No completed movements recorded yet"}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 uppercase tracking-wider">Month</th>
                          <th className="px-3 py-2 text-center font-semibold text-slate-500 uppercase tracking-wider">Movements</th>
                          {isPack && <th className="px-3 py-2 text-center font-semibold text-slate-500 uppercase tracking-wider">Invoice Qty (Packs)</th>}
                          <th className="px-3 py-2 text-center font-semibold text-slate-500 uppercase tracking-wider">
                            {isPack ? "Cum. Packs" : "Cumulative"}
                          </th>
                          {!isAgr && proj.poQty && <th className="px-3 py-2 text-right font-semibold text-slate-500 uppercase tracking-wider">% of PO</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {monthly.map((row) => {
                          const displayUsed = isPack ? row.cumInvoiced : row.cumAssets;
                          const rowPct = !isAgr && proj.poQty ? ((displayUsed / proj.poQty) * 100).toFixed(1) : null;
                          const barW   = !isAgr && proj.poQty ? Math.min(100, (displayUsed / proj.poQty) * 100) : 100;
                          return (
                            <tr key={row.key} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{row.label}</td>
                              <td className="px-3 py-2 text-center">
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono font-bold text-blue-700">+{row.movements}</span>
                              </td>
                              {isPack && (
                                <td className="px-3 py-2 text-center">
                                  <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono font-bold text-violet-700">
                                    {row.invoiced}
                                  </span>
                                </td>
                              )}
                              <td className="px-3 py-2 text-center">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 rounded-full bg-slate-100">
                                    <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${barW}%` }} />
                                  </div>
                                  <span className="font-mono font-bold text-slate-800 w-10 text-right">
                                    {isPack ? row.cumInvoiced : row.cumAssets}
                                  </span>
                                </div>
                              </td>
                              {!isAgr && proj.poQty && (
                                <td className="px-3 py-2 text-right font-mono text-slate-500">{rowPct}%</td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      {monthly.length > 1 && (
                        <tfoot>
                          <tr className="border-t-2 border-slate-200 bg-slate-50">
                            <td className="px-3 py-2 font-bold text-slate-700">Total</td>
                            <td className="px-3 py-2 text-center font-mono font-bold text-blue-700">
                              {monthly.reduce((s, r) => s + r.movements, 0)}
                            </td>
                            {isPack && (
                              <td className="px-3 py-2 text-center font-mono font-bold text-violet-700">
                                {monthly.reduce((s, r) => s + r.invoiced, 0).toFixed(2)}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center font-mono font-bold text-emerald-700">
                              {isPack ? monthly[monthly.length - 1].cumInvoiced : monthly[monthly.length - 1].cumAssets}
                            </td>
                            {!isAgr && proj.poQty && (
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-600">
                                {((( isPack ? monthly[monthly.length-1].cumInvoiced : monthly[monthly.length-1].cumAssets) / proj.poQty) * 100).toFixed(1)}%
                              </td>
                            )}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Unconfigured projects */}
      {unconfigured.length > 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Projects without contract details</p>
          <div className="space-y-2">
            {unconfigured.map((proj) => (
              <div key={proj.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5">
                <div><p className="text-sm font-medium text-slate-700">{proj.name}</p><p className="text-xs text-slate-400">{proj.client}</p></div>
                <button onClick={() => openEdit(proj)} className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">+ Add Contract</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 z-10">
              <div>
                <h3 className="font-semibold text-slate-900">Contract Details</h3>
                <p className="text-xs text-slate-400">{projects.find((p) => p.id === editPO.projectId)?.name}</p>
              </div>
              <button onClick={() => setEditPO(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <form onSubmit={savePO} className="p-5 space-y-5">

              {/* Contract type toggle */}
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">Contract Type *</label>
                <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                  {(["po", "agreement"] as const).map((t) => (
                    <button key={t} type="button"
                      onClick={() => setEditPO((p) => p && ({ ...p, contractType: t }))}
                      className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${editPO.contractType === t
                        ? t === "po" ? "bg-blue-600 text-white" : "bg-purple-600 text-white"
                        : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}>
                      {t === "po" ? "📄 PO Based" : "📋 Agreement Based"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Agreement fields */}
              {editPO.contractType === "agreement" && (
                <div className="space-y-4 rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <p className="text-xs font-semibold text-purple-700 uppercase tracking-wider">Agreement Details</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Agreement Start Date *</label>
                      <input type="date" required value={editPO.agreementStartDate}
                        onChange={(e) => setEditPO((p) => p && ({ ...p, agreementStartDate: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-purple-400 bg-white" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Agreement End Date *</label>
                      <input type="date" required value={editPO.agreementEndDate}
                        onChange={(e) => setEditPO((p) => p && ({ ...p, agreementEndDate: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-purple-400 bg-white" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Agreement Document</label>
                    <UploadZone kind="agreement" fileUrl={editPO.agreementFileUrl} fileName={editPO.agreementFileName} />
                  </div>
                </div>
              )}

              {/* PO fields */}
              {editPO.contractType === "po" && (
                <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">PO Details</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">PO Number</label>
                      <input value={editPO.poNumber} placeholder="e.g. PO-2024-001"
                        onChange={(e) => setEditPO((p) => p && ({ ...p, poNumber: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white font-mono" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">PO Qty (Total)</label>
                      <input type="number" min={0} value={editPO.poQty} placeholder="e.g. 500"
                        onChange={(e) => setEditPO((p) => p && ({ ...p, poQty: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Min Qty Alert</label>
                      <input type="number" min={0} value={editPO.minQtyAlert} placeholder="Alert at ≤ this"
                        onChange={(e) => setEditPO((p) => p && ({ ...p, minQtyAlert: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white" />
                      <p className="mt-1 text-[10px] text-slate-400">Notification when remaining ≤ this</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Price per Unit (₹)</label>
                      <input type="number" min={0} step="0.01" value={editPO.poPrice} placeholder="e.g. 1500"
                        onChange={(e) => setEditPO((p) => p && ({ ...p, poPrice: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white" />
                      <p className="mt-1 text-[10px] text-slate-400">Per asset or per pack depending on billing basis</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">PO End Date</label>
                      <input type="date" value={editPO.poEndDate}
                        onChange={(e) => setEditPO((p) => p && ({ ...p, poEndDate: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white" />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">PO Document</label>
                      <UploadZone kind="po" fileUrl={editPO.poFileUrl} fileName={editPO.poFileName} />
                    </div>
                  </div>

                  {/* ── Movement counting config ── */}
                  <div className="border-t border-blue-200 pt-4 space-y-4">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Movement Counting Config</p>

                    {/* Location filter */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Count Dispatches From</label>
                        <select value={editPO.poCountFromLocation}
                          onChange={(e) => setEditPO((p) => p && ({ ...p, poCountFromLocation: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                          <option value="">— Any location —</option>
                          {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                        </select>
                        <p className="mt-1 text-[10px] text-slate-400">Set source — e.g. Master Warehouse</p>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Count Dispatches To</label>
                        <select value={editPO.poCountToLocation}
                          onChange={(e) => setEditPO((p) => p && ({ ...p, poCountToLocation: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                          <option value="">— Any location —</option>
                          {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                        </select>
                        <p className="mt-1 text-[10px] text-slate-400">Set destination — e.g. Tier 1 Site</p>
                      </div>
                    </div>

                    {/* PO Basis toggle */}
                    <div>
                      <label className="mb-2 block text-xs font-semibold text-slate-600">PO Billing Basis *</label>
                      <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                        {(["asset", "pack"] as const).map((b) => (
                          <button key={b} type="button"
                            onClick={() => setEditPO((p) => p && ({ ...p, poBasis: b, packQty: b === "asset" ? "" : p.packQty }))}
                            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${editPO.poBasis === b
                              ? "bg-blue-600 text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                            {b === "asset" ? "📦 Asset Qty" : "🗂️ Pack Qty"}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[10px] text-slate-400">
                        {editPO.poBasis === "asset"
                          ? "Each movement = 1 unit toward PO qty."
                          : "Multiple assets make up 1 pack — invoiced qty = movements ÷ pack size."}
                      </p>
                    </div>

                    {/* Pack size — only when pack basis */}
                    {editPO.poBasis === "pack" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Pack Size (Assets per Pack) *</label>
                        <div className="flex items-center gap-3">
                          <input type="number" min={1} required value={editPO.packQty} placeholder="e.g. 10"
                            onChange={(e) => setEditPO((p) => p && ({ ...p, packQty: e.target.value }))}
                            className="w-36 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white" />
                          <p className="text-xs text-slate-500">assets = 1 invoiced pack</p>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">
                          e.g. if pack size = 10 and 30 assets moved this month → invoiced qty = 3 packs
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setEditPO(null)}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${editPO.contractType === "agreement" ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"}`}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save {editPO.contractType === "agreement" ? "Agreement" : "PO"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sustainability Tab ───────────────────────────────────────────────────────
function SustainabilityTab({
  projects, assets, movements, onUpdated,
}: { projects: Project[]; assets: Asset[]; movements: AssetMovement[]; onUpdated: () => void }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [woodVal, setWoodVal] = useState("");
  const [corrVal, setCorrVal] = useState("");
  const [saving, setSaving] = useState(false);

  // Grand totals across all projects
  let grandTrees = 0, grandWater = 0, grandCO2 = 0, grandKwh = 0, grandLandfill = 0;
  const rows = projects.map((proj) => {
    // Count dispatches using the same PO config (from/to location filter, at dispatch time)
    const projAssetIds = new Set(assets.filter((a) => a.projectId === proj.id).map((a) => a.id));
    const count = movements.filter((m) => {
      if (!projAssetIds.has(m.assetId)) return false;
      if (m.status !== "Completed" && m.status !== "In-Transit") return false;
      if (proj.poCountFromLocation && m.fromLocation !== proj.poCountFromLocation) return false;
      if (proj.poCountToLocation   && m.toLocation   !== proj.poCountToLocation)   return false;
      return true;
    }).length;
    const woodKg  = (proj.woodPerAsset ?? 0) * count;
    const corrKg  = (proj.corrugationPerAsset ?? 0) * count;
    const s       = calcSustainability(woodKg, corrKg);
    grandTrees    += s.trees;
    grandWater    += s.waterL;
    grandCO2      += s.co2Kg;
    grandKwh      += s.kwh;
    grandLandfill += s.landfillKg;
    return { proj, count, woodKg, corrKg, ...s };
  });

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setSaving(true);
    try {
      await updateDocument("projects", editId, {
        woodPerAsset:         woodVal !== "" ? Number(woodVal) : 0,
        corrugationPerAsset:  corrVal !== "" ? Number(corrVal) : 0,
      });
      toast.success("Sustainability config saved");
      setEditId(null);
      onUpdated();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  const metrics = [
    { label: "Trees Saved",       value: grandTrees.toFixed(1),    unit: "trees",  icon: TreePine,  color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
    { label: "Water Saved",       value: grandWater >= 1000 ? (grandWater / 1000).toFixed(1) : grandWater.toFixed(0), unit: grandWater >= 1000 ? "kL" : "L", icon: Droplets, color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-200" },
    { label: "CO₂ Avoided",       value: grandCO2 >= 1000 ? (grandCO2 / 1000).toFixed(2) : grandCO2.toFixed(1), unit: grandCO2 >= 1000 ? "tonnes" : "kg", icon: Wind,     color: "text-teal-600",   bg: "bg-teal-50",   border: "border-teal-200" },
    { label: "Electricity Saved", value: grandKwh.toFixed(1),      unit: "kWh",    icon: Zap,       color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200" },
    { label: "Landfill Avoided",  value: grandLandfill >= 1000 ? (grandLandfill / 1000).toFixed(2) : grandLandfill.toFixed(1), unit: grandLandfill >= 1000 ? "tonnes" : "kg", icon: Trash2, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-700 px-6 py-5 text-white shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Environmental Impact</p>
            <h2 className="mt-1 text-2xl font-bold">Sustainability Calculator</h2>
            <p className="mt-1 text-sm text-emerald-300">Wood & corrugation saved per asset cycle — quantified impact on the planet</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
            <Leaf className="h-5 w-5 text-emerald-300" />
            <div>
              <p className="text-xl font-bold">{assets.length}</p>
              <p className="text-xs text-emerald-300">Total Assets</p>
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
          <p>🪵 <strong>Wood:</strong> 0.015 trees · 20L water · 1.2kg CO₂ · 2kWh · 1kg landfill</p>
          <p>📦 <strong>Corrugation:</strong> 0.017 trees · 26.5L water · 1.5kg CO₂ · 4kWh · 3.2kg landfill</p>
        </div>
      </div>

      {/* Per-project breakdown */}
      <div className="card-bento overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Project-wise Sustainability</h3>
          <p className="text-xs text-slate-400">Click ✎ to configure material savings per asset</p>
        </div>
        <div className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <div className="py-10 text-center text-slate-400 text-sm">No projects configured</div>
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
                      {count} asset{count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{proj.client}</p>

                  {/* Config row */}
                  <div className="flex flex-wrap gap-3 mt-2 text-[11px]">
                    <span className="text-slate-500">
                      🪵 Wood: <strong>{proj.woodPerAsset ?? 0} kg</strong>/asset → <strong>{woodKg.toFixed(1)} kg</strong> total
                    </span>
                    <span className="text-slate-500">
                      📦 Corrugation: <strong>{proj.corrugationPerAsset ?? 0} kg</strong>/asset → <strong>{corrKg.toFixed(1)} kg</strong> total
                    </span>
                  </div>

                  {/* Sustainability pills */}
                  {(woodKg > 0 || corrKg > 0) && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[
                        { icon: TreePine,  val: trees,                                               unit: "trees",    col: "bg-emerald-100 text-emerald-700" },
                        { icon: Droplets,  val: waterL >= 1000 ? (waterL/1000).toFixed(1) : waterL.toFixed(0), unit: waterL >= 1000 ? "kL" : "L", col: "bg-blue-100 text-blue-700" },
                        { icon: Wind,      val: co2Kg >= 1000 ? (co2Kg/1000).toFixed(2) : co2Kg.toFixed(1), unit: co2Kg >= 1000 ? "t CO₂" : "kg CO₂", col: "bg-teal-100 text-teal-700" },
                        { icon: Zap,       val: kwh.toFixed(1),                                      unit: "kWh",      col: "bg-yellow-100 text-yellow-700" },
                        { icon: Trash2,    val: landfillKg >= 1000 ? (landfillKg/1000).toFixed(2) : landfillKg.toFixed(1), unit: landfillKg >= 1000 ? "t" : "kg landfill", col: "bg-orange-100 text-orange-700" },
                      ].map(({ icon: Icon, val, unit, col }) => (
                        <span key={unit} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${col}`}>
                          <Icon className="h-3 w-3" />{val} {unit}
                        </span>
                      ))}
                    </div>
                  )}
                  {woodKg === 0 && corrKg === 0 && (
                    <p className="mt-1 text-[11px] text-slate-400 italic">No material config — click ✎ to set kg/asset values</p>
                  )}
                </div>

                <button
                  onClick={() => {
                    setEditId(proj.id);
                    setWoodVal(String(proj.woodPerAsset ?? ""));
                    setCorrVal(String(proj.corrugationPerAsset ?? ""));
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-colors shrink-0">
                  ✎ Configure
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Grand total footer */}
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

      {/* Config modal */}
      {editId && (
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
                Enter the kg of each material that one asset replaces per cycle. Multiply by asset count = total material saved.
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
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Projects() {
  useAuth();
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [movements, setMovements]   = useState<AssetMovement[]>([]);
  const [activeTab, setActiveTab] = useState<"projects" | "po" | "sustainability">("projects");
  const [showForm,  setShowForm]  = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form,      setForm]      = useState({ ...EMPTY_FORM });
  const [saving,    setSaving]    = useState(false);
  const [alerts,    setAlerts]    = useState<ProjectAlert[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewDate,  setRenewDate]  = useState("");
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const { profile } = useAuth();
  const isAdmin = profile?.role === "Admin";

  const load = useCallback(async () => {
    const [p, a, t, l, m] = await Promise.all([
      fetchAll<Project>("projects"),
      fetchAll<Asset>("assets"),
      fetchAll<Transfer>("transfers"),
      fetchAll<Location>("locations"),
      fetchAll<AssetMovement>("movements"),
    ]);
    setProjects(p);
    setAssets(a);
    setTransfers(t);
    setLocations(l);
    setMovements(m);

    const activeAlerts: ProjectAlert[] = [];
    p.filter((proj) => proj.status === "Active").forEach((proj) => {
      if (proj.endDate) {
        const days = daysUntil(proj.endDate);
        if (days >= 0 && days <= 60) {
          activeAlerts.push({
            projectId: proj.id, projectName: proj.name, type: "project_end",
            message: `Project ends in ${days} day${days !== 1 ? "s" : ""} on ${new Date(proj.endDate).toLocaleDateString("en-IN")}`,
          });
        }
      }
    });
    setAlerts(activeAlerts);
    if (activeAlerts.length > 0) setShowAlerts(true);

    // Auto-check PO min qty alerts
    for (const proj of p) {
      if (proj.poQty && proj.minQtyAlert) {
        const used = a.filter((ast) => ast.projectId === proj.id).length;
        const remaining = proj.poQty - used;
        if (remaining <= proj.minQtyAlert) {
          // Check if we already have a recent notification for this
          const allNotifs = await fetchAll<Notification>("notifications");
          const recentKey = `PO Qty Alert`;
          const already = allNotifs.some(
            (n) => n.title === recentKey && n.message.includes(proj.name) && !n.read
          );
          if (!already) {
            await addDocument("notifications", {
              title: recentKey,
              message: `Project "${proj.name}" — only ${remaining} units remaining out of PO qty ${proj.poQty} (threshold: ${proj.minQtyAlert})`,
              type: "warning", read: false, createdAt: new Date().toISOString(),
            } as Omit<Notification, "id">);
          }
        }
      }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditingId(null); setForm({ ...EMPTY_FORM }); setShowForm(true); }
  function openEdit(proj: Project) {
    setEditingId(proj.id);
    setForm({
      name: proj.name, client: proj.client, status: proj.status,
      startDate: proj.startDate ?? "", endDate: proj.endDate ?? "",
      allowedLocations: proj.allowedLocations ?? [],
    });
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.client) { toast.error("Name and client are required"); return; }
    setSaving(true);
    try {
      const data: Partial<Project> = {
        name: form.name, client: form.client, status: form.status,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        allowedLocations: form.allowedLocations.length > 0 ? form.allowedLocations : undefined,
      };
      if (editingId) {
        await updateDocument("projects", editingId, data);
        toast.success("Project updated");
      } else {
        await addDocument("projects", data);
        toast.success("Project created");
      }
      setShowForm(false);
      load();
    } catch { toast.error("Failed to save project"); }
    finally { setSaving(false); }
  }

  async function handleDeleteProject() {
    if (!confirmDeleteProject) return;
    setDeletingProject(true);
    try {
      await deleteDocument("projects", confirmDeleteProject.id);
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Project deleted: ${confirmDeleteProject.name}`,
        category: "Project", details: `Client: ${confirmDeleteProject.client}`,
      });
      toast.success(`Project "${confirmDeleteProject.name}" deleted`);
      setConfirmDeleteProject(null);
      load();
    } catch {
      toast.error("Failed to delete project");
    } finally {
      setDeletingProject(false);
    }
  }

  async function handleRenew() {
    if (!renewingId || !renewDate) return;
    await updateDocument("projects", renewingId, { endDate: renewDate, status: "Active" });
    toast.success("Project renewed");
    setRenewingId(null); setRenewDate(""); load();
  }

  const alertBg: Record<ProjectAlert["type"], string> = {
    project_end: "border-amber-200 bg-amber-50 text-amber-800",
  };

  const TABS = [
    { id: "projects"      as const, label: "Projects",       icon: Package },
    { id: "po"            as const, label: "PO Details",     icon: ClipboardList },
    { id: "sustainability"as const, label: "Sustainability",  icon: Leaf },
  ];

  return (
    <div className="space-y-4">
      {/* ── Alert Popup ── */}
      {showAlerts && alerts.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white shadow-xl">
            <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-5 py-4 rounded-t-xl">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <h3 className="font-semibold text-slate-900">Project Alerts</h3>
                <p className="text-xs text-slate-400">{alerts.length} item{alerts.length > 1 ? "s" : ""} need attention</p>
              </div>
              <button onClick={() => setShowAlerts(false)} className="ml-auto"><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              {alerts.map((alert, i) => (
                <div key={i} className={`rounded-lg border px-4 py-3 ${alertBg[alert.type]}`}>
                  <p className="text-xs font-semibold">{alert.projectName}</p>
                  <p className="text-xs mt-0.5">{alert.message}</p>
                </div>
              ))}
              <button onClick={() => setShowAlerts(false)}
                className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page Header + Tabs ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          {alerts.length > 0 && (
            <button onClick={() => setShowAlerts(true)}
              className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100">
              <AlertTriangle className="h-4 w-4" /> {alerts.length} Alert{alerts.length > 1 ? "s" : ""}
            </button>
          )}
          {activeTab === "projects" && (
            <button onClick={openCreate}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" /> New Project
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === id
                ? id === "po" ? "bg-blue-600 text-white shadow-sm"
                  : id === "sustainability" ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-900 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "po" && (
        <PODetailsTab projects={projects} assets={assets} movements={movements} locations={locations} onUpdated={load} />
      )}
      {activeTab === "sustainability" && (
        <SustainabilityTab projects={projects} assets={assets} movements={movements} onUpdated={load} />
      )}

      {activeTab === "projects" && (
        <>
          {/* ── Project Cards ── */}
          <div className="grid gap-4">
            {projects.length === 0 && (
              <div className="col-span-2 rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-400">
                No projects yet — click "New Project" to get started
              </div>
            )}
            {projects.map((proj) => {
              const projAssets = assets.filter((a) => a.projectId === proj.id);
              const usedQty    = projAssets.length;
              const projAlerts = alerts.filter((a) => a.projectId === proj.id);
              const isExpired  = proj.endDate && daysUntil(proj.endDate) < 0;
              const endDays    = proj.endDate ? daysUntil(proj.endDate) : null;

              // Location distribution
              const locMap: Record<string, number> = {};
              projAssets.forEach((a) => { locMap[a.location] = (locMap[a.location] ?? 0) + 1; });

              // Transfer movement summary
              const projAssetIds = new Set(projAssets.map((a) => a.id));
              const completedTransfers = transfers.filter(
                (t) => t.status === "Completed" && t.assetIds.some((id) => projAssetIds.has(id))
              );
              const movementMap: Record<string, { from: string; to: string; count: number }> = {};
              completedTransfers.forEach((t) => {
                const key = `${t.fromLocation}→${t.toLocation}`;
                if (!movementMap[key]) movementMap[key] = { from: t.fromLocation, to: t.toLocation, count: 0 };
                movementMap[key].count += t.assetIds.filter((id) => projAssetIds.has(id)).length;
              });

              // Sustainability quick summary
              const woodKg = (proj.woodPerAsset ?? 0) * usedQty;
              const corrKg = (proj.corrugationPerAsset ?? 0) * usedQty;
              const sustain = (woodKg > 0 || corrKg > 0) ? calcSustainability(woodKg, corrKg) : null;

              return (
                <div key={proj.id}
                  className={`rounded-xl border bg-white p-5 space-y-3 col-span-1 md:col-span-2 ${projAlerts.length > 0 ? "border-amber-300" : "border-slate-200"}`}>
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900 truncate">{proj.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${proj.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {proj.status}
                        </span>
                        {projAlerts.length > 0 && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                        {sustain && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            <TreePine className="h-3 w-3" />{sustain.trees} trees saved
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5">{proj.client}</p>
                      {proj.allowedLocations && proj.allowedLocations.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className="text-[10px] text-slate-400 self-center">Locations:</span>
                          {proj.allowedLocations.slice(0,3).map((l) => (
                            <span key={l} className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] text-indigo-700">{l}</span>
                          ))}
                          {proj.allowedLocations.length > 3 && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">+{proj.allowedLocations.length-3}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => { setActiveTab("po"); }}
                        title="View PO" className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100">
                        PO
                      </button>
                      <button onClick={() => openEdit(proj)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        Edit
                      </button>
                      {isAdmin && (
                        <button onClick={() => setConfirmDeleteProject(proj)}
                          title="Delete project"
                          className="rounded-lg border border-red-200 p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                    {proj.startDate && (
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        Start: {new Date(proj.startDate).toLocaleDateString("en-IN")}
                      </div>
                    )}
                    {proj.endDate && (
                      <div className={`flex items-center gap-1.5 font-medium ${isExpired ? "text-red-600" : endDays !== null && endDays <= 60 ? "text-amber-600" : "text-slate-500"}`}>
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        End: {new Date(proj.endDate).toLocaleDateString("en-IN")}
                        {isExpired ? " (EXPIRED)" : endDays !== null && endDays <= 60 ? ` (${endDays}d)` : ""}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      {usedQty} asset{usedQty !== 1 ? "s" : ""} assigned
                    </div>
                  </div>

                  {/* Location distribution */}
                  {Object.keys(locMap).length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider border-b border-slate-200">
                            <th className="px-3 py-2 text-left font-medium">Location</th>
                            <th className="px-3 py-2 text-center font-medium">Assets</th>
                            <th className="px-3 py-2 text-center font-medium">Type</th>
                            <th className="px-3 py-2 text-right font-medium">% of Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {Object.entries(locMap).sort((a, b) => b[1] - a[1]).map(([loc, cnt]) => {
                            const locObj = locations.find((l) => l.name === loc);
                            const pct = usedQty > 0 ? ((cnt / usedQty) * 100).toFixed(1) : "0.0";
                            return (
                              <tr key={loc} className="hover:bg-slate-50">
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  {locObj?.isMasterWarehouse ? "⭐ " : ""}{loc}
                                </td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-slate-700">{cnt}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                    {locObj?.type?.replace("_"," ") ?? "—"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-slate-500">{pct}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Transfer movement summary */}
                  {Object.keys(movementMap).length > 0 && (
                    <details className="rounded-lg border border-slate-200 overflow-hidden">
                      <summary className="cursor-pointer bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                        Transfer Movement History ({completedTransfers.length} completed transfers)
                      </summary>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-slate-500 uppercase tracking-wider">
                            <th className="px-3 py-2 text-left font-medium">From</th>
                            <th className="px-3 py-2 text-left font-medium">To</th>
                            <th className="px-3 py-2 text-right font-medium">Assets Moved</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {Object.values(movementMap).map((m) => (
                            <tr key={`${m.from}→${m.to}`} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-600">{m.from}</td>
                              <td className="px-3 py-2 text-slate-600">{m.to}</td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-700">{m.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}

                  {projAlerts.map((alert, i) => (
                    <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${alertBg[alert.type]}`}>
                      ⚠ {alert.message}
                    </div>
                  ))}

                  {isExpired && (
                    <button onClick={() => { setRenewingId(proj.id); setRenewDate(""); }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                      <RefreshCw className="h-3.5 w-3.5" /> Renew Project
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Renew Modal ── */}
      {renewingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Renew Project</h3>
              <button onClick={() => setRenewingId(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">New End Date *</label>
              <input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRenewingId(null)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
              <button onClick={handleRenew} disabled={!renewDate}
                className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-emerald-700">
                Renew
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h3 className="font-semibold text-slate-900">{editingId ? "Edit Project" : "New Project"}</h3>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Project Name *</label>
                  <input required value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Client *</label>
                  <select required value={form.client}
                    onChange={(e) => setForm((p) => ({ ...p, client: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 bg-white">
                    <option value="">— select customer —</option>
                    {locations.filter((l) => l.status === "Active" && !l.isMasterWarehouse).map((l) => (
                      <option key={l.id} value={l.name}>{l.name}</option>
                    ))}
                    {/* Allow keeping existing value if the location was removed */}
                    {form.client && !locations.find((l) => l.name === form.client) && (
                      <option value={form.client}>{form.client} (legacy)</option>
                    )}
                  </select>
                  {locations.filter((l) => l.status === "Active" && !l.isMasterWarehouse).length === 0 && (
                    <p className="mt-1 text-[10px] text-amber-600 font-medium">⚠ No customer locations found — add them in Customers &amp; Locations first</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                  <select value={form.status}
                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as Project["status"] }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    <option value="Active">Active</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>

                <div className="col-span-2 border-t border-slate-100 pt-3">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Timeline</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Start Date</label>
                      <input type="date" value={form.startDate}
                        onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">End Date</label>
                      <input type="date" value={form.endDate}
                        onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                    </div>
                  </div>
                </div>

                {/* Allowed Locations */}
                <div className="col-span-2 border-t border-slate-100 pt-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Allowed Movement Locations</p>
                  <p className="mb-2 text-[10px] text-slate-400">Assets in this project can only be moved to these locations. Leave empty to allow all.</p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1">
                    {locations.filter((l) => l.status === "Active").map((loc) => (
                      <label key={loc.id} className="flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded hover:bg-white text-xs">
                        <input type="checkbox"
                          checked={form.allowedLocations.includes(loc.name)}
                          onChange={(e) => {
                            setForm((p) => ({
                              ...p,
                              allowedLocations: e.target.checked
                                ? [...p.allowedLocations, loc.name]
                                : p.allowedLocations.filter((n) => n !== loc.name),
                            }));
                          }}
                          className="rounded" />
                        <span className="text-slate-700">{loc.name}</span>
                        {loc.isMasterWarehouse && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700">Master WH</span>}
                        <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{loc.type?.replace("_"," ")}</span>
                      </label>
                    ))}
                    {locations.filter((l) => l.status === "Active").length === 0 && (
                      <p className="text-center text-slate-400 py-2 text-xs">No active locations configured</p>
                    )}
                  </div>
                  {form.allowedLocations.length > 0 && (
                    <p className="mt-1 text-[10px] text-emerald-600 font-medium">
                      ✓ {form.allowedLocations.length} location{form.allowedLocations.length > 1 ? "s" : ""} selected
                    </p>
                  )}
                </div>
              </div>

              {form.endDate && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                  <p className="font-semibold">Auto-alert:</p>
                  <p>• Popup 2 months before project end date</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingId ? "Save Changes" : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Project confirm modal ── */}
      {confirmDeleteProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900">Delete project?</h3>
                <p className="mt-1 text-sm text-slate-500">
                  <span className="font-medium text-slate-700">"{confirmDeleteProject.name}"</span> will be permanently removed.
                  Assets assigned to this project will not be deleted but will lose their project association.
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirmDeleteProject(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleDeleteProject} disabled={deletingProject}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                {deletingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deletingProject ? "Deleting…" : "Delete Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
