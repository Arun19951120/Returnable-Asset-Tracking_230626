"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import type { Asset, Location, Project, AssetMovement, DCCancellation, AssetCycle, DCLog } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { findUserProject, nextInFlow } from "@/lib/flow";
import {
  LogOut, LogIn, FileText, Wifi, Loader2, Search,
  CheckCircle2, Clock, X, QrCode, ScanBarcode,
  AlertTriangle, CheckCheck, XCircle, Package, Download,
  RotateCcw, RefreshCw, Calendar, MapPin, Zap, TrendingUp,
  Camera, FlipHorizontal, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import BulkCheckInOutDialog from "@/components/dialogs/BulkCheckInOutDialog";

// ─── Role helpers ──────────────────────────────────────────────────────────────
const RESTRICTED_ROLES = ["Customer", "Employee", "Supplier", "Tier-1", "OEM"];
const MANAGER_ROLES    = ["Admin", "Manager"];

// ─── Notification helper ───────────────────────────────────────────────────────
function buildDispatchSummary(dispatched: Asset[]): string {
  const map = new Map<string, number>();
  dispatched.forEach((a) => {
    const key = a.description?.trim() || a.name;
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return [...map.entries()].map(([desc, qty]) => `• ${desc} × ${qty}`).join("\n");
}
type ReaderType        = "QR" | "RFID" | "BLE" | "Barcode";

// ─── DC PDF for individual movements — movement track list format ──────────────
async function generateMovementDC(
  movements: AssetMovement[],
  allAssets: Asset[],
  locations: Location[],
  projects: Project[],
  signatureImg?: string,
  companyName = "PLENOVA SUPPLY CHAIN PRIVATE LIMITED"
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const COPIES    = ["ORIGINAL", "DUPLICATE", "TRIPLICATE"] as const;
  const HDR: Record<string, [number,number,number]> = {
    ORIGINAL: [30,41,59], DUPLICATE: [30,80,30], TRIPLICATE: [80,30,30],
  };

  const doc  = new jsPDF({ unit: "mm", format: "a4" });
  const W    = 210;
  const mg   = 14;
  const dcNo = `MOV-${Date.now().toString().slice(-6)}`;
  const now  = new Date();
  const first = movements[0];
  const fromL = locations.find((l) => l.name === first.fromLocation);
  const toL   = locations.find((l) => l.name === first.toLocation);

  for (let ci = 0; ci < 3; ci++) {
    if (ci > 0) doc.addPage();
    const lbl = COPIES[ci];
    const clr = HDR[lbl];

    // Header
    doc.setFillColor(...clr);
    doc.rect(0, 0, W, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text(companyName, W / 2, 9, { align: "center" });
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text("Asset Movement Delivery Challan", W / 2, 15, { align: "center" });
    doc.setFontSize(8);
    doc.text(`DC No: ${dcNo}`, mg, 22);
    doc.text(`Date: ${now.toLocaleDateString("en-IN")}`, W / 2, 22, { align: "center" });
    doc.text(`[ ${lbl} COPY ]`, W - mg, 22, { align: "right" });

    // From / To
    const half = (W - mg * 2) / 2 - 2;
    doc.setFillColor(241, 245, 249);
    doc.rect(mg, 32, half, 22, "F");
    doc.rect(mg + half + 4, 32, half, 22, "F");
    doc.setTextColor(30, 41, 59); doc.setFontSize(7); doc.setFont("helvetica", "bold");
    doc.text("CONSIGNOR (FROM)", mg + 2, 37);
    doc.text("CONSIGNEE (TO)", mg + half + 6, 37);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(first.fromLocation, mg + 2, 43);
    if (fromL?.address) doc.text(fromL.address.slice(0, 45), mg + 2, 48);
    doc.text(first.toLocation, mg + half + 6, 43);
    if (toL?.address) doc.text(toL.address.slice(0, 45), mg + half + 6, 48);

    // ── Movement Track List (no asset-wise details) ──────────────────────────
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("MOVEMENT TRACK LIST", mg, 56);

    const rows = movements.map((m, i) => {
      const d = new Date(m.createdAt);
      const asset = allAssets.find((a) => a.id === m.assetId);
      const proj  = projects.find((p) => p.id === asset?.projectId);
      return [
        i + 1,
        d.toLocaleDateString("en-IN"),
        d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        proj?.name ?? "—",
        dcNo,
        m.assetName,
        1,
        m.status,
      ];
    });

    autoTable(doc, {
      startY: 59,
      head: [["SL No", "Date", "Time", "Project", "DC No", "Description", "Qty", "Status"]],
      body: rows,
      foot: [["", "", "", "", "", `TOTAL: ${movements.length}`, movements.length, ""]],
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        6: { cellWidth: 10, halign: "center" },
      },
      margin: { left: mg, right: mg },
    });

    let y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

    // Carrier details
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("CARRIER / VEHICLE DETAILS", mg, y2 + 4);
    autoTable(doc, {
      startY: y2 + 7,
      head: [["Vehicle No.", "Driver Name", "Date of Despatch", "Date of Receipt"]],
      body: [["", "", now.toLocaleDateString("en-IN"), ""]],
      theme: "grid", styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: "bold", fontSize: 8 },
      margin: { left: mg, right: mg },
    });
    const y3 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

    // Terms
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("TERMS & CONDITIONS", mg, y3 + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105); doc.setFontSize(7.5);
    ["1. All goods dispatched on RETURNABLE basis and are NOT for sale.",
     "2. Assets must be returned in original condition within the agreed period.",
     "3. Any damage or loss is chargeable at declared unit value.",
    ].forEach((t, i) => doc.text(t, mg, y3 + 10 + i * 4.5));

    const sigY = Math.max(y3 + 30, 255);
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.4); doc.line(mg, sigY, W - mg, sigY);
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105);
    if (signatureImg) { try { doc.addImage(signatureImg, "PNG", mg, sigY + 2, 40, 14); } catch { /**/ } }
    doc.text("Authorised Signatory (Consignor)", mg, sigY + 20);
    doc.text("Signature & Stamp", mg, sigY + 25);
    doc.text("Received By (Consignee)", W - mg - 50, sigY + 14);
    doc.text("Signature & Stamp", W - mg - 50, sigY + 20);
    doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text(`${companyName} | ${dcNo} | ${lbl} | ${now.toLocaleString("en-IN")}`, W / 2, 290, { align: "center" });
  }

  doc.save(`${dcNo}.pdf`);
  toast.success(`${dcNo} downloaded (3 copies)`);

  // Save to dc_logs
  try {
    const desc = movements.map((m) => m.assetName).filter((v, i, a) => a.indexOf(v) === i).join(", ");
    await addDocument("dc_logs", {
      dcNo, createdAt: now.toISOString(),
      fromLocation: first.fromLocation, toLocation: first.toLocation,
      movementType: first.movementType,
      description: desc || first.assetName, qty: movements.length,
      lineMode: "individual", showRFID: false, showBLE: false,
      createdBy: first.createdBy,
      assetSnapshots: movements.map((m) => {
        const a = allAssets.find((x) => x.id === m.assetId);
        return { id: m.assetId, name: m.assetName, uuid: a?.uuid ?? "—", rfidTag: a?.rfidTag, bleTag: a?.bleTag, cost: a?.cost };
      }),
    } satisfies Omit<DCLog, "id">);
  } catch { /**/ }
}

// ─── Cycle helpers ─────────────────────────────────────────────────────────────
async function startCycle(assetId: string, assetName: string, masterWhName: string, existingCycles: AssetCycle[]) {
  const assetCycles   = existingCycles.filter((c) => c.assetId === assetId);
  const cycleNumber   = assetCycles.length + 1;
  const newCycle: Omit<AssetCycle, "id"> = {
    assetId, assetName, cycleNumber,
    startedAt: new Date().toISOString(),
    locationsVisited: [masterWhName],
    status: "Active",
  };
  const id = await addDocument("asset_cycles", newCycle);
  return (id as unknown as string);
}

async function completeCycle(
  assetId: string, currentLoc: string,
  existingCycles: AssetCycle[], assetCycleCount: number
) {
  const active = existingCycles.find((c) => c.assetId === assetId && c.status === "Active");
  if (!active) return;
  const completedAt   = new Date().toISOString();
  const startMs       = new Date(active.startedAt).getTime();
  const durationDays  = Math.round((Date.now() - startMs) / 86400000);
  const locs          = active.locationsVisited.includes(currentLoc)
    ? active.locationsVisited
    : [...active.locationsVisited, currentLoc];
  await updateDocument("asset_cycles", active.id, { status: "Completed", completedAt, durationDays, locationsVisited: locs });
  await updateDocument("assets", assetId, { cycleCount: (assetCycleCount || 0) + 1 });
}

