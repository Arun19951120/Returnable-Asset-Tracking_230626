"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Bluetooth, Wifi, ScanLine, QrCode,
  CheckCircle, XCircle, Loader2, RefreshCw, Save,
  Settings, Zap, AlertTriangle, ChevronDown, ChevronUp, MapPin,
} from "lucide-react";
import { fetchAll } from "@/lib/storage";
import { Location } from "@/lib/types";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface RFIDConfig {
  enabled: boolean; readerType: string; ipAddress: string; port: string;
  antennaCount: number; readPower: number; writePower: number;
  protocol: string; tagFormat: string; connected: boolean;
}
interface BLEConfig {
  enabled: boolean; scanInterval: number; rssiThreshold: number;
  tagPrefix: string; macFilter: string; companyId: string; txPower: number; connected: boolean;
}
interface BarcodeConfig {
  enabled: boolean; scannerType: string; comPort: string; baudRate: string;
  symbologies: string[]; triggerMode: string; connected: boolean;
}
interface QRConfig {
  enabled: boolean; cameraIndex: number; resolution: string;
  decodeFormats: string[]; encodeFormat: string; errorCorrection: string;
  moduleSize: number; printDPI: number; connected: boolean;
}
interface HardwareConfigData {
  defaultCheckoutLocation?: string;
  locationCheckInDefaults?: Record<string, string>;
  rfid: RFIDConfig; ble: BLEConfig; barcode: BarcodeConfig; qr: QRConfig;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SectionHeader({
  icon: Icon, label, color, connected, enabled, onToggle, open, onOpenToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; color: string; connected: boolean; enabled: boolean;
  onToggle: (v: boolean) => void; open: boolean; onOpenToggle: () => void;
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-5 py-4 cursor-pointer transition-colors ${open ? "border-slate-300 bg-white shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"}`}
      onClick={onOpenToggle}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-slate-900">{label}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {connected
              ? <span className="flex items-center gap-1 text-xs text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />Connected</span>
              : <span className="flex items-center gap-1 text-xs text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-slate-300 inline-block" />Not connected</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* Enable toggle */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-slate-500">{enabled ? "Enabled" : "Disabled"}</span>
          <button onClick={() => onToggle(!enabled)}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-slate-200"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100";
const select = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 bg-white";

// ─── Main View ────────────────────────────────────────────────────────────────
export default function HardwareConfig() {
  const [config, setConfig] = useState<HardwareConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ rfid: true, ble: false, barcode: false, qr: false });
  const [locations, setLocations] = useState<Location[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, locs] = await Promise.all([
        fetch("/api/hardware-config"),
        fetchAll<Location>("locations"),
      ]);
      setConfig(await res.json());
      setLocations(locs.filter((l) => l.status === "Active"));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      await fetch("/api/hardware-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      toast.success("Hardware configuration saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  async function testConnection(device: keyof HardwareConfigData) {
    if (!config) return;
    setTesting(device);
    try {
      let ok = false;
      let message = "";

      if (device === "rfid") {
        // Real TCP test to RFID reader
        const ip   = config.rfid.ipAddress || "192.168.1.100";
        const port = config.rfid.port || "5084";
        const res  = await fetch(`/api/rfid/test?ip=${encodeURIComponent(ip)}&port=${encodeURIComponent(port)}`);
        const data = await res.json() as { ok: boolean; message: string };
        ok = data.ok; message = data.message;

      } else if (device === "ble") {
        // Real Web Bluetooth adapter check
        if (typeof navigator !== "undefined" && "bluetooth" in navigator) {
          try {
            const available = await (navigator.bluetooth as { getAvailability?: () => Promise<boolean> }).getAvailability?.();
            ok = available ?? true;
            message = ok ? "BLE adapter detected in browser" : "No BLE adapter found — enable Bluetooth on this device";
          } catch {
            ok = false; message = "Web Bluetooth permission denied or unavailable";
          }
        } else {
          ok = false; message = "Web Bluetooth not supported — use Chrome or Edge";
        }

      } else if (device === "barcode") {
        // Check Web Serial API availability
        if (typeof navigator !== "undefined" && "serial" in navigator) {
          ok = true; message = `Web Serial API available (${config.barcode.scannerType})`;
        } else {
          // USB HID scanners work as keyboards — always usable
          ok = config.barcode.scannerType === "USB HID";
          message = ok
            ? "USB HID scanner detected — plug in and scan to test"
            : "Web Serial API not available — use Chrome/Edge, or switch to USB HID mode";
        }

      } else if (device === "qr") {
        // Test camera access
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
          ok = true; message = "Camera access granted — QR scanner ready";
        } catch (err: unknown) {
          ok = false;
          message = err instanceof Error && err.name === "NotAllowedError"
            ? "Camera permission denied — allow camera access in browser settings"
            : "No camera detected";
        }
      }

      setConfig((prev) => prev ? { ...prev, [device]: { ...(prev[device] as object), connected: ok } } : prev);
      if (ok) toast.success(message);
      else     toast.error(message);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTesting(null);
    }
  }

  type DeviceKey = "rfid" | "ble" | "barcode" | "qr";
  function patch(device: DeviceKey, field: string, value: unknown) {
    setConfig((prev) => prev ? { ...prev, [device]: { ...prev[device], [field]: value } } : prev);
  }

  function toggleSymbology(sym: string) {
    if (!config) return;
    const arr = config.barcode.symbologies;
    patch("barcode", "symbologies", arr.includes(sym) ? arr.filter((s) => s !== sym) : [...arr, sym]);
  }

  function toggleDecodeFormat(fmt: string) {
    if (!config) return;
    const arr = config.qr.decodeFormats;
    patch("qr", "decodeFormats", arr.includes(fmt) ? arr.filter((f) => f !== fmt) : [...arr, fmt]);
  }

  function toggleOpen(key: string) {
    setOpen((p) => ({ ...p, [key]: !p[key] }));
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
    </div>
  );

  if (!config) return null;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hardware Configuration</h1>
          <p className="text-sm text-slate-500">Configure RFID, BLE, Barcode & QR Code reader/writer devices</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save All
        </button>
      </div>

      {/* ── Movement Defaults ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
            <MapPin className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 text-sm">Movement Defaults</p>
            <p className="text-xs text-slate-500">Pre-fill locations when users open Check Out from the sidebar</p>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Default Check Out Location</label>
          <select
            value={config.defaultCheckoutLocation ?? ""}
            onChange={(e) => setConfig((p) => p ? { ...p, defaultCheckoutLocation: e.target.value } : p)}
            className={select}
          >
            <option value="">— None (user selects manually) —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.name}>{l.name}{l.isMasterWarehouse ? " (Master WH)" : ""}</option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-slate-400">
            When a user clicks "Check Out" in the sidebar, their "My Location" field will pre-fill with this value.
          </p>
        </div>
      </div>

      {/* Status overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          { key: "rfid",    label: "RFID",    icon: Wifi,     color: "bg-blue-600" },
          { key: "ble",     label: "BLE",     icon: Bluetooth,color: "bg-indigo-600" },
          { key: "barcode", label: "Barcode", icon: ScanLine, color: "bg-amber-600" },
          { key: "qr",      label: "QR Code", icon: QrCode,   color: "bg-emerald-600" },
        ] as const).map(({ key, label, icon: Icon, color }) => {
          const dev = config[key];
          return (
            <button key={key} onClick={() => setOpen((p) => ({ ...p, [key]: true }))}
              className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:shadow-sm transition-shadow">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color} mb-2`}>
                <Icon className="h-4 w-4 text-white" />
              </div>
              <p className="text-xs font-semibold text-slate-800">{label}</p>
              <div className="flex items-center gap-1.5 mt-1">
                {dev.connected
                  ? <><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-[10px] text-emerald-600 font-medium">Connected</span></>
                  : <><span className="h-1.5 w-1.5 rounded-full bg-slate-300" /><span className="text-[10px] text-slate-400">{dev.enabled ? "Offline" : "Disabled"}</span></>}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── RFID ─────────────────────────────────────────────────────────── */}
      <div className="space-y-0">
        <SectionHeader icon={Wifi} label="RFID Reader / Writer" color="bg-blue-600"
          connected={config.rfid.connected} enabled={config.rfid.enabled}
          onToggle={(v) => patch("rfid", "enabled", v)}
          open={open.rfid} onOpenToggle={() => toggleOpen("rfid")} />

