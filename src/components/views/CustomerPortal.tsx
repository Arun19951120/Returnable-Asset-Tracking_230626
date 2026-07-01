"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAll, updateDocument, logAudit } from "@/lib/storage";
import { Asset, AssetMovement, Location, Notification } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Package, Bell, LogOut, LogIn, MapPin,
  Truck, CheckCheck, Loader2, CheckCircle2, Clock,
  QrCode, ScanBarcode, Wifi, Camera, X, FlipHorizontal,
} from "lucide-react";
import CheckInOutDialog from "@/components/dialogs/CheckInOutDialog";

const STATUS_CFG: Record<string, { fill: string; light: string; text: string }> = {
  Available:    { fill: "#10b981", light: "bg-emerald-100", text: "text-emerald-700" },
  "In-Transit": { fill: "#3b82f6", light: "bg-blue-100",    text: "text-blue-700" },
  Dispatched:   { fill: "#f59e0b", light: "bg-amber-100",   text: "text-amber-700" },
  Maintenance:  { fill: "#ef4444", light: "bg-red-100",     text: "text-red-700" },
};

// ── Pure SVG donut chart ─────────────────────────────────────────────────────
function DonutChart({
  data, selected, onSelect,
}: {
  data: { status: string; count: number }[];
  selected: string | null;
  onSelect: (s: string | null) => void;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
        <Package className="h-10 w-10 opacity-30" />
        <p className="text-sm">No assets at your location</p>
      </div>
    );
  }

  const cx = 90; const cy = 90; const r = 78; const ir = 44;
  let angle = -Math.PI / 2;

  const slices = data.map((d) => {
    const sweep = (d.count / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const xi1 = cx + ir * Math.cos(angle);
    const yi1 = cy + ir * Math.sin(angle);
    const xi2 = cx + ir * Math.cos(angle - sweep);
    const yi2 = cy + ir * Math.sin(angle - sweep);
    const large = sweep > Math.PI ? 1 : 0;
    const path = `M ${xi2} ${yi2} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi2} ${yi2} Z`;
    return { ...d, path, sweep };
  });

  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 180 180" className="w-52 h-52">
        {slices.map((s) => {
          const cfg = STATUS_CFG[s.status];
          const isSelected = selected === s.status;
          const sc = isSelected ? 1.05 : 1;
          const tx = cx * (1 - sc); const ty = cy * (1 - sc);
          return (
            <path key={s.status} d={s.path}
              fill={cfg?.fill ?? "#94a3b8"}
              opacity={selected && !isSelected ? 0.35 : 1}
              transform={isSelected ? `matrix(${sc},0,0,${sc},${tx},${ty})` : undefined}
              stroke="white" strokeWidth="2"
              onClick={() => onSelect(selected === s.status ? null : s.status)}
              className="cursor-pointer transition-all duration-200"
            />
          );
        })}
        <text x={cx} y={cy - 8}  textAnchor="middle" fontSize="26" fontWeight="800" fill="#1e293b">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="#64748b">total assets</text>
      </svg>

      {/* Legend pills */}
      <div className="flex flex-wrap justify-center gap-2">
        {slices.map((s) => {
          const cfg = STATUS_CFG[s.status];
          return (
            <button key={s.status}
              onClick={() => onSelect(selected === s.status ? null : s.status)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                selected === s.status
                  ? "border-slate-800 bg-slate-800 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: cfg?.fill ?? "#94a3b8" }} />
              {s.status} · {s.count}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Camera QR scanner (lightweight, inline) ──────────────────────────────────
function CameraOverlay({ onDetect, onClose }: { onDetect: (v: string) => void; onClose: () => void }) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const lastScan  = useRef("");
  const lastTime  = useRef(0);
  const [facing, setFacing] = useState<"environment"|"user">("environment");
  const [last,   setLast]   = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } }).then((s) => {
      stream = s;
      if (videoRef.current) videoRef.current.srcObject = s;
    }).catch(() => {});
    return () => { stream?.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(rafRef.current); };
  }, [facing]);

  useEffect(() => {
    let jsQR: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
    import("jsqr").then((m) => { jsQR = m.default; });
    function tick() {
      const v = videoRef.current; const c = canvasRef.current;
      if (v && c && v.readyState >= v.HAVE_ENOUGH_DATA && jsQR) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(v, 0, 0);
          const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          if (code?.data) {
            const now = Date.now();
            if (code.data !== lastScan.current || now - lastTime.current > 2000) {
              lastScan.current = code.data; lastTime.current = now;
              setLast(code.data); onDetect(code.data);
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
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-white" />
          <span className="text-sm font-semibold text-white">Scan to Receive</span>
          <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] text-green-400 animate-pulse">LIVE</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFacing((f) => f === "environment" ? "user" : "environment")}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20">
            <FlipHorizontal className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-56 w-56">
            <div className="absolute inset-0 -m-[9999px] bg-black/50" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }} />
            {[["top-0 left-0 border-t-2 border-l-2"],["top-0 right-0 border-t-2 border-r-2"],["bottom-0 left-0 border-b-2 border-l-2"],["bottom-0 right-0 border-b-2 border-r-2"]].map(([cls], i) => (
              <div key={i} className={`absolute h-8 w-8 ${cls} border-white`} />
            ))}
          </div>
        </div>
      </div>
      <div className="bg-black/80 px-4 py-3">
        {last
          ? <p className="text-center text-sm text-green-400 font-mono truncate">{last}</p>
          : <p className="text-center text-xs text-slate-400">Point camera at asset QR code</p>}
      </div>
    </div>
  );
}

// ── Main portal ──────────────────────────────────────────────────────────────
export default function CustomerPortal() {
  const { profile } = useAuth();
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [notifs,    setNotifs]    = useState<Notification[]>([]);
  const [projects,  setProjects]  = useState<import("@/lib/types").Project[]>([]);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [txAsset,   setTxAsset]   = useState<Asset | null>(null);
  const [txMode,    setTxMode]    = useState<"checkout" | "checkin">("checkout");

  // Incoming shipment receive state
  const [receiving,    setReceiving]    = useState<string[]>([]);   // movement ids being received
  const [receiveAll,   setReceiveAll]   = useState(false);
  const [checkingInAll, setCheckingInAll] = useState(false);
  const [scanMode,     setScanMode]     = useState(false);
  const [scanInput,    setScanInput]    = useState("");
  const [showCamera,   setShowCamera]   = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const myLocations: string[] = profile?.allowedLocations ?? [];

  const load = useCallback(async () => {
    const [a, l, n, m, p] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<Location>("locations"),
      fetchAll<Notification>("notifications"),
      fetchAll<AssetMovement>("movements"),
      fetchAll<import("@/lib/types").Project>("projects"),
    ]);
    setAssets(a);
    setLocations(l);
    setMovements(m);
    setProjects(p.filter((x) => x.status === "Active"));
    setNotifs(
      n.filter((x) => (!x.forUser || x.forUser === profile?.uid) && !x.read)
       .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    );
  }, [profile?.uid]);

  useEffect(() => { load(); }, [load]);

  // Incoming shipments — In-Transit movements headed to my locations
  const incomingMovements = movements.filter(
    (m) => m.status === "In-Transit" && effectiveMyLocations.includes(m.toLocation)
  );

  async function doReceive(mov: AssetMovement) {
    await updateDocument("movements", mov.id, {
      status: "Completed",
      completedBy: profile?.uid ?? "",
      completedAt: new Date().toISOString(),
    });
    await updateDocument("assets", mov.assetId, {
      status: "Available",
      location: mov.toLocation,
    });
    await logAudit({
      userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
      action: `Received: ${mov.assetName} at ${mov.toLocation}`,
      category: "Transfer", details: mov.assetId,
    });
  }

  async function handleReceiveAll() {
    setReceiveAll(true);
    try {
      for (const m of incomingMovements) await doReceive(m);
      load();
    } finally { setReceiveAll(false); }
  }

  async function handleReceiveOne(mov: AssetMovement) {
    setReceiving((p) => [...p, mov.id]);
    try { await doReceive(mov); load(); }
    finally { setReceiving((p) => p.filter((x) => x !== mov.id)); }
  }

  async function handleCheckInAll() {
    const inTransitAssets = assets.filter((a) => effectiveMyLocations.includes(a.location) && a.status === "In-Transit");
    if (!inTransitAssets.length) return;
    setCheckingInAll(true);
    try {
      for (const a of inTransitAssets) {
        // Complete any matching movement records
        const mov = movements.find((m) => m.assetId === a.id && m.status === "In-Transit");
        if (mov) {
          await updateDocument("movements", mov.id, {
            status: "Completed",
            completedBy: profile?.uid ?? "",
            completedAt: new Date().toISOString(),
          });
        }
        await updateDocument("assets", a.id, { status: "Available", location: a.location });
        await logAudit({
          userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
          action: `Bulk Check-In: ${a.name} at ${a.location}`,
          category: "Transfer", details: a.id,
        });
      }
      load();
    } finally { setCheckingInAll(false); }
  }

  function handleScanReceive(raw: string) {
    const q = raw.trim().toLowerCase();
    const asset = assets.find((a) =>
      a.uuid.toLowerCase() === q || a.id.toLowerCase() === q ||
      (a.rfidTag ?? "").toLowerCase() === q || (a.bleTag ?? "").toLowerCase() === q ||
      a.name.toLowerCase() === q
    );
    if (!asset) { return; }
    const mov = incomingMovements.find((m) => m.assetId === asset.id);
    if (!mov) { return; }
    handleReceiveOne(mov);
    setScanInput("");
    setShowCamera(false);
  }

  // Derive locations from assigned projects (if projects have configured allowedLocations),
  // falling back to profile.allowedLocations
  const custProjectIds = profile?.projects ?? [];
  const projBasedLocs = projects
    .filter((p) => custProjectIds.includes(p.id) && (p.allowedLocations?.length ?? 0) > 0)
    .flatMap((p) => p.allowedLocations ?? []);
  const effectiveMyLocations: string[] = projBasedLocs.length > 0
    ? [...new Set(projBasedLocs)]
    : myLocations;

  // Assets at customer's effective locations
  const myAssets = assets.filter((a) => effectiveMyLocations.includes(a.location));

  const statusCounts = Object.keys(STATUS_CFG)
    .map((s) => ({ status: s, count: myAssets.filter((a) => a.status === s).length }))
    .filter((d) => d.count > 0);

  const filteredAssets = selected
    ? myAssets.filter((a) => a.status === selected)
    : myAssets;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Inventory</h1>
        <div className="flex items-center gap-1.5 mt-1 text-sm text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          {effectiveMyLocations.length ? effectiveMyLocations.join(", ") : "No location assigned"}
        </div>
      </div>

      {/* Unread dispatch notifications */}
      {notifs.length > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 space-y-2 shadow-sm">
          <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
            <Bell className="h-4 w-4 text-amber-600" />
            <span>📦 {notifs.length} new shipment notification{notifs.length > 1 ? "s" : ""}</span>
          </div>
          {notifs.map((n) => (
            <div key={n.id} className="flex items-start gap-2 rounded-lg bg-white border border-amber-200 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-800">{n.title}</p>
                <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-line">{n.message}</p>
                <p className="text-[10px] text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Incoming Shipments ──────────────────────────────────────────────── */}
      {incomingMovements.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-blue-200 bg-blue-100">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-bold text-blue-800">
                Incoming Shipment — {incomingMovements.length} asset{incomingMovements.length > 1 ? "s" : ""} in transit
              </span>
            </div>
            <button
              onClick={handleReceiveAll}
              disabled={receiveAll}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {receiveAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              Bulk Check-In
            </button>
          </div>

          {/* Scan bar */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-blue-100 bg-white">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Scan to receive:</span>
            <button
              onClick={() => { setScanMode(true); scanRef.current?.focus(); }}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                scanMode ? "border-blue-600 bg-blue-600 text-white" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"}`}>
              <ScanBarcode className="h-3.5 w-3.5" /> Barcode / RFID
              {scanMode && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />}
            </button>
            <button
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors">
              <QrCode className="h-3.5 w-3.5" /> QR / Camera <Camera className="h-3 w-3 ml-0.5" />
            </button>
            {scanMode && (
              <input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && scanInput.trim()) handleScanReceive(scanInput); }}
                autoFocus
                placeholder="Scan tag or type UUID / name…"
                className="flex-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-blue-500 ring-1 ring-blue-400"
              />
            )}
            {scanMode && (
              <button onClick={() => { setScanMode(false); setScanInput(""); }}
                className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            )}
          </div>

          {/* Asset list */}
          <div className="divide-y divide-blue-100 max-h-64 overflow-y-auto">
            {incomingMovements.map((mov) => {
              const isReceiving = receiving.includes(mov.id);
              return (
                <div key={mov.id} className="flex items-center gap-3 px-5 py-3 bg-white hover:bg-blue-50 transition-colors">
                  <Clock className="h-4 w-4 shrink-0 text-blue-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{mov.assetName}</p>
                    <p className="text-[10px] text-slate-400">
                      From: <span className="font-medium text-slate-600">{mov.fromLocation}</span>
                      {" · "}
                      {new Date(mov.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleReceiveOne(mov)}
                    disabled={isReceiving}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                    {isReceiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    Receive
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showCamera && (
        <CameraOverlay
          onDetect={(val) => handleScanReceive(val)}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* ── Summary stat cards ── */}
      {(() => {
        const checkedIn   = myAssets.filter((a) => a.status === "Available").length;
        const dispatched  = myAssets.filter((a) => a.status === "Dispatched").length;
        const inTransit   = myAssets.filter((a) => a.status === "In-Transit").length;
        const total       = myAssets.length;
        const stats = [
          {
            label: "Checked In",
            value: checkedIn,
            sub: "fully inward",
            bg: "bg-emerald-50", border: "border-emerald-200",
            icon: LogIn, iconBg: "bg-emerald-500", text: "text-emerald-700",
          },
          {
            label: "Dispatched",
            value: dispatched,
            sub: "out with customer",
            bg: "bg-amber-50", border: "border-amber-200",
            icon: LogOut, iconBg: "bg-amber-500", text: "text-amber-700",
          },
          {
            label: "In Transit",
            value: inTransit,
            sub: "en route",
            bg: "bg-blue-50", border: "border-blue-200",
            icon: Truck, iconBg: "bg-blue-500", text: "text-blue-700",
          },
          {
            label: "Total Assets",
            value: total,
            sub: "at my location",
            bg: "bg-slate-50", border: "border-slate-200",
            icon: Package, iconBg: "bg-slate-500", text: "text-slate-700",
          },
        ];
        return (
          <div className="grid grid-cols-2 gap-3">
            {stats.map(({ label, value, sub, bg, border, icon: Icon, iconBg, text }) => (
              <div key={label} className={`rounded-2xl border ${border} ${bg} p-4 flex items-center gap-3`}>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg} shadow-sm`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className={`text-2xl font-extrabold ${text}`}>{value}</p>
                  <p className="text-xs font-semibold text-slate-700 leading-tight">{label}</p>
                  <p className="text-[10px] text-slate-400">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Pie chart card */}
      <div className="card-bento p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Assets by Status</h2>
        <DonutChart data={statusCounts} selected={selected} onSelect={setSelected} />
      </div>

      {/* Asset list */}
      <div className="card-bento overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-700">
            {selected ? `${selected} Assets` : "All Assets"} ({filteredAssets.length})
          </p>
          <div className="flex items-center gap-2">
            {myAssets.some((a) => a.status === "In-Transit") && (
              <button
                onClick={handleCheckInAll}
                disabled={checkingInAll}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {checkingInAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                Bulk Check-In
              </button>
            )}
            {selected && (
              <button onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:text-slate-600 underline">
                Show all
              </button>
            )}
          </div>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">No assets in this category</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filteredAssets.map((a) => {
              const cfg = STATUS_CFG[a.status];
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg?.light ?? "bg-slate-100"}`}>
                    <Package className={`h-4 w-4 ${cfg?.text ?? "text-slate-500"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{a.uuid} · {a.location}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg?.light ?? "bg-slate-100"} ${cfg?.text ?? "text-slate-600"}`}>
                    {a.status}
                  </span>
                  {a.status === "Available" && (
                    <button onClick={() => { setTxAsset(a); setTxMode("checkout"); }}
                      className="shrink-0 flex items-center gap-1 rounded-lg bg-orange-50 border border-orange-200 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition-colors">
                      <LogOut className="h-3 w-3" /> Check Out
                    </button>
                  )}
                  {(a.status === "Dispatched" || a.status === "In-Transit") && (
                    <button onClick={() => { setTxAsset(a); setTxMode("checkin"); }}
                      className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">
                      <LogIn className="h-3 w-3" /> Check In
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {txAsset && (
        <CheckInOutDialog
          asset={txAsset}
          locations={locations}
          initialMode={txMode}
          onClose={() => { setTxAsset(null); load(); }}
        />
      )}
    </div>
  );
}