async function addLocationToCycle(assetId: string, location: string, existingCycles: AssetCycle[]) {
  const active = existingCycles.find((c) => c.assetId === assetId && c.status === "Active");
  if (!active || active.locationsVisited.includes(location)) return;
  await updateDocument("asset_cycles", active.id, {
    locationsVisited: [...active.locationsVisited, location],
  });
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function AssetMovement({ mode }: { mode?: "checkout" | "checkin" }) {
  const { profile } = useAuth();
  const isRestricted = RESTRICTED_ROLES.includes(profile?.role ?? "");
  const isManager    = MANAGER_ROLES.includes(profile?.role ?? "");

  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [cancels,   setCancels]   = useState<DCCancellation[]>([]);
  const [cycles,    setCycles]    = useState<AssetCycle[]>([]);

  const [activeTab, setActiveTab] = useState<"movement"|"dc">("movement");

  const load = useCallback(async () => {
    const [a, l, p, m, c, cy] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<Location>("locations"),
      fetchAll<Project>("projects"),
      fetchAll<AssetMovement>("movements"),
      fetchAll<DCCancellation>("dc_cancellations"),
      fetchAll<AssetCycle>("asset_cycles"),
    ]);
    setAssets(a);
    setLocations(l.filter((x) => x.status === "Active"));
    setProjects(p.filter((x) => x.status === "Active"));
    setMovements(m);
    setCancels(c);
    setCycles(cy);
  }, []);

  useEffect(() => { load(); }, [load]);

  const masterWH         = locations.find((l) => l.isMasterWarehouse);
  const pendingApprovals = cancels.filter((c) => c.status === "Pending").length;

  const TABS = [
    { id: "movement" as const, label: "Movement",     icon: RefreshCw, color: "text-slate-700" },
    { id: "dc"       as const, label: "Movement DCs", icon: FileText,  color: "text-blue-600",
      badge: isManager && pendingApprovals > 0 ? pendingApprovals : 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Asset Movement</h1>
          <p className="text-sm text-slate-500">Smart receive & dispatch — system auto-detects the action</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          isManager ? "bg-blue-100 text-blue-700" :
          isRestricted ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}>
          {profile?.role ?? "User"}{isManager ? " · Full Access" : isRestricted ? " · Limited" : ""}
        </span>
      </div>

      <div className="flex flex-wrap border-b border-slate-200">
        {TABS.map(({ id, label, icon: Icon, color, badge }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`relative flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === id ? `border-slate-900 ${color}` : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            <Icon className="h-4 w-4" />{label}
            {(badge ?? 0) > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "movement" && (() => {
        const custLoc = profile?.allowedLocations?.[0] ?? "";
        // Checkout destinations come from the user's project flow:
        // the next stop in the loop after their own location.
        const coAllowed = nextInFlow(findUserProject(profile, projects), custLoc);
        // Check-in is always the user's own login location — no configuration.
        return (
          <SmartMovementPanel
            assets={assets} locations={locations} projects={projects}
            movements={movements} cycles={cycles}
            profile={profile} isRestricted={isRestricted} isManager={isManager}
            masterWH={masterWH} onDone={load}
            initialLoc={mode === "checkin" || mode === "checkout" ? custLoc : ""}
            checkOutAllowedLocs={coAllowed.length > 0 ? coAllowed : undefined}
            mode={mode}
          />
        );
      })()}
      {activeTab === "dc" && (
        <DCPanel movements={movements} assets={assets} locations={locations} projects={projects}
          cancels={cancels} profile={profile} isManager={isManager} onDone={load} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA QR SCANNER OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function CameraScanner({ onDetect, onClose }: { onDetect: (value: string) => void; onClose: () => void }) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef    = useRef<number>(0);
  const lastScan  = useRef<string>("");
  const lastTime  = useRef<number>(0);
  const [error, setError]       = useState("");
  const [flash, setFlash]       = useState(false);
  const [facingMode, setFacing] = useState<"environment" | "user">("environment");
  const [lastValue, setLastValue] = useState("");

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; }
      setError("");
    } catch {
      setError("Camera access denied — allow camera permission and retry.");
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
    };
  }, [facingMode, startCamera]);

  // QR decode loop using jsqr
  useEffect(() => {
    let jsQR: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
    import("jsqr").then((m) => { jsQR = m.default; });

    function tick() {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= video.HAVE_ENOUGH_DATA && jsQR) {
        const w = video.videoWidth, h = video.videoHeight;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h);
          if (code && code.data) {
            const now = Date.now();
            if (code.data !== lastScan.current || now - lastTime.current > 2000) {
              lastScan.current = code.data;
              lastTime.current = now;
              setFlash(true); setLastValue(code.data);
              setTimeout(() => setFlash(false), 500);
              onDetect(code.data);
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [onDetect]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-white" />
          <span className="text-sm font-semibold text-white">Camera Scan</span>
          <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-400 animate-pulse">LIVE</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFacing((f) => f === "environment" ? "user" : "environment")}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20">
            <FlipHorizontal className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Video feed */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scan overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-64 w-64">
            {/* Dimmed outside */}
            <div className="absolute inset-0 -m-[9999px] bg-black/50" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }} />
            {/* Corner brackets */}
            {[["top-0 left-0 border-t-2 border-l-2",""], ["top-0 right-0 border-t-2 border-r-2",""], ["bottom-0 left-0 border-b-2 border-l-2",""], ["bottom-0 right-0 border-b-2 border-r-2",""]].map(([cls], i) => (
              <div key={i} className={`absolute h-8 w-8 rounded-sm ${cls} ${flash ? "border-green-400" : "border-white"} transition-colors`} />
            ))}
            {/* Scan line */}
            <div className={`absolute left-0 right-0 h-0.5 ${flash ? "bg-green-400" : "bg-white/60"} animate-[scanline_2s_ease-in-out_infinite]`}
              style={{ top: "50%", boxShadow: flash ? "0 0 8px #4ade80" : "0 0 4px rgba(255,255,255,0.4)" }} />
          </div>
        </div>

        {/* Flash success overlay */}
        {flash && <div className="absolute inset-0 bg-green-400/20 pointer-events-none" />}

        {error && (
          <div className="absolute bottom-16 left-4 right-4 rounded-xl bg-red-900/80 px-4 py-3 text-sm text-red-200">{error}</div>
        )}
      </div>

      {/* Bottom — last scanned */}
      <div className="bg-black/80 px-4 py-3">
        {lastValue ? (
          <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-900/30 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-green-400 uppercase tracking-wider">Last Scanned</p>
              <p className="font-mono text-sm text-white truncate">{lastValue}</p>
            </div>
          </div>
        ) : (
          <p className="text-center text-xs text-slate-400">Point camera at QR code to scan</p>
        )}
      </div>

      <style>{`
        @keyframes scanline {
          0%   { top: 10%; }
          50%  { top: 90%; }
          100% { top: 10%; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED: Bulk / Quick Scanner
// ─────────────────────────────────────────────────────────────────────────────
function BulkScanner({ scannedIds, availableAssets, onAdd, onRemove, placeholder, allAssets }: {
  scannedIds: string[]; availableAssets: Asset[]; allAssets?: Asset[];
  onAdd: (id: string) => void; onRemove: (id: string) => void; placeholder?: string;
}) {
  const [input, setInput]               = useState("");
  const [activeReader, setActiveReader]  = useState<ReaderType | null>(null);
  const [showCamera, setShowCamera]      = useState(false);
  const [rfidStatus, setRfidStatus]      = useState<"idle" | "connecting" | "live" | "error">("idle");
  const inputRef    = useRef<HTMLInputElement>(null);
  const rfidEsRef   = useRef<EventSource | null>(null);

  // Cleanup RFID stream on unmount
  useEffect(() => () => { rfidEsRef.current?.close(); }, []);

  function stopRFID() {
    rfidEsRef.current?.close();
    rfidEsRef.current = null;
    setRfidStatus("idle");
    setActiveReader(null);
  }

  async function activateReader(type: ReaderType) {
    // Toggle off if already active
    if (activeReader === type) {
      if (type === "RFID") stopRFID();
      else setActiveReader(null);
      return;
    }

    if (type === "QR") { setShowCamera(true); return; }

    if (type === "Barcode") {
      setActiveReader("Barcode");
      inputRef.current?.focus();
      toast.info("Barcode reader active — scan or type and press Enter", { duration: 4000 });
      return;
    }

    // ── RFID: real LLRP SSE stream ─────────────────────────────────────────
    if (type === "RFID") {
      let cfg: { rfid?: { enabled?: boolean; ipAddress?: string; port?: string } } = {};
      try { cfg = await fetch("/api/hardware-config").then((r) => r.json()); } catch {}
      if (!cfg.rfid?.enabled) { toast.error("RFID not enabled — go to Hardware Config to enable it"); return; }

      const ip   = cfg.rfid.ipAddress || "192.168.1.100";
      const port = cfg.rfid.port      || "5084";

      // Close any previous stream
      rfidEsRef.current?.close();
      setRfidStatus("connecting");
      setActiveReader("RFID");
      toast.info(`Connecting to RFID reader at ${ip}:${port}…`, { id: "rfid-conn", duration: 10000 });

      const es = new EventSource(`/api/rfid/stream?ip=${encodeURIComponent(ip)}&port=${encodeURIComponent(port)}`);
      rfidEsRef.current = es;

      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type: string; epc?: string; message?: string };
          if (msg.type === "connected") {
            setRfidStatus("live");
            toast.success("RFID reader connected — hold tag near antenna", { id: "rfid-conn", duration: 4000 });
          } else if (msg.type === "tag" && msg.epc) {
            handleScan(msg.epc);
          } else if (msg.type === "error") {
            setRfidStatus("error");
            toast.error(`RFID: ${msg.message}`, { id: "rfid-conn" });
            stopRFID();
          } else if (msg.type === "done") {
            stopRFID();
          }
        } catch { /* ignore parse errors */ }
      };
      es.onerror = () => {
        setRfidStatus("error");
        toast.error("RFID stream disconnected", { id: "rfid-conn" });
        stopRFID();
      };
      return;
    }

    // ── BLE: Web Bluetooth API ─────────────────────────────────────────────
    if (type === "BLE") {
      let cfg: { ble?: { enabled?: boolean; tagPrefix?: string; macFilter?: string } } = {};
      try { cfg = await fetch("/api/hardware-config").then((r) => r.json()); } catch {}
      if (!cfg.ble?.enabled) { toast.error("BLE not enabled — go to Hardware Config to enable it"); return; }

      if (!("bluetooth" in navigator)) {
        toast.error("Web Bluetooth not supported — use Chrome or Edge on desktop");
        return;
      }

      setActiveReader("BLE");
      toast.info("BLE: Select your tag in the browser dialog…", { duration: 6000 });

      try {
        const namePrefix = cfg.ble.tagPrefix || "";
        const filters = namePrefix
          ? [{ namePrefix }, { name: namePrefix.replace(/-$/, "") }]
          : undefined;

        type BluetoothNavigator = Navigator & {
          bluetooth: {
            requestDevice(opts: { acceptAllDevices?: boolean; filters?: { namePrefix?: string; name?: string }[]; optionalServices?: string[] }): Promise<{ id: string; name?: string; gatt?: { connect(): Promise<{ getCharacteristic?: (s: string) => Promise<{ readValue(): Promise<DataView> }> }> } }>;
          };
        };
        const device = await (navigator as BluetoothNavigator).bluetooth.requestDevice({
          ...(filters ? { filters } : { acceptAllDevices: true }),
          optionalServices: ["generic_access", "battery_service"],
        });

        const tagId = device.name || device.id;
        toast.success(`BLE tag found: ${tagId}`, { duration: 3000 });
        handleScan(tagId);

        // Also try GATT read for custom tag data
        try {
          const server = await device.gatt?.connect();
          if (server) {
            try {
              const char = await server.getCharacteristic?.("00002a00-0000-1000-8000-00805f9b34fb");
              if (char) {
                const val = await char.readValue();
                const deviceName = new TextDecoder().decode(val);
                if (deviceName && deviceName !== tagId) handleScan(deviceName);
              }
            } catch { /* characteristic may not exist */ }
          }
        } catch { /* GATT optional */ }

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.toLowerCase().includes("cancel")) {
          toast.error(`BLE error: ${msg || "Failed to connect"}`);
        }
      } finally {
        setActiveReader(null);
      }
    }
  }

  // Resolve a raw scan value → asset (search across all assets if allAssets provided)
  function resolve(raw: string): Asset | undefined {
    const pool = allAssets ?? availableAssets;
    const q = raw.trim().toLowerCase();
    return pool.find((a) =>
      a.uuid.toLowerCase() === q ||
      a.id.toLowerCase() === q ||
      (a.rfidTag ?? "").toLowerCase() === q ||
      (a.bleTag ?? "").toLowerCase() === q ||
      a.name.toLowerCase() === q
    );
  }

  function handleScan(raw: string) {
    const a = resolve(raw);
    if (!a) { toast.error(`No asset found for: "${raw.slice(0, 30)}"`); return; }
    // Check if asset is in available pool
    const inPool = availableAssets.find((x) => x.id === a.id);
    if (!inPool) { toast.warning(`${a.name} is not available at the selected location`); return; }
    if (scannedIds.includes(a.id)) { toast.info(`${a.name} already in queue`); return; }
    onAdd(a.id);
    toast.success(`✓ Added: ${a.name}`, { duration: 2000 });
    setInput("");
  }

  const READERS: { type: ReaderType; icon: React.ReactNode; label: string; desc: string }[] = [
    { type: "QR",      icon: <QrCode className="h-3.5 w-3.5" />,      label: "QR Code",  desc: "Camera scan" },
    { type: "Barcode", icon: <ScanBarcode className="h-3.5 w-3.5" />, label: "Barcode",  desc: "USB scanner" },
    { type: "RFID",    icon: <Wifi className="h-3.5 w-3.5" />,        label: "RFID",     desc: "RFID reader" },
    { type: "BLE",     icon: <Wifi className="h-3.5 w-3.5 opacity-70" />, label: "BLE",  desc: "BLE beacon" },
  ];

  return (
    <>
      {showCamera && (
        <CameraScanner
          onDetect={(val) => { handleScan(val); }}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
        {/* Reader type buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 shrink-0">Scan via:</span>
          {READERS.map(({ type, icon, label, desc }) => {
            const isActive = activeReader === type;
            const isRFIDLive = type === "RFID" && rfidStatus === "live";
            const isRFIDConnecting = type === "RFID" && rfidStatus === "connecting";
            return (
              <button key={type} onClick={() => activateReader(type)}
                title={isActive ? `Click to stop ${label}` : desc}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? isRFIDLive
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : isRFIDConnecting
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-indigo-600 bg-indigo-600 text-white"
                    : type === "QR"
                    ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    : type === "RFID"
                    ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                    : type === "BLE"
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}>
                {icon} {label}
                {isRFIDLive && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                {isRFIDConnecting && <Loader2 className="ml-0.5 h-3 w-3 animate-spin" />}
                {type === "QR" && !isActive && <Camera className="h-3 w-3 ml-0.5 text-blue-500" />}
                {isActive && type !== "RFID" && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
              </button>
            );
          })}
        </div>

        {/* Keyboard / HID input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            {activeReader && (
              <span className={`absolute left-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-green-400 animate-pulse`} />
            )}
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && handleScan(input)}
              placeholder={placeholder ?? "Scan tag, type UUID / RFID / name, or press Enter…"}
              className={`w-full rounded-lg border bg-white px-3 py-2 text-sm font-mono outline-none focus:border-slate-500 ${activeReader ? "pl-7 border-slate-800 ring-1 ring-slate-800" : "border-slate-300"}`} />
          </div>
          <button onClick={() => input.trim() && handleScan(input)}
            className="rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50">Add</button>
        </div>

        {/* Scanned queue */}
        {scannedIds.length > 0 && (
          <div className="space-y-1 max-h-44 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Queue ({scannedIds.length})</span>
              <button onClick={() => scannedIds.forEach(onRemove)} className="text-[10px] text-red-400 hover:text-red-600">Clear all</button>
            </div>
            {scannedIds.map((id) => {
              const a = (allAssets ?? availableAssets).find((x) => x.id === id);
              return (
                <div key={id} className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-slate-800 block truncate">{a?.name ?? id}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{a?.uuid ?? id.slice(-8).toUpperCase()}</span>
                  </div>
                  {a && (
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                      a.status === "Available" ? "bg-emerald-100 text-emerald-700" :
                      a.status === "In-Transit" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                      {a.status}
                    </span>
                  )}
                  <button onClick={() => onRemove(id)} className="text-slate-300 hover:text-red-500 shrink-0"><X className="h-3.5 w-3.5" /></button>
                </div>
              );
            })}
          </div>
        )}

        {/* RFID live status bar */}
        {activeReader === "RFID" && (
          <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium ${
            rfidStatus === "live" ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : rfidStatus === "connecting" ? "bg-amber-50 text-amber-700 border border-amber-200"
            : "bg-red-50 text-red-700 border border-red-200"}`}>
            <span className="flex items-center gap-1.5">
              {rfidStatus === "live" && <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
              {rfidStatus === "connecting" && <Loader2 className="h-3 w-3 animate-spin" />}
              {rfidStatus === "live" ? "RFID reader live — hold tag to antenna" : rfidStatus === "connecting" ? "Connecting to RFID reader…" : "RFID disconnected"}
            </span>
            <button onClick={stopRFID} className="text-current opacity-60 hover:opacity-100 underline">Stop</button>
          </div>
        )}

        {scannedIds.length === 0 && activeReader !== "RFID" && (
          <p className="text-center text-[10px] text-slate-400 py-1">
            Use camera QR, plug in USB scanner, activate RFID/BLE, or type and press Enter
          </p>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART MOVEMENT PANEL  (auto-detects receive vs dispatch per asset)
// ─────────────────────────────────────────────────────────────────────────────
type QueuedAsset = { assetId: string; mode: "receive" | "dispatch" };

function SmartMovementPanel({ assets, locations, projects, movements, cycles, profile, isRestricted, isManager, masterWH, onDone, initialLoc, checkOutAllowedLocs, mode }: {
  assets: Asset[]; locations: Location[]; projects: Project[];
  movements: AssetMovement[]; cycles: AssetCycle[];
  profile: ReturnType<typeof useAuth>["profile"];
  isRestricted: boolean; isManager: boolean; masterWH: Location | undefined; onDone: () => void;
  initialLoc?: string;
  checkOutAllowedLocs?: string[];
  mode?: string;
}) {
  const accessibleLocs = isRestricted && profile?.allowedLocations?.length
    ? locations.filter((l) => profile.allowedLocations!.includes(l.name))
    : locations;

  const [myLoc,         setMyLoc]         = useState("");
  const [queue,         setQueue]         = useState<QueuedAsset[]>([]);
  const [dispatchTo,    setDispatchTo]    = useState("");
  const [approving,     setApproving]     = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [showBulkDC,    setShowBulkDC]    = useState(false);
  const [showForce,     setShowForce]     = useState(false);
  const sigRef = useRef<HTMLInputElement>(null);
  const [sigImg, setSigImg] = useState<string | undefined>();
  const prevInitialLoc = useRef<string | undefined>(undefined);

  // Auto-default location: prefer initialLoc (from mode), then first accessible.
  // - Non-restricted (Admin/Manager): only set when myLoc is empty so manual picks are never overridden.
  // - Restricted users: also reset when initialLoc changes (mode switch Check In ↔ Check Out).
  useEffect(() => {
    const modeChanged = prevInitialLoc.current !== undefined && prevInitialLoc.current !== initialLoc;
    prevInitialLoc.current = initialLoc;

    if (!myLoc || (isRestricted && modeChanged)) {
      if (initialLoc && accessibleLocs.some((l) => l.name === initialLoc)) {
        setMyLoc(initialLoc);
      } else if (accessibleLocs.length > 0) {
        setMyLoc(accessibleLocs[0].name);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibleLocs, initialLoc]);

  // Auto-select dispatch destination when only one is allowed; reset when mode switches
  useEffect(() => {
    if (mode === "checkout" && checkOutAllowedLocs?.length === 1) {
      setDispatchTo(checkOutAllowedLocs[0]);
    } else if (mode === "checkin") {
      setDispatchTo("");
    }
  }, [checkOutAllowedLocs, mode]);

  // In-transit arrivals to myLoc
  const incomingMovs = movements.filter((m) => m.status === "In-Transit" && m.toLocation === myLoc);

  // Auto-clear dispatch items from queue when incoming are pending
  useEffect(() => {
    if (incomingMovs.length > 0) {
      setQueue((prev) => prev.filter((q) => q.mode === "receive"));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingMovs.length]);
  const incomingQueued = queue.filter((q) => q.mode === "receive");
  const dispatchQueued = queue.filter((q) => q.mode === "dispatch");

  // All in-transit NOT going to myLoc (for force-inward, managers only)
  const allInTransit = movements.filter((m) => m.status === "In-Transit" && m.toLocation !== myLoc);

  function resolveAsset(raw: string): Asset | undefined {
    const q = raw.trim().toLowerCase();
    return assets.find((a) =>
      a.uuid.toLowerCase() === q || a.id.toLowerCase() === q ||
      (a.rfidTag ?? "").toLowerCase() === q || (a.bleTag ?? "").toLowerCase() === q ||
      a.name.toLowerCase() === q
    );
  }

  function addToQueue(raw: string) {
    if (!myLoc) { toast.error("Select your location first"); return; }
    const asset = resolveAsset(raw);
    if (!asset) { toast.error(`No asset found for: "${raw.slice(0, 30)}"`); return; }
    if (queue.find((q) => q.assetId === asset.id)) { toast.info(`${asset.name} already in queue`); return; }

    // Determine mode automatically
    const incomingMov = incomingMovs.find((m) => m.assetId === asset.id);
    if (incomingMov) {
      setQueue((p) => [...p, { assetId: asset.id, mode: "receive" }]);
      toast.success(`↓ Receive: ${asset.name}`, { duration: 2000 });
    } else if (asset.status === "Available" && asset.location === myLoc) {
      if (incomingMovs.length > 0) {
        toast.warning(`Check in ${incomingMovs.length} incoming asset${incomingMovs.length > 1 ? "s" : ""} before dispatching`);
        return;
      }
      setQueue((p) => [...p, { assetId: asset.id, mode: "dispatch" }]);
      toast.success(`↑ Dispatch: ${asset.name}`, { duration: 2000 });
    } else {
      toast.warning(`${asset.name} is ${asset.status} at ${asset.location} — not actionable here`);
    }
  }

  function addIncoming(mov: AssetMovement) {
    if (queue.find((q) => q.assetId === mov.assetId)) { toast.info("Already queued"); return; }
    setQueue((p) => [...p, { assetId: mov.assetId, mode: "receive" }]);
  }

  function addAllIncoming() {
    const toAdd = incomingMovs.filter((m) => !queue.find((q) => q.assetId === m.assetId));
    setQueue((p) => [...p, ...toAdd.map((m) => ({ assetId: m.assetId, mode: "receive" as const }))]);
  }

  function removeFromQueue(assetId: string) {
    setQueue((p) => p.filter((q) => q.assetId !== assetId));
  }

  function clearQueue() { setQueue([]); setDispatchTo(""); }

  async function processApproval() {
    if (!queue.length) return;
    if (dispatchQueued.length > 0 && !dispatchTo) { toast.error("Select dispatch destination"); return; }
    setApproving(true);
    try {
      // ── Process receives ────────────────────────────────────────────────────
      for (const item of incomingQueued) {
        const mov = incomingMovs.find((m) => m.assetId === item.assetId);
        if (!mov) continue;
        const isMasterTo = masterWH?.name === myLoc;
        const asset = assets.find((a) => a.id === item.assetId);
        await updateDocument("movements", mov.id, {
          status: "Completed", completedBy: profile?.uid ?? "",
          completedAt: new Date().toISOString(),
        });
        if (isMasterTo) {
          await completeCycle(item.assetId, myLoc, cycles, asset?.cycleCount ?? 0);
        } else {
          await addLocationToCycle(item.assetId, myLoc, cycles);
        }
        await updateDocument("assets", item.assetId, { status: "Available", location: myLoc });
        await logAudit({
          userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
          action: `Received: ${asset?.name ?? item.assetId} at ${myLoc}${isMasterTo ? " [cycle completed]" : ""}`,
          category: "Transfer", details: item.assetId,
        });
      }

      // ── Process dispatches ──────────────────────────────────────────────────
      if (dispatchQueued.length > 0) {
        const isMasterFrom = masterWH?.name === myLoc;
        const created: AssetMovement[] = [];
        for (const item of dispatchQueued) {
          const asset = assets.find((a) => a.id === item.assetId)!;
          let cycleId: string | undefined;
          if (isMasterFrom) {
            cycleId = await startCycle(item.assetId, asset.name, myLoc, cycles);
          } else {
            await addLocationToCycle(item.assetId, myLoc, cycles);
          }
          const mov: Omit<AssetMovement, "id"> = {
            assetId: item.assetId, assetName: asset.name,
            fromLocation: myLoc, toLocation: dispatchTo,
            movementType: "Checkout", status: "In-Transit",
            createdBy: profile?.uid ?? "", createdAt: new Date().toISOString(),
            cycleId,
          };
          const newId = await addDocument("movements", mov);
          created.push({ id: (newId as unknown as string), ...mov });
          await updateDocument("assets", item.assetId, { status: "In-Transit" });
        }
        await logAudit({
          userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
          action: `Dispatched ${dispatchQueued.length} asset(s): ${myLoc} → ${dispatchTo}`,
          category: "Transfer", details: dispatchQueued.map((q) => q.assetId).join(", "),
        });

        // Notify everyone — global notification visible to all users
        try {
          const dispatchedAssets = dispatchQueued.map((q) => assets.find((a) => a.id === q.assetId)).filter(Boolean) as Asset[];
          const summary = buildDispatchSummary(dispatchedAssets);
          await addDocument("notifications", {
            title: `📦 Incoming Shipment — ${dispatchTo}`,
            message: `${dispatchQueued.length} item${dispatchQueued.length > 1 ? "s" : ""} dispatched from ${myLoc}:\n${summary}`,
            type: "warning", read: false, createdAt: new Date().toISOString(),
          });
        } catch { /* non-blocking */ }
      }

      const rCount = incomingQueued.length;
      const dCount = dispatchQueued.length;
      toast.success(
        [rCount > 0 && `${rCount} asset${rCount > 1 ? "s" : ""} received`, dCount > 0 && `${dCount} dispatched to ${dispatchTo}`]
          .filter(Boolean).join(" · ")
      );
      clearQueue();
      setShowConfirm(false);
      onDone();
    } catch { toast.error("Processing failed"); }
    finally { setApproving(false); }
  }

  const availableAtMyLoc = myLoc ? assets.filter((a) => a.location === myLoc && a.status === "Available") : [];

  return (
    <div className="space-y-5">
      {/* ── Location display ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* FROM */}
          <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">From</p>
            {isRestricted ? (
              <p className="text-sm font-bold text-slate-800">
                {mode === "checkin"
                  ? <span className="text-slate-400 italic text-xs font-normal">Sender location</span>
                  : <>
                      {myLoc || <span className="text-slate-400 italic text-xs">Loading…</span>}
                      {myLoc && masterWH?.name === myLoc && (
                        <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          <RotateCcw className="inline h-2.5 w-2.5 mr-0.5" />Master WH
                        </span>
                      )}
                    </>
                }
              </p>
            ) : (
              <select value={myLoc} onChange={(e) => { setMyLoc(e.target.value); clearQueue(); }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-500">
                <option value="">— select location —</option>
                {accessibleLocs.map((l) => (
                  <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>
                ))}
              </select>
            )}
          </div>

          {/* Arrow separator */}
          <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />

          {/* TO */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">To</p>
            {isRestricted ? (
              <p className="text-sm font-bold text-slate-800">
                {(() => {
                  const toVal = mode === "checkin" ? myLoc : dispatchTo;
                  return toVal
                    ? <>{toVal}{masterWH?.name === toVal && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700"><RotateCcw className="inline h-2.5 w-2.5 mr-0.5" />Master WH</span>}</>
                    : <span className="text-slate-400 italic text-xs">{mode === "checkin" ? "Loading…" : "All locations"}</span>;
                })()}
              </p>
            ) : (
              <select value={dispatchTo} onChange={(e) => setDispatchTo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-500">
                <option value="">— select destination —</option>
                {locations
                  .filter((l) => l.name !== myLoc && (!checkOutAllowedLocs?.length || checkOutAllowedLocs.includes(l.name)))
                  .map((l) => <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>)}
              </select>
            )}
          </div>

          {myLoc && (
            <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              Active
            </span>
          )}
        </div>
      </div>

      {myLoc && (
        <>
          {/* ── Scan / search bar ──────────────────────────────────────────── */}
          <BulkScanner
            scannedIds={queue.map((q) => q.assetId)}
            availableAssets={[...incomingMovs.map((m) => assets.find((a) => a.id === m.assetId)!).filter(Boolean), ...availableAtMyLoc]}
            allAssets={assets}
            onAdd={(id) => {
              const asset = assets.find((a) => a.id === id);
              if (asset) addToQueue(asset.uuid);
            }}
            onRemove={removeFromQueue}
            placeholder="Scan asset QR / RFID / BLE / Barcode — system auto-detects Receive or Dispatch…"
          />

          {/* ── Incoming shipments ─────────────────────────────────────────── */}
          {incomingMovs.length > 0 && (
            <div className="animate-fade-up rounded-xl border border-emerald-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <LogIn className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                    Incoming to {myLoc} ({incomingMovs.length})
                  </span>
                  <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    Auto-detected: RECEIVE
                  </span>
                </div>
                <button onClick={addAllIncoming}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors">
                  <CheckCheck className="h-3.5 w-3.5" /> Add All to Queue
                </button>
              </div>
              <div className="divide-y divide-slate-50 max-h-60 overflow-y-auto">
                {incomingMovs.map((mov) => {
                  const asset = assets.find((a) => a.id === mov.assetId);
                  const inQueue = !!queue.find((q) => q.assetId === mov.assetId);
                  return (
                    <div key={mov.id} className={`stagger-item flex items-center gap-3 px-4 py-3 transition-colors ${inQueue ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                      {inQueue
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        : <Clock className="h-4 w-4 shrink-0 text-amber-400" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{mov.assetName}</p>
                        <p className="text-[10px] text-slate-400">
                          From: <span className="font-medium text-slate-600">{mov.fromLocation}</span>
                          {" · "}{new Date(mov.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                        </p>
                        {asset && <p className="text-[10px] font-mono text-slate-300">{asset.uuid}</p>}
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">In-Transit</span>
                      {inQueue
                        ? <button onClick={() => removeFromQueue(mov.assetId)} className="shrink-0 text-slate-300 hover:text-red-500"><X className="h-4 w-4" /></button>
                        : <button onClick={() => addIncoming(mov)}
                            className="shrink-0 flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">
                            <LogIn className="h-3 w-3" /> Add
                          </button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Block dispatch when incoming shipments are pending ───────── */}
          {incomingMovs.length > 0 && dispatchQueued.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span><strong>Check in the {incomingMovs.length} incoming asset{incomingMovs.length > 1 ? "s" : ""} first</strong> — dispatch items have been removed from queue.</span>
            </div>
          )}

          {/* ── Dispatch queue (outgoing assets) — hidden when incoming pending ── */}
          {incomingMovs.length === 0 && dispatchQueued.length > 0 && (
            <div className="animate-fade-up rounded-xl border border-orange-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-orange-100 bg-orange-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <LogOut className="h-4 w-4 text-orange-600" />
                  <span className="text-xs font-bold text-orange-800 uppercase tracking-wider">
                    Dispatch from {myLoc} ({dispatchQueued.length})
                  </span>
                  <span className="rounded-full bg-orange-200 px-2 py-0.5 text-[10px] font-bold text-orange-800">
                    Auto-detected: DISPATCH
                  </span>
                </div>
              </div>
              <div className="px-4 py-3 border-b border-orange-100">
                <label className="mb-1 block text-xs font-medium text-slate-600">Dispatch To Location *</label>
                <select value={dispatchTo} onChange={(e) => setDispatchTo(e.target.value)}
                  className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                  <option value="">— select destination —</option>
                  {locations
                    .filter((l) => l.name !== myLoc && (!checkOutAllowedLocs?.length || checkOutAllowedLocs.includes(l.name)))
                    .map((l) => <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>
                  )}
                </select>
              </div>
              <div className="divide-y divide-slate-50 max-h-48 overflow-y-auto">
                {dispatchQueued.map((item) => {
                  const asset = assets.find((a) => a.id === item.assetId);
                  return (
                    <div key={item.assetId} className="animate-slide-in flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                      <LogOut className="h-4 w-4 shrink-0 text-orange-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{asset?.name ?? item.assetId}</p>
                        <p className="text-[10px] font-mono text-slate-300">{asset?.uuid}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Available</span>
                      <button onClick={() => removeFromQueue(item.assetId)} className="shrink-0 text-slate-300 hover:text-red-500"><X className="h-4 w-4" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Browse available at my location (manual add to dispatch) ────── */}
          {availableAtMyLoc.length > 0 && incomingMovs.length === 0 && (
            <details className="rounded-xl border border-slate-200 overflow-hidden">
              <summary className="cursor-pointer bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                <Search className="inline h-3.5 w-3.5 mr-1" />
                Browse available at {myLoc} to dispatch ({availableAtMyLoc.length})
              </summary>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                {availableAtMyLoc.map((a) => {
                  const inQ = !!queue.find((q) => q.assetId === a.id);
                  return (
                    <label key={a.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 ${inQ ? "bg-orange-50" : ""}`}>
                      <input type="checkbox" checked={inQ}
                        onChange={() => inQ ? removeFromQueue(a.id) : setQueue((p) => [...p, { assetId: a.id, mode: "dispatch" }])}
                        className="rounded" />
                      <Package className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{a.uuid}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </details>
          )}

          {/* ── Approve / process queue ────────────────────────────────────── */}
          {queue.length > 0 && (
            <div className="animate-fade-up rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-white">
                    Review & Approve ({queue.length} asset{queue.length > 1 ? "s" : ""})
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {incomingQueued.length > 0 && `${incomingQueued.length} to receive`}
                    {incomingQueued.length > 0 && dispatchQueued.length > 0 && " · "}
                    {dispatchQueued.length > 0 && `${dispatchQueued.length} to dispatch${dispatchTo ? ` → ${dispatchTo}` : " (set destination)"}`}
                  </p>
                </div>
                <button onClick={clearQueue} className="text-slate-400 hover:text-white text-xs">Clear all</button>
              </div>

              {/* Summary rows */}
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {incomingQueued.map((item) => {
                  const a = assets.find((x) => x.id === item.assetId);
                  const mov = incomingMovs.find((m) => m.assetId === item.assetId);
                  return (
                    <div key={item.assetId} className="flex items-center gap-2 rounded-lg bg-emerald-900/40 border border-emerald-700/50 px-3 py-2">
                      <LogIn className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{a?.name}</p>
                        <p className="text-[10px] text-emerald-300">Receive from {mov?.fromLocation}</p>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400 uppercase">RECEIVE</span>
                    </div>
                  );
                })}
                {dispatchQueued.map((item) => {
                  const a = assets.find((x) => x.id === item.assetId);
                  return (
                    <div key={item.assetId} className="flex items-center gap-2 rounded-lg bg-orange-900/40 border border-orange-700/50 px-3 py-2">
                      <LogOut className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{a?.name}</p>
                        <p className="text-[10px] text-orange-300">Dispatch → {dispatchTo || "?"}</p>
                      </div>
                      <span className="text-[10px] font-bold text-orange-400 uppercase">DISPATCH</span>
                    </div>
                  );
                })}
              </div>

              {/* Approve button */}
              <div className="flex gap-3 pt-1">
                <button onClick={processApproval}
                  disabled={approving || (dispatchQueued.length > 0 && !dispatchTo)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-sm font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition-colors">
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                  Approve & Process
                </button>
                {dispatchQueued.length > 0 && dispatchQueued.length > 1 && (
                  <button onClick={() => setShowBulkDC(true)} disabled={!dispatchTo}
                    className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-indigo-700 disabled:opacity-50">
                    <FileText className="h-4 w-4" /> + DC
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Force Inward (managers + employees) — check in assets located elsewhere ── */}
          {(!isRestricted || profile?.role === "Employee") && allInTransit.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
              <button onClick={() => setShowForce((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100 transition-colors">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">
                    Force Inward — Pending / Skipped Check-ins ({allInTransit.length})
                  </span>
                </div>
                <span className="text-xs text-amber-600 font-medium">{showForce ? "▲ Hide" : "▼ Show"}</span>
              </button>
              {showForce && (
                <div className="border-t border-amber-200">
                  <p className="px-4 py-2.5 text-[11px] text-amber-700 bg-amber-100 border-b border-amber-200">
                    Assets in-transit but <strong>NOT headed to {myLoc}</strong>. Use when physically returned here without completing normal steps.
                  </p>
                  <div className="divide-y divide-amber-100 max-h-64 overflow-y-auto">
                    {allInTransit.map((m) => (
                      <ForceInwardRow key={m.id} mov={m} assets={assets} myLoc={myLoc}
                        masterWH={masterWH} cycles={cycles} profile={profile} onDone={onDone} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showBulkDC && (
        <BulkCheckInOutDialog
          assetIds={dispatchQueued.map((q) => q.assetId)}
          locations={locations}
          initialMode="checkout"
          initialDestination={dispatchTo}
          onClose={() => { setShowBulkDC(false); clearQueue(); onDone(); }}
        />
      )}

      {/* Signature (hidden file input) */}
      <input ref={sigRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]; if (!f) return;
        const r = new FileReader(); r.onload = (ev) => setSigImg(ev.target?.result as string); r.readAsDataURL(f);
      }} />
    </div>
  );
}

// Small helper row for force-inward (keeps SmartMovementPanel leaner)
function ForceInwardRow({ mov, assets, myLoc, masterWH, cycles, profile, onDone }: {
  mov: AssetMovement; assets: Asset[]; myLoc: string;
  masterWH: Location | undefined; cycles: AssetCycle[];
  profile: ReturnType<typeof useAuth>["profile"]; onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  async function handle() {
    setSaving(true);
    try {
      await updateDocument("movements", mov.id, {
        status: "Completed", completedBy: profile?.uid ?? "",
        completedAt: new Date().toISOString(), forceCompleted: true, toLocation: myLoc,
      });
      const isMasterTo = masterWH?.name === myLoc;
      const asset = assets.find((a) => a.id === mov.assetId);
      if (isMasterTo) await completeCycle(mov.assetId, myLoc, cycles, asset?.cycleCount ?? 0);
      else await addLocationToCycle(mov.assetId, myLoc, cycles);
      await updateDocument("assets", mov.assetId, { status: "Available", location: myLoc });
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Force inward: ${mov.assetName} at ${myLoc}`,
        category: "Transfer", details: mov.assetId,
      });
      toast.success(`Force inward: ${mov.assetName}`);
      onDone();
    } catch { toast.error("Force inward failed"); }
    finally { setSaving(false); }
  }
  const isMaster = masterWH?.name === myLoc;
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{mov.assetName}</p>
        <p className="text-[10px] text-slate-500">{mov.fromLocation} → {mov.toLocation}
          <span className="mx-1 text-amber-600">· now at {myLoc}</span></p>
        {isMaster && <p className="text-[10px] font-semibold text-indigo-600">↩ Will complete cycle</p>}
      </div>
      <button onClick={handle} disabled={saving}
        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        Force Inward
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK-OUT PANEL
// ─────────────────────────────────────────────────────────────────────────────
function CheckoutPanel({ assets, locations, projects, cycles, profile, isRestricted, isManager, masterWH, onDone }: {
  assets: Asset[]; locations: Location[]; projects: Project[]; cycles: AssetCycle[];
  profile: ReturnType<typeof useAuth>["profile"];
  isRestricted: boolean; isManager: boolean; masterWH: Location | undefined; onDone: () => void;
}) {
  const [fromLoc,        setFromLoc]        = useState("");
  const [toLoc,          setToLoc]          = useState("");
  const [selected,       setSelected]       = useState<string[]>([]);
  const [notes,          setNotes]          = useState("");
  const [saving,         setSaving]         = useState(false);
  const [genDC,          setGenDC]          = useState(false);
  const [sigImg,         setSigImg]         = useState<string | undefined>();
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const sigRef = useRef<HTMLInputElement>(null);

  const fromLocs = isManager
    ? locations
    : (profile?.allowedLocations?.length ? locations.filter((l) => profile.allowedLocations!.includes(l.name)) : locations);

  // Auto-default fromLoc for Customer role to their first allowed location
  useEffect(() => {
    if (isRestricted && !fromLoc && fromLocs.length > 0) {
      setFromLoc(fromLocs[0].name);
    }
  }, [isRestricted, fromLoc, fromLocs]);

  const fromAssets = fromLoc ? assets.filter((a) => a.location === fromLoc && a.status === "Available") : [];

  function getAllowedToLocs() {
    const base = locations.filter((l) => l.name !== fromLoc);
    if (isManager || selected.length === 0) return base;
    const projIds = new Set(selected.map((id) => assets.find((a) => a.id === id)?.projectId).filter(Boolean));
    const withR = [...projIds].map((pid) => projects.find((p) => p.id === pid))
      .filter((p): p is Project => !!p?.allowedLocations?.length);
    if (!withR.length) return base;
    const sets = withR.map((p) => new Set(p.allowedLocations!));
    const ok = [...sets[0]].filter((n) => sets.every((s) => s.has(n)));
    const res = base.filter((l) => ok.includes(l.name));
    if (!isRestricted && masterWH && !res.find((l) => l.id === masterWH.id)) res.push(masterWH);
    return res;
  }

  async function handleCheckout(withDC: boolean) {
    if (!fromLoc || !toLoc || !selected.length) { toast.error("Select from, to, and at least one asset"); return; }
    const allowed = getAllowedToLocs();
    if (allowed.length && !allowed.find((l) => l.name === toLoc)) { toast.error("Destination restricted by project rules"); return; }
    setSaving(true);
    try {
      const created: AssetMovement[] = [];
      const isMasterFrom = masterWH?.name === fromLoc;

      for (const assetId of selected) {
        const asset = assets.find((a) => a.id === assetId)!;
        let cycleId: string | undefined;
        // Start a new cycle when departing master warehouse
        if (isMasterFrom) {
          cycleId = await startCycle(assetId, asset.name, fromLoc, cycles);
        } else {
          // Record this location in any active cycle
          await addLocationToCycle(assetId, fromLoc, cycles);
        }
        const mov: Omit<AssetMovement, "id"> = {
          assetId, assetName: asset.name, fromLocation: fromLoc, toLocation: toLoc,
          movementType: "Checkout", status: "In-Transit",
          createdBy: profile?.uid ?? "", createdAt: new Date().toISOString(),
          notes: notes || undefined, cycleId,
        };
        const newId = await addDocument("movements", mov);
        created.push({ id: (newId as unknown as string), ...mov });
        await updateDocument("assets", assetId, { status: "In-Transit" });
      }

      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Checked out ${selected.length} asset(s): ${fromLoc} → ${toLoc}${isMasterFrom ? " [cycle started]" : ""}`,
        category: "Transfer", details: selected.join(", "),
      });

      if (withDC) await generateMovementDC(created, assets, locations, projects, sigImg);

      // Global notification — visible to all users
      try {
        const { addDocument: ad } = await import("@/lib/storage");
        const dispatchedAssets2 = selected.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
        const summary2 = buildDispatchSummary(dispatchedAssets2);
        await ad("notifications", {
          title: `📦 Incoming Shipment — ${toLoc}`,
          message: `${selected.length} item${selected.length > 1 ? "s" : ""} dispatched from ${fromLoc}:\n${summary2}`,
          type: "warning",
          read: false,
          createdAt: new Date().toISOString(),
        });
      } catch { /* notification failure should not block checkout */ }

      toast.success(`${selected.length} asset${selected.length > 1 ? "s" : ""} checked out → ${toLoc}${isMasterFrom ? " | Cycle started" : ""}`);
      setSelected([]); setNotes(""); setToLoc(""); setSigImg(undefined); onDone();
    } catch { toast.error("Checkout failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {masterWH && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-700">
          <RotateCcw className="inline h-3 w-3 mr-1" />
          Checking out from <strong>{masterWH.name}</strong> will automatically <strong>start a new asset cycle</strong>.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">From Location *</label>
          <select value={fromLoc} onChange={(e) => { setFromLoc(e.target.value); setSelected([]); setToLoc(""); }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
            <option value="">— select —</option>
            {fromLocs.map((l) => <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">To Location *</label>
          <select value={toLoc} onChange={(e) => setToLoc(e.target.value)} disabled={!fromLoc}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:bg-slate-50">
            <option value="">— select —</option>
            {getAllowedToLocs().map((l) => <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>)}
          </select>
        </div>
      </div>

      {fromLoc && (
        <BulkScanner scannedIds={selected} availableAssets={fromAssets} allAssets={assets}
          onAdd={(id) => setSelected((p) => [...p, id])} onRemove={(id) => setSelected((p) => p.filter((x) => x !== id))}
          placeholder="Scan QR / RFID / BLE / Barcode, or press Enter…" />
      )}

      {fromLoc && fromAssets.length > 0 && (
        <details className="rounded-xl border border-slate-200 overflow-hidden">
          <summary className="cursor-pointer bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            <Search className="inline h-3.5 w-3.5 mr-1" />
            Browse available assets at {fromLoc} ({fromAssets.length})
          </summary>
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
            {fromAssets.map((a) => {
              const proj = projects.find((p) => p.id === a.projectId);
              const checked = selected.includes(a.id);
              const ac = cycles.find((c) => c.assetId === a.id && c.status === "Active");
              return (
                <label key={a.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 ${checked ? "bg-orange-50" : ""}`}>
                  <input type="checkbox" checked={checked}
                    onChange={() => setSelected((p) => checked ? p.filter((x) => x !== a.id) : [...p, a.id])} className="rounded" />
                  <Package className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{a.uuid}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {ac && <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] text-indigo-700">Cycle #{ac.cycleNumber}</span>}
                    {proj && <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-700 shrink-0">{proj.name}</span>}
                  </div>
                </label>
              );
            })}
          </div>
          {selected.length > 0 && <div className="border-t bg-orange-50 px-4 py-2 text-xs text-orange-700 font-medium">{selected.length} selected</div>}
        </details>
      )}

      {fromLoc && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              placeholder="Reference number, reason…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Signature for DC (optional)</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => sigRef.current?.click()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                {sigImg ? "Change" : "Upload"}
              </button>
              {sigImg && <>
                <img src={sigImg} alt="sig" className="h-8 rounded border border-slate-200 object-contain" />
                <button onClick={() => setSigImg(undefined)}><X className="h-3.5 w-3.5 text-slate-400" /></button>
              </>}
            </div>
            <input ref={sigRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const r = new FileReader(); r.onload = (ev) => setSigImg(ev.target?.result as string); r.readAsDataURL(f);
            }} />
          </div>
        </div>
      )}

      {fromLoc && (
        <div className="space-y-2">
          {selected.length > 1 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 shrink-0" />
              <span><strong>{selected.length} assets selected</strong> — "Check Out + DC" will open Bulk DC mode (Option 01 / Option 02)</span>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => handleCheckout(false)} disabled={saving || !toLoc || !selected.length}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-600 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
              {saving && !genDC ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Check Out {selected.length > 0 ? `(${selected.length})` : ""}
            </button>
            <button
              onClick={() => {
                if (selected.length > 1) {
                  // Auto bulk DC mode — open BulkCheckInOutDialog
                  setShowBulkDialog(true);
                } else {
                  setGenDC(true); handleCheckout(true).finally(() => setGenDC(false));
                }
              }}
              disabled={saving || !selected.length || (selected.length === 1 && !toLoc)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-orange-300 bg-orange-50 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50">
              {saving && genDC ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Check Out + DC {selected.length > 1 ? "(Bulk)" : ""}
            </button>
          </div>
        </div>
      )}

      {showBulkDialog && (
        <BulkCheckInOutDialog
          assetIds={selected}
          locations={locations}
          initialMode="checkout"
          onClose={() => { setShowBulkDialog(false); setSelected([]); setToLoc(""); onDone(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK-IN PANEL
// ─────────────────────────────────────────────────────────────────────────────
function CheckinPanel({ assets, locations, movements, cycles, profile, isRestricted, isManager, masterWH, onDone }: {
  assets: Asset[]; locations: Location[]; movements: AssetMovement[]; cycles: AssetCycle[];
  profile: ReturnType<typeof useAuth>["profile"];
  isRestricted: boolean; isManager: boolean; masterWH: Location | undefined; onDone: () => void;
}) {
  const [currentLoc, setCurrentLoc] = useState("");
  const [scanned,    setScanned]    = useState<string[]>([]);
  const [saving,     setSaving]     = useState<string | null>(null);
  const [showForce,  setShowForce]  = useState(false);

  const accessibleLocs = isRestricted && profile?.allowedLocations?.length
    ? locations.filter((l) => profile.allowedLocations!.includes(l.name))
    : locations;

  // Auto-default receiving location for Customer role
  useEffect(() => {
    if (isRestricted && !currentLoc && accessibleLocs.length > 0) {
      setCurrentLoc(accessibleLocs[0].name);
    }
  }, [isRestricted, currentLoc, accessibleLocs]);

  const pendingArrivals = movements.filter((m) => m.status === "In-Transit" && m.toLocation === currentLoc);
  const arrivalAssets   = assets.filter((a) => pendingArrivals.some((m) => m.assetId === a.id));

  // All in-transit assets NOT already going to currentLoc (for force-inward)
  const allInTransit = movements.filter((m) => m.status === "In-Transit" && m.toLocation !== currentLoc);

  async function doCheckin(m: AssetMovement, forcedLoc?: string) {
    const loc = forcedLoc ?? currentLoc;
    await updateDocument("movements", m.id, {
      status: "Completed", completedBy: profile?.uid ?? "",
      completedAt: new Date().toISOString(),
      ...(forcedLoc ? { forceCompleted: true, toLocation: forcedLoc } : {}),
    });
    const isMasterTo = masterWH?.name === loc;
    const asset = assets.find((a) => a.id === m.assetId);
    if (isMasterTo) {
      await completeCycle(m.assetId, loc, cycles, asset?.cycleCount ?? 0);
    } else {
      await addLocationToCycle(m.assetId, loc, cycles);
    }
    await updateDocument("assets", m.assetId, { status: "Available", location: loc });
    await logAudit({
      userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
      action: `Checked in: ${m.assetName} at ${loc}${forcedLoc ? " [FORCE INWARD]" : ""}${isMasterTo ? " [cycle completed]" : ""}`,
      category: "Transfer", details: m.assetId,
    });
  }

  async function handleCheckin(m: AssetMovement) {
    setSaving(m.id);
    try {
      await doCheckin(m);
      const isMaster = masterWH?.name === currentLoc;
      toast.success(`${m.assetName} checked in${isMaster ? " — Cycle completed! 🎉" : ""}`);
      setScanned((p) => p.filter((x) => x !== m.assetId));
      onDone();
    } catch { toast.error("Check-in failed"); }
    finally { setSaving(null); }
  }

  async function handleBulkCheckin(list: AssetMovement[]) {
    if (!list.length) return;
    setSaving("bulk");
    try {
      for (const m of list) await doCheckin(m);
      const isMaster = masterWH?.name === currentLoc;
      toast.success(`${list.length} assets checked in${isMaster ? " — Cycles updated!" : ""}`);
      setScanned([]); onDone();
    } catch { toast.error("Bulk check-in failed"); }
    finally { setSaving(null); }
  }

  async function handleForceInward(m: AssetMovement) {
    setSaving(`force-${m.id}`);
    try {
      await doCheckin(m, currentLoc);
      const isMaster = masterWH?.name === currentLoc;
      toast.success(`Force inward: ${m.assetName} at ${currentLoc}${isMaster ? " — Cycle closed" : ""}`);
      onDone();
    } catch { toast.error("Force inward failed"); }
    finally { setSaving(null); }
  }

  const scannedPending = scanned.map((id) => pendingArrivals.find((m) => m.assetId === id)).filter(Boolean) as AssetMovement[];

  return (
    <div className="space-y-4">
      {masterWH && currentLoc === masterWH.name && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
          <RotateCcw className="inline h-3 w-3 mr-1" />
          Checking in at <strong>{masterWH.name}</strong> will <strong>complete the asset cycle</strong> and update the cycle count.
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Your Receiving Location *</label>
        <select value={currentLoc} onChange={(e) => { setCurrentLoc(e.target.value); setScanned([]); }}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
          <option value="">— select location —</option>
          {accessibleLocs.map((l) => <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " ⭐" : ""}</option>)}
        </select>
      </div>

      {currentLoc && (
        <>
          <BulkScanner
            scannedIds={scanned} availableAssets={arrivalAssets} allAssets={assets}
            onAdd={(id) => {
              if (!pendingArrivals.find((m) => m.assetId === id)) {
                toast.error(`${assets.find((a) => a.id === id)?.name ?? id} not expected here`); return;
              }
              setScanned((p) => p.includes(id) ? p : [...p, id]);
            }}
            onRemove={(id) => setScanned((p) => p.filter((x) => x !== id))}
            placeholder="Scan arriving asset tag…" />

          {scannedPending.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="text-xs font-semibold text-emerald-800">{scannedPending.length} scanned, ready to check in</span>
              <button onClick={() => handleBulkCheckin(scannedPending)} disabled={saving === "bulk"}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving === "bulk" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                Check In Scanned
              </button>
            </div>
          )}

          {/* Pending arrivals for this location */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <Clock className="inline h-3.5 w-3.5 mr-1 text-amber-500" />
                In-Transit to {currentLoc} ({pendingArrivals.length})
              </span>
              {pendingArrivals.length > 1 && (
                <button onClick={() => handleBulkCheckin(pendingArrivals)} disabled={!!saving}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {saving === "bulk" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                  Check In All
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
              {pendingArrivals.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-400">No in-transit assets expected at this location</p>
              )}
              {pendingArrivals.map((m) => {
                const isScanned = scanned.includes(m.assetId);
                const isMaster  = masterWH?.name === currentLoc;
                return (
                  <div key={m.id} className={`flex items-center gap-3 px-4 py-3 ${isScanned ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                    {isScanned ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Clock className="h-4 w-4 shrink-0 text-amber-400" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{m.assetName}</p>
                      <p className="text-[10px] text-slate-400">From: {m.fromLocation} · {new Date(m.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</p>
                      {isMaster && <p className="text-[10px] font-semibold text-indigo-600">↩ Will complete cycle</p>}
                    </div>
                    <button onClick={() => handleCheckin(m)} disabled={!!saving}
                      className="shrink-0 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {saving === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Check In
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FORCE INWARD — for warehouse/admin when customer skipped check-in/out */}
          {!isRestricted && allInTransit.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
              <button onClick={() => setShowForce((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100 transition-colors">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">
                    Force Inward — Pending / Skipped Check-ins ({allInTransit.length})
                  </span>
                </div>
                <span className="text-xs text-amber-600 font-medium">{showForce ? "▲ Hide" : "▼ Show"}</span>
              </button>

              {showForce && (
                <div className="border-t border-amber-200">
                  <p className="px-4 py-2.5 text-[11px] text-amber-700 bg-amber-100 border-b border-amber-200">
                    These assets are <strong>in-transit but NOT headed to {currentLoc}</strong>. Use Force Inward when a customer / supplier physically returned or forwarded the asset here without completing check-in/out steps. This will complete the pending task, set the asset location to <strong>{currentLoc}</strong>, and update the cycle if applicable.
                  </p>
                  <div className="divide-y divide-amber-100 max-h-64 overflow-y-auto">
                    {allInTransit.map((m) => {
                      const isMaster = masterWH?.name === currentLoc;
                      return (
                        <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{m.assetName}</p>
                            <p className="text-[10px] text-slate-500">
                              Was: {m.fromLocation} → {m.toLocation}
                              <span className="mx-1 text-amber-600">· now at {currentLoc}</span>
                            </p>
                            <p className="text-[10px] text-slate-400">{new Date(m.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</p>
                            {isMaster && <p className="text-[10px] font-semibold text-indigo-600">↩ Will complete cycle</p>}
                          </div>
                          <button onClick={() => handleForceInward(m)}
                            disabled={!!saving}
                            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                            {saving === `force-${m.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                            Force Inward
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DC PANEL
// ─────────────────────────────────────────────────────────────────────────────
function DCPanel({ movements, assets, locations, projects, cancels, profile, isManager, onDone }: {
  movements: AssetMovement[]; assets: Asset[]; locations: Location[]; projects: Project[];
  cancels: DCCancellation[];
  profile: ReturnType<typeof useAuth>["profile"];
  isManager: boolean; onDone: () => void;
}) {
  const [sigImg,       setSigImg]       = useState<string | undefined>();
  const [genId,        setGenId]        = useState<string | null>(null);
  const [showCancel,   setShowCancel]   = useState<AssetMovement | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [reviewId,     setReviewId]     = useState<string | null>(null);
  const [dcLogs,       setDcLogs]       = useState<DCLog[]>([]);
  const [regenId,      setRegenId]      = useState<string | null>(null);
  const sigRef = useRef<HTMLInputElement>(null);

  // Fetch dc_logs on mount — Admin/Manager see all; Customer sees only logs for their location(s)
  useEffect(() => {
    fetchAll<DCLog>("dc_logs").then((rows) => {
      const myLocs = profile?.allowedLocations ?? [];
      const filtered = isManager
        ? rows
        : rows.filter((r) =>
            myLocs.includes(r.fromLocation) || myLocs.includes(r.toLocation)
          );
      setDcLogs([...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
  }, [movements, isManager, profile?.allowedLocations]);

  async function handleGenerateDC(m: AssetMovement) {
    setGenId(m.id);
    try {
      await generateMovementDC([m], assets, locations, projects, sigImg);
      // refresh dc_logs
      const rows = await fetchAll<DCLog>("dc_logs");
      setDcLogs([...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } finally { setGenId(null); }
  }

  async function handleRegenDC(log: DCLog) {
    setRegenId(log.id);
    try {
      const { generateAssetsDC } = await import("@/lib/dc");
      const snaps = log.assetSnapshots.map((s) => ({
        id: s.id, name: s.name, uuid: s.uuid, status: "Available" as const,
        location: log.fromLocation, healthScore: 100, lastUpdated: log.createdAt,
        rfidTag: s.rfidTag, bleTag: s.bleTag, cost: s.cost, description: s.description,
      }));
      await generateAssetsDC(
        snaps, log.fromLocation, log.toLocation, log.movementType,
        { lineMode: log.lineMode, showRFID: log.showRFID, showBLE: log.showBLE },
        sigImg, locations
      );
    } finally { setRegenId(null); }
  }

  async function handleCancelRequest() {
    if (!showCancel || !cancelReason.trim()) { toast.error("Provide a reason"); return; }
    setCancelSaving(true);
    try {
      await addDocument("dc_cancellations", {
        movementId: showCancel.id, assetIds: [showCancel.assetId], assetNames: showCancel.assetName,
        fromLocation: showCancel.fromLocation, toLocation: showCancel.toLocation,
        requestedBy: profile?.uid ?? "", requestedAt: new Date().toISOString(),
        reason: cancelReason, status: "Pending",
      } satisfies Omit<DCCancellation, "id">);
      toast.success("Cancellation request submitted");
      setShowCancel(null); setCancelReason(""); onDone();
    } catch { toast.error("Failed"); }
    finally { setCancelSaving(false); }
  }

  async function handleReview(c: DCCancellation, approve: boolean) {
    setReviewId(c.id);
    try {
      await updateDocument("dc_cancellations", c.id, {
        status: approve ? "Approved" : "Rejected",
        reviewedBy: profile?.uid ?? "", reviewedAt: new Date().toISOString(),
      });
      if (approve) {
        await updateDocument("movements", c.movementId, { status: "Completed" });
        for (const id of c.assetIds)
          await updateDocument("assets", id, { status: "Available", location: c.fromLocation });
        toast.success("Approved — assets returned to origin");
      } else { toast.success("Rejected"); }
      onDone();
    } catch { toast.error("Review failed"); }
    finally { setReviewId(null); }
  }

  const pendingCancels = cancels.filter((c) => c.status === "Pending");
  const myMovements    = isManager ? movements : movements.filter((m) => m.createdBy === profile?.uid);

  return (
    <div className="space-y-5">

      {/* Signature */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-xs text-slate-600 font-medium">Signature for DCs:</span>
        <button onClick={() => sigRef.current?.click()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
          {sigImg ? "Change" : "Upload Signature"}
        </button>
        {sigImg && <>
          <img src={sigImg} alt="sig" className="h-8 rounded border object-contain" />
          <button onClick={() => setSigImg(undefined)}><X className="h-3.5 w-3.5 text-slate-400" /></button>
        </>}
        <input ref={sigRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const r = new FileReader(); r.onload = (ev) => setSigImg(ev.target?.result as string); r.readAsDataURL(f);
        }} />
      </div>

      {/* Pending approvals */}
      {isManager && pendingCancels.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">Pending Cancellation Approvals ({pendingCancels.length})</span>
          </div>
          {pendingCancels.map((c) => (
            <div key={c.id} className="flex items-start gap-3 px-4 py-3 border-b border-amber-100 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{c.assetNames}</p>
                <p className="text-xs text-slate-500">{c.fromLocation} → {c.toLocation}</p>
                <p className="text-xs text-amber-700 italic">"{c.reason}"</p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button onClick={() => handleReview(c, true)} disabled={reviewId === c.id}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {reviewId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve
                </button>
                <button onClick={() => handleReview(c, false)} disabled={reviewId === c.id}
                  className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
                  <XCircle className="h-3 w-3" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── DC Movement Record Table ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            DC Movement Record ({dcLogs.length})
          </span>
          <span className="text-[10px] text-slate-400">Showing all generated DCs — click Download to re-print</span>
        </div>

        <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="border-b border-slate-200">
                {["SL No","Date","Time","Project","DC No","From","To","Description","Qty","DC Download"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {dcLogs.length === 0 && (
                <tr><td colSpan={10} className="py-10 text-center text-slate-400">No DCs generated yet</td></tr>
              )}
              {dcLogs.map((log, idx) => {
                const d = new Date(log.createdAt);
                // try to find project from first snapshot
                const snap = log.assetSnapshots[0];
                const projAsset = assets.find((a) => a.id === snap?.id);
                const proj = projects.find((p) => p.id === projAsset?.projectId);
                return (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{d.toLocaleDateString("en-IN")}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{proj?.name ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{log.dcNo}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{log.fromLocation ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{log.toLocation ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700 max-w-[200px] truncate" title={log.description}>{log.description}</td>
                    <td className="px-3 py-2.5 text-center font-semibold text-slate-700">{log.qty}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => handleRegenDC(log)} disabled={regenId === log.id}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50 transition-colors">
                        {regenId === log.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                        Download
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Per-movement quick DC generation ─────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Generate DC from Movement ({myMovements.length})
          </span>
        </div>
        <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200">
                {["SL No","Date","Time","Asset","From → To","Type","Status","Action"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {myMovements.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-slate-400">No movement records</td></tr>
              )}
              {[...myMovements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((m, idx) => {
                const d  = new Date(m.createdAt);
                const cs = cancels.find((c) => c.movementId === m.id)?.status;
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{d.toLocaleDateString("en-IN")}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[140px] truncate">{m.assetName}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{m.fromLocation} → {m.toLocation}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">{m.movementType}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                        m.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}>{m.status}</span>
                      {cs && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                        cs === "Pending" ? "bg-amber-100 text-amber-700" : cs === "Approved" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
                      }`}>Cancel:{cs}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleGenerateDC(m)} disabled={genId === m.id}
                          className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                          {genId === m.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Download className="h-2.5 w-2.5" />} DC
                        </button>
                        {!cs && m.status === "In-Transit" && (
                          <button onClick={() => { setShowCancel(m); setCancelReason(""); }}
                            className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100">
                            <XCircle className="h-2.5 w-2.5" /> Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Request DC Cancellation</h3>
              <button onClick={() => setShowCancel(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              <p className="font-semibold">{showCancel.assetName}</p>
              <p>{showCancel.fromLocation} → {showCancel.toLocation}</p>
              <p className="mt-1">Requires manager approval. Asset will be returned to origin if approved.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Reason *</label>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 resize-none"
                placeholder="Explain why this movement needs to be cancelled…" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCancel(null)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
              <button onClick={handleCancelRequest} disabled={cancelSaving || !cancelReason.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-50">
                {cancelSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CYCLE REPORT PANEL
// ─────────────────────────────────────────────────────────────────────────────
function CyclesPanel({ cycles, assets, projects }: {
  cycles: AssetCycle[]; assets: Asset[]; projects: Project[];
}) {
  const [assetFilter,   setAssetFilter]   = useState("");
  const [statusFilter,  setStatusFilter]  = useState<"All"|"Active"|"Completed">("All");
  const [projectFilter, setProjectFilter] = useState("");

  // Enrich with asset info
  const enriched = cycles.map((c) => {
    const a = assets.find((x) => x.id === c.assetId);
    const proj = projects.find((p) => p.id === a?.projectId);
    return { ...c, asset: a, project: proj };
  });

  const filtered = enriched
    .filter((c) => !assetFilter || c.assetName.toLowerCase().includes(assetFilter.toLowerCase()) || c.asset?.uuid.toLowerCase().includes(assetFilter.toLowerCase()))
    .filter((c) => statusFilter === "All" || c.status === statusFilter)
    .filter((c) => !projectFilter || c.asset?.projectId === projectFilter)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const totalCompleted = cycles.filter((c) => c.status === "Completed").length;
  const totalActive    = cycles.filter((c) => c.status === "Active").length;
  const avgDuration    = cycles.filter((c) => c.durationDays != null).length
    ? Math.round(cycles.filter((c) => c.durationDays != null).reduce((s, c) => s + (c.durationDays ?? 0), 0) / cycles.filter((c) => c.durationDays != null).length)
    : 0;
  const maxCycleAsset  = assets.reduce((best, a) => (a.cycleCount ?? 0) > (best.cycleCount ?? 0) ? a : best, assets[0]);

  function exportCSV() {
    const rows = filtered.map((c) => ({
      asset: c.assetName, uuid: c.asset?.uuid ?? "", project: c.project?.name ?? "",
      cycle: c.cycleNumber, started: c.startedAt, completed: c.completedAt ?? "",
      duration_days: c.durationDays ?? "", locations: c.locationsVisited.join(" → "), status: c.status,
    }));
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify((r as Record<string, unknown>)[h] ?? "")).join(","))].join("\n");
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "cycle-report.csv" }).click();
  }

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Cycles",    value: cycles.length,   color: "text-slate-900",   sub: "all time" },
          { label: "Completed",       value: totalCompleted,  color: "text-emerald-600", sub: "full round-trips" },
          { label: "Active (Open)",   value: totalActive,     color: "text-amber-600",   sub: "in progress" },
          { label: "Avg Duration",    value: avgDuration ? `${avgDuration}d` : "—", color: "text-blue-600", sub: "days per cycle" },
        ].map(({ label, value, color, sub }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-slate-400">{sub}</p>
          </div>
        ))}
      </div>

      {/* Top cycled asset */}
      {maxCycleAsset && (maxCycleAsset.cycleCount ?? 0) > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-indigo-500 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-indigo-800">Most Active Asset</p>
            <p className="text-sm font-bold text-indigo-900">{maxCycleAsset.name} <span className="text-xs font-normal text-indigo-600">— {maxCycleAsset.cycleCount} completed cycle{(maxCycleAsset.cycleCount ?? 0) > 1 ? "s" : ""}</span></p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}
            placeholder="Search asset name / UUID…"
            className="rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-xs outline-none focus:border-slate-400 w-52" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-slate-400">
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
        </select>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-slate-400">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={exportCSV}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Cycle table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-center">Cycle #</th>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-left">Completed</th>
                <th className="px-4 py-3 text-center">Duration</th>
                <th className="px-4 py-3 text-left">Route (Locations Visited)</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-slate-400 text-xs">No cycle records match your filters</td></tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800 truncate max-w-[140px]">{c.assetName}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{c.asset?.uuid}</p>
                    {c.project && <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-700">{c.project.name}</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 mx-auto">
                      {c.cycleNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                    <Calendar className="inline h-3 w-3 mr-1 text-slate-400" />
                    {new Date(c.startedAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                    {c.completedAt ? (
                      <><Calendar className="inline h-3 w-3 mr-1 text-emerald-400" />{new Date(c.completedAt).toLocaleDateString("en-IN")}</>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.durationDays != null ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{c.durationDays}d</span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="flex flex-wrap items-center gap-1">
                      {c.locationsVisited.map((loc, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">
                            <MapPin className="inline h-2.5 w-2.5 mr-0.5" />{loc}
                          </span>
                          {i < c.locationsVisited.length - 1 && <span className="text-slate-300 text-[9px]">→</span>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {c.status === "Completed" ? <><CheckCircle2 className="inline h-3 w-3 mr-0.5" />Done</> : <><RefreshCw className="inline h-3 w-3 mr-0.5" />Active</>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