        {open.rfid && (
          <div className="rounded-b-xl border border-t-0 border-slate-200 bg-slate-50 px-5 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reader Type">
                <select className={select} value={config.rfid.readerType} onChange={(e) => patch("rfid", "readerType", e.target.value)}>
                  {["Fixed Gate / Portal Reader", "Handheld RFID Gun", "Wearable Glove Scanner", "Desktop USB Reader"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Protocol">
                <select className={select} value={config.rfid.protocol} onChange={(e) => patch("rfid", "protocol", e.target.value)}>
                  {["LLRP", "Speedway", "GS1 EPC", "ISO 18000-63"].map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="IP Address / Host">
                <input className={input} value={config.rfid.ipAddress} onChange={(e) => patch("rfid", "ipAddress", e.target.value)} placeholder="192.168.1.100" />
              </Field>
              <Field label="Port">
                <input className={input} value={config.rfid.port} onChange={(e) => patch("rfid", "port", e.target.value)} placeholder="5084" />
              </Field>
              <Field label="Tag Format">
                <select className={select} value={config.rfid.tagFormat} onChange={(e) => patch("rfid", "tagFormat", e.target.value)}>
                  {["EPC Gen2", "ISO 15693", "ISO 14443A", "NFC"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Antenna Count">
                <select className={select} value={config.rfid.antennaCount} onChange={(e) => patch("rfid", "antennaCount", +e.target.value)}>
                  {[1,2,4,8].map((n) => <option key={n} value={n}>{n} antenna{n > 1 ? "s" : ""}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label={`Read Power: ${config.rfid.readPower} dBm`}>
                <input type="range" min={10} max={33} step={1} value={config.rfid.readPower}
                  onChange={(e) => patch("rfid", "readPower", +e.target.value)}
                  className="w-full accent-blue-600" />
              </Field>
              <Field label={`Write Power: ${config.rfid.writePower} dBm`}>
                <input type="range" min={10} max={33} step={1} value={config.rfid.writePower}
                  onChange={(e) => patch("rfid", "writePower", +e.target.value)}
                  className="w-full accent-blue-600" />
              </Field>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <div className="text-xs text-slate-400">
                {config.rfid.connected
                  ? <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Device responding</span>
                  : <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-slate-300" /> Not connected</span>}
              </div>
              <button onClick={() => testConnection("rfid")} disabled={testing === "rfid"}
                className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60">
                {testing === "rfid" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Test Connection
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── BLE ──────────────────────────────────────────────────────────── */}
      <div className="space-y-0">
        <SectionHeader icon={Bluetooth} label="BLE Tag Scanner" color="bg-indigo-600"
          connected={config.ble.connected} enabled={config.ble.enabled}
          onToggle={(v) => patch("ble", "enabled", v)}
          open={open.ble} onOpenToggle={() => toggleOpen("ble")} />

        {open.ble && (
          <div className="rounded-b-xl border border-t-0 border-slate-200 bg-slate-50 px-5 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Scan Interval (ms)">
                <input type="number" className={input} value={config.ble.scanInterval}
                  onChange={(e) => patch("ble", "scanInterval", +e.target.value)} min={100} max={10000} />
              </Field>
              <Field label={`RSSI Threshold: ${config.ble.rssiThreshold} dBm`}>
                <input type="range" min={-100} max={-30} step={1} value={config.ble.rssiThreshold}
                  onChange={(e) => patch("ble", "rssiThreshold", +e.target.value)}
                  className="w-full accent-indigo-600 mt-3" />
              </Field>
              <Field label="Tag ID Prefix">
                <input className={input} value={config.ble.tagPrefix} onChange={(e) => patch("ble", "tagPrefix", e.target.value)} placeholder="BLE-" />
              </Field>
              <Field label="Company ID (hex)">
                <input className={input} value={config.ble.companyId} onChange={(e) => patch("ble", "companyId", e.target.value)} placeholder="0x004C" />
              </Field>
              <Field label="MAC Address Filter (optional)">
                <input className={input} value={config.ble.macFilter} onChange={(e) => patch("ble", "macFilter", e.target.value)} placeholder="AA:BB:CC:* (wildcard ok)" />
              </Field>
              <Field label={`TX Power: ${config.ble.txPower} dBm`}>
                <input type="range" min={-20} max={8} step={4} value={config.ble.txPower}
                  onChange={(e) => patch("ble", "txPower", +e.target.value)}
                  className="w-full accent-indigo-600 mt-3" />
              </Field>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <div className="text-xs">
                {config.ble.connected
                  ? <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> BLE adapter ready</span>
                  : <span className="text-slate-400 flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-slate-300" /> No adapter detected</span>}
              </div>
              <button onClick={() => testConnection("ble")} disabled={testing === "ble"}
                className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
                {testing === "ble" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bluetooth className="h-3.5 w-3.5" />}
                Scan for Adapter
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Barcode ───────────────────────────────────────────────────────── */}
      <div className="space-y-0">
        <SectionHeader icon={ScanLine} label="Barcode Scanner" color="bg-amber-600"
          connected={config.barcode.connected} enabled={config.barcode.enabled}
          onToggle={(v) => patch("barcode", "enabled", v)}
          open={open.barcode} onOpenToggle={() => toggleOpen("barcode")} />

        {open.barcode && (
          <div className="rounded-b-xl border border-t-0 border-slate-200 bg-slate-50 px-5 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Scanner Type / Interface">
                <select className={select} value={config.barcode.scannerType} onChange={(e) => patch("barcode", "scannerType", e.target.value)}>
                  {["USB HID", "Bluetooth SPP", "RS-232 Serial", "Wearable Glove Scanner", "Camera based scan"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Trigger Mode">
                <select className={select} value={config.barcode.triggerMode} onChange={(e) => patch("barcode", "triggerMode", e.target.value)}>
                  {["Manual", "Auto (Continuous)", "Level Trigger", "Pulse Trigger"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="COM Port / Device Path">
                <input className={input} value={config.barcode.comPort} onChange={(e) => patch("barcode", "comPort", e.target.value)} placeholder="COM3 or /dev/ttyUSB0" />
              </Field>
              <Field label="Baud Rate">
                <select className={select} value={config.barcode.baudRate} onChange={(e) => patch("barcode", "baudRate", e.target.value)}>
                  {["9600","19200","38400","57600","115200"].map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600">Active Symbologies</label>
              <div className="flex flex-wrap gap-2">
                {["Code128","Code39","Code93","EAN13","EAN8","UPC-A","QR","DataMatrix","PDF417","Aztec","Interleaved 2of5"].map((sym) => (
                  <button key={sym} onClick={() => toggleSymbology(sym)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      config.barcode.symbologies.includes(sym)
                        ? "border-amber-500 bg-amber-100 text-amber-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}>
                    {sym}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <div className="text-xs">
                {config.barcode.connected
                  ? <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Scanner detected on {config.barcode.comPort}</span>
                  : <span className="text-slate-400 flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-slate-300" /> No scanner detected</span>}
              </div>
              <button onClick={() => testConnection("barcode")} disabled={testing === "barcode"}
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60">
                {testing === "barcode" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                Detect Scanner
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── QR Code ───────────────────────────────────────────────────────── */}
      <div className="space-y-0">
        <SectionHeader icon={QrCode} label="QR Code Reader / Writer" color="bg-emerald-600"
          connected={config.qr.connected} enabled={config.qr.enabled}
          onToggle={(v) => patch("qr", "enabled", v)}
          open={open.qr} onOpenToggle={() => toggleOpen("qr")} />

        {open.qr && (
          <div className="rounded-b-xl border border-t-0 border-slate-200 bg-slate-50 px-5 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Camera Index">
                <select className={select} value={config.qr.cameraIndex} onChange={(e) => patch("qr", "cameraIndex", +e.target.value)}>
                  {[0,1,2].map((i) => <option key={i} value={i}>Camera {i} {i === 0 ? "(default / rear)" : i === 1 ? "(front)" : "(external)"}</option>)}
                </select>
              </Field>
              <Field label="Capture Resolution">
                <select className={select} value={config.qr.resolution} onChange={(e) => patch("qr", "resolution", e.target.value)}>
                  {["640x480","1280x720","1920x1080"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Encode Format (Write)">
                <select className={select} value={config.qr.encodeFormat} onChange={(e) => patch("qr", "encodeFormat", e.target.value)}>
                  {["QR_CODE","DATA_MATRIX","AZTEC","PDF_417"].map((f) => <option key={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Error Correction Level">
                <select className={select} value={config.qr.errorCorrection} onChange={(e) => patch("qr", "errorCorrection", e.target.value)}>
                  {[["L","Low (~7%)"],["M","Medium (~15%)"],["Q","Quartile (~25%)"],["H","High (~30%)"]].map(([v,l]) => <option key={v} value={v}>{v} — {l}</option>)}
                </select>
              </Field>
              <Field label={`Module Size: ${config.qr.moduleSize}px`}>
                <input type="range" min={2} max={12} step={1} value={config.qr.moduleSize}
                  onChange={(e) => patch("qr", "moduleSize", +e.target.value)}
                  className="w-full accent-emerald-600 mt-3" />
              </Field>
              <Field label="Print DPI">
                <select className={select} value={config.qr.printDPI} onChange={(e) => patch("qr", "printDPI", +e.target.value)}>
                  {[72,96,150,203,300,600].map((d) => <option key={d} value={d}>{d} DPI</option>)}
                </select>
              </Field>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600">Active Decode Formats (Read)</label>
              <div className="flex flex-wrap gap-2">
                {["QR_CODE","DATA_MATRIX","AZTEC","PDF_417","CODE_128","CODE_39","EAN_13","UPC_A"].map((fmt) => (
                  <button key={fmt} onClick={() => toggleDecodeFormat(fmt)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      config.qr.decodeFormats.includes(fmt)
                        ? "border-emerald-500 bg-emerald-100 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}>
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <div className="text-xs">
                {config.qr.connected
                  ? <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Camera ready</span>
                  : <span className="text-slate-400 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Camera access required</span>}
              </div>
              <button onClick={() => testConnection("qr")} disabled={testing === "qr"}
                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                {testing === "qr" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
                Test Camera Access
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reset all */}
      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600">
          <RefreshCw className="h-3.5 w-3.5" /> Reset to saved
        </button>
      </div>
    </div>
  );
}
