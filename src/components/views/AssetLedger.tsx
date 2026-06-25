"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import { Asset, Location, Project } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Search, Plus, Download, QrCode, X, Loader2,
  Upload, FileSpreadsheet,
  Wifi, Trash2, MoreHorizontal, LogOut, LogIn, ArrowRightLeft, Archive,
} from "lucide-react";
import { KitItem } from "@/lib/types";
import CheckInOutDialog from "@/components/dialogs/CheckInOutDialog";
import BulkCheckInOutDialog from "@/components/dialogs/BulkCheckInOutDialog";
import FilterBar, { DayRange, filterByDays } from "@/components/ui/FilterBar";
import { toast } from "sonner";

// ── helpers ──────────────────────────────────────────────────────────────────
function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="font-mono text-xs font-medium text-slate-500">{score}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Asset["status"] }) {
  const s: Record<Asset["status"], string> = {
    Available: "bg-emerald-100 text-emerald-700", Dispatched: "bg-blue-100 text-blue-700",
    "In-Transit": "bg-amber-100 text-amber-700", Maintenance: "bg-red-100 text-red-700",
    Retired: "bg-slate-200 text-slate-500",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s[status]}`}>{status}</span>;
}

function exportCSV(assets: Asset[], projects: Project[]) {
  const pm = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const headers = ["id", "name", "uuid", "status", "location", "project", "healthScore", "rfidTag", "bleTag", "lastUpdated"];
  const csv = [headers.join(","), ...assets.map((a) =>
    headers.map((h) => JSON.stringify(h === "project" ? (pm[a.projectId ?? ""] ?? "") : (a as unknown as Record<string, unknown>)[h] ?? "")).join(",")
  )].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: "assets-export.csv" }).click();
  URL.revokeObjectURL(url);
  toast.success("Assets exported to CSV");
}

async function buildQRDataUrl(uuid: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  // Encode UUID only as per requirement
  return QRCode.toDataURL(uuid, { width: 256, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
}

const EMPTY = { name: "", uuid: "", description: "", status: "Available" as Asset["status"], location: "", healthScore: 90, cost: 0, projectId: "", rfidTag: "", bleTag: "" };

// ── Bulk-add row type ────────────────────────────────────────────────────────
interface BulkRow { name: string; uuid: string; description: string; location: string; status: Asset["status"]; healthScore: number; cost: number; projectId: string }
const EMPTY_ROW = (): BulkRow => ({ name: "", uuid: "", description: "", location: "", status: "Available", healthScore: 90, cost: 0, projectId: "" });

const CSV_TEMPLATE = "name,uuid,description,status,location,healthScore,cost,projectId\nSmart Container SC-110,SC-110-XXXX,Smart Container,Available,Warehouse A,90,5000,\nDynamic Rack DR-210,DR-210-YYYY,Dynamic Rack,Available,Warehouse A,85,8000,";

// ── Serial UUID increment ─────────────────────────────────────────────────────
// Finds the last contiguous digit-group in the string and increments it,
// preserving leading zeros (e.g. "SC-100-001" + 3 → "SC-100-004").
function incrementUUID(uuid: string, step: number): string {
  // Match: everything before the last digit-group, the digits, anything after
  const match = uuid.match(/^([\s\S]*?)(\d+)(\D*)$/);
  if (match) {
    const [, prefix, digits, suffix] = match;
    const incremented = String(parseInt(digits, 10) + step).padStart(digits.length, "0");
    return `${prefix}${incremented}${suffix}`;
  }
  // No numeric part found — append padded index
  return `${uuid}-${String(step + 1).padStart(3, "0")}`;
}

// Same logic for the name field
function incrementName(name: string, step: number): string {
  const match = name.match(/^([\s\S]*?)(\d+)(\D*)$/);
  if (match) {
    const [, prefix, digits, suffix] = match;
    const incremented = String(parseInt(digits, 10) + step).padStart(digits.length, "0");
    return `${prefix}${incremented}${suffix}`;
  }
  return name; // no number in name — keep same name
}

function generateSerialRows(
  seed: BulkRow & { autoIncrementName: boolean },
  count: number
): BulkRow[] {
  return Array.from({ length: count }, (_, i) => ({
    ...seed,
    uuid: incrementUUID(seed.uuid, i),
    name: seed.autoIncrementName ? incrementName(seed.name, i) : seed.name,
  }));
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AssetLedger() {
  const { profile } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [dayRange, setDayRange] = useState<DayRange>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [checkoutAsset, setCheckoutAsset] = useState<Asset | null>(null);
  const [checkoutMode, setCheckoutMode] = useState<"checkout"|"checkin"|"transfer">("checkout");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [retireAsset, setRetireAsset] = useState<Asset | null>(null);
  const [retireCategory, setRetireCategory] = useState<"Damaged"|"End of Life"|"Lost"|"Other">("Damaged");
  const [retireReason, setRetireReason] = useState("");
  const [retireSaving, setRetireSaving] = useState(false);
  const [showBulkTx, setShowBulkTx] = useState(false);
  // QR modal
  const [qrAsset,   setQrAsset]   = useState<Asset | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  // Add asset modal
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"single" | "bulk" | "csv">("single");
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  // RFID / BLE reader state
  const [rfidReading, setRfidReading] = useState(false);
  const [bleReading, setBleReading] = useState(false);

  // Kit items
  const [hasKit, setHasKit] = useState(false);
  const [kitItems, setKitItems] = useState<KitItem[]>([{ description: "", qty: 1 }]);

  // Bulk manual rows (Option A — row-by-row table)
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([EMPTY_ROW()]);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Bulk serial (Option B — first asset + count)
  const [bulkSubMode, setBulkSubMode] = useState<"table" | "serial">("table");
  const [serialSeed, setSerialSeed] = useState<BulkRow & { autoIncrementName: boolean }>({
    ...EMPTY_ROW(), autoIncrementName: true,
  });
  const [serialCount, setSerialCount] = useState(5);
  const [serialPreview, setSerialPreview] = useState<BulkRow[]>([]);
  const [serialSaving, setSerialSaving] = useState(false);

  // CSV paste
  const [csvText, setCsvText] = useState("");
  const [csvParsed, setCsvParsed] = useState<BulkRow[]>([]);
  const [csvSaving, setCsvSaving] = useState(false);

  const load = useCallback(async () => {
    const [a, l, p] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<Location>("locations"),
      fetchAll<Project>("projects"),
    ]);
    setAssets(a);
    setLocations(l);
    setProjects(p.filter((p) => p.status === "Active"));
  }, []);

  // Master warehouses — the only valid initial registration points
  const masterWarehouses = locations.filter((l) => l.isMasterWarehouse && l.status === "Active");

  useEffect(() => { load(); }, [load]);

  const pm = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const filtered = filterByDays(assets, dayRange, "lastUpdated").filter((a) => {
    const s = search.toLowerCase();
    return (!s || a.name.toLowerCase().includes(s) || a.uuid.toLowerCase().includes(s) || a.location.toLowerCase().includes(s))
      && (statusFilter === "All" || a.status === statusFilter)
      && (!locationFilter || a.location === locationFilter)
      && (!projectFilter || a.projectId === projectFilter);
  });

  const allowedLocations = profile?.allowedLocations?.length
    ? locations.filter((l) => profile.allowedLocations!.includes(l.name)) : locations;

  const toggleSelect = (id: string) =>
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  // ── RFID / BLE reader helper ─────────────────────────────────────────────────
  async function readTag(type: "rfid" | "ble") {
    const setter = type === "rfid" ? setRfidReading : setBleReading;
    setter(true);
    try {
      const res = await fetch("/api/hardware-config");
      const cfg = res.ok ? await res.json() : null;
      const enabled = type === "rfid" ? cfg?.rfid?.enabled : cfg?.ble?.enabled;
      if (!enabled) {
        toast.error(`${type.toUpperCase()} reader not configured — enable it in Hardware Config`);
        return;
      }
      // Reader is a keyboard-emulator device: focus the input and wait for scan
      toast.info(`Place tag on ${type.toUpperCase()} reader…`, { duration: 3000 });
      setTimeout(() => {
        document.getElementById(`${type}-tag-input`)?.focus();
        setter(false);
      }, 500);
    } catch {
      toast.error("Could not reach hardware config");
    } finally {
      setTimeout(() => setter(false), 3500);
    }
  }

  // ── Single add ──────────────────────────────────────────────────────────────
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.uuid || !form.location) { toast.error("Name, UUID and Location are required"); return; }
    setSaving(true);
    try {
      const validKits = hasKit ? kitItems.filter((k) => k.description.trim()) : undefined;
      await addDocument("assets", {
        ...form,
        kitItems: validKits?.length ? validKits : undefined,
        lastUpdated: new Date().toISOString(),
      });
      await logAudit({ userId: profile?.uid ?? "", userEmail: profile?.email ?? "", action: `Asset added: ${form.name}`, category: "Asset", details: `UUID: ${form.uuid}` });
      toast.success("Asset added");
      setForm({ ...EMPTY });
      setHasKit(false);
      setKitItems([{ description: "", qty: 1 }]);
      load();
    } catch { toast.error("Failed to add asset"); }
    finally { setSaving(false); }
  }

  // ── Bulk manual add (Option A) ───────────────────────────────────────────────
  function updateRow(i: number, field: keyof BulkRow, val: string | number) {
    setBulkRows((rows) => rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  async function handleBulkAdd() {
    const valid = bulkRows.filter((r) => r.name && r.uuid && r.location);
    if (!valid.length) { toast.error("Fill at least one complete row"); return; }
    setBulkSaving(true);
    try {
      await Promise.all(valid.map((row) => addDocument("assets", { ...row, lastUpdated: new Date().toISOString() })));
      await logAudit({ userId: profile?.uid ?? "", userEmail: profile?.email ?? "", action: `Bulk add: ${valid.length} assets`, category: "Asset", details: valid.map((r) => r.uuid).join(", ") });
      toast.success(`${valid.length} assets added`);
      setBulkRows([EMPTY_ROW()]); load();
    } catch { toast.error("Bulk add failed"); }
    finally { setBulkSaving(false); }
  }

  // ── Serial generation (Option B) ─────────────────────────────────────────────
  function handleSerialPreview() {
    if (!serialSeed.uuid.trim()) { toast.error("Enter a UUID for the first asset"); return; }
    if (!serialSeed.name.trim()) { toast.error("Enter a name for the first asset"); return; }
    if (!serialSeed.location.trim()) { toast.error("Enter a location"); return; }
    if (serialCount < 1 || serialCount > 500) { toast.error("Count must be between 1 and 500"); return; }
    const rows = generateSerialRows(serialSeed, serialCount);
    setSerialPreview(rows);
  }

  async function handleSerialSave() {
    if (!serialPreview.length) return;
    setSerialSaving(true);
    try {
      await Promise.all(
        serialPreview.map((row) => addDocument("assets", { ...row, lastUpdated: new Date().toISOString() }))
      );
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Serial bulk add: ${serialPreview.length} assets starting ${serialPreview[0].uuid}`,
        category: "Asset",
        details: `UUIDs: ${serialPreview[0].uuid} … ${serialPreview[serialPreview.length - 1].uuid}`,
      });
      toast.success(`${serialPreview.length} assets added with serial UUIDs`);
      setSerialPreview([]); setSerialSeed({ ...EMPTY_ROW(), autoIncrementName: true }); setSerialCount(5); load();
    } catch { toast.error("Serial add failed"); }
    finally { setSerialSaving(false); }
  }

  // ── CSV parse & import ──────────────────────────────────────────────────────
  function parseCSV() {
    try {
      const lines = csvText.trim().split("\n");
      const headers = lines[0].split(",").map((h) => h.trim());
      const rows: BulkRow[] = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return {
          name: obj.name ?? "", uuid: obj.uuid ?? "",
          description: obj.description ?? "",
          status: (obj.status as Asset["status"]) ?? "Available",
          location: obj.location ?? "", healthScore: parseInt(obj.healthScore ?? "90") || 90,
          cost: parseFloat(obj.cost ?? "0") || 0,
          projectId: obj.projectId ?? "",
        };
      }).filter((r) => r.name && r.uuid);
      if (!rows.length) { toast.error("No valid rows found in CSV"); return; }
      setCsvParsed(rows);
      toast.success(`${rows.length} rows parsed — review then import`);
    } catch { toast.error("Failed to parse CSV"); }
  }

  async function handleCSVImport() {
    if (!csvParsed.length) return;
    setCsvSaving(true);
    try {
      await Promise.all(csvParsed.map((row) => addDocument("assets", { ...row, lastUpdated: new Date().toISOString() })));
      await logAudit({ userId: profile?.uid ?? "", userEmail: profile?.email ?? "", action: `CSV import: ${csvParsed.length} assets`, category: "Asset", details: csvParsed.map((r) => r.uuid).join(", ") });
      toast.success(`${csvParsed.length} assets imported`);
      setCsvText(""); setCsvParsed([]); load();
    } catch { toast.error("Import failed"); }
    finally { setCsvSaving(false); }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "asset-import-template.csv" }).click();
    URL.revokeObjectURL(url);
  }

  const uniqueLocations = [...new Set(assets.map((a) => a.location).filter(Boolean))].sort();

  async function handleRetire() {
    if (!retireAsset) return;
    setRetireSaving(true);
    try {
      await updateDocument("assets", retireAsset.id, {
        status: "Retired",
        retireCategory,
        retireReason,
        retiredAt: new Date().toISOString(),
      });
      await logAudit({
        userId: profile?.uid ?? "",
        userEmail: profile?.email ?? "",
        action: `Asset Retired: ${retireAsset.name} (${retireCategory})`,
        category: "Asset",
        details: retireAsset.id,
      });
      setRetireAsset(null);
      load();
    } finally {
      setRetireSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Asset Ledger</h1>
          <p className="text-sm text-slate-500">{filtered.length} of {assets.length} assets</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportCSV(filtered, projects)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          {selected.length > 1 && (
            <button onClick={() => setShowBulkTx(true)}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Bulk Tx ({selected.length})
            </button>
          )}
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            <Plus className="h-4 w-4" /> Add Asset
          </button>
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        locationFilter={locationFilter} locations={uniqueLocations} onLocationChange={setLocationFilter}
        projectFilter={projectFilter} projects={projects.map((p) => ({ id: p.id, name: p.name }))} onProjectChange={setProjectFilter}
        statusFilter={statusFilter === "All" ? "" : statusFilter}
        statusOptions={["Available", "Dispatched", "In-Transit", "Maintenance", "Retired"]}
        onStatusChange={(v) => setStatusFilter(v || "All")}
        extraFilters={
          <>
            <div className="relative min-w-44">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-3 text-xs outline-none focus:border-slate-400" />
            </div>
          </>
        }
      />

      {/* Project label */}
      {projectFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Project:</span>
          <span className="flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white">
            {pm[projectFilter] ?? projectFilter}
            <button onClick={() => setProjectFilter("")}><X className="h-3 w-3 ml-0.5" /></button>
          </span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3">
                <input type="checkbox" className="rounded"
                  checked={selected.length === filtered.length && filtered.length > 0}
                  onChange={() => setSelected(selected.length === filtered.length ? [] : filtered.map((a) => a.id))} />
              </th>
              {["Asset Name", "UUID", "Project", "Status", "Location", "Health", "Tags", "Updated", ""].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-slate-400">No assets match your filters</td></tr>
            )}
            {filtered.map((asset) => (
              <tr key={asset.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded" checked={selected.includes(asset.id)} onChange={() => toggleSelect(asset.id)} />
                </td>
                <td className="px-3 py-3 font-medium text-slate-800 whitespace-nowrap">{asset.name}</td>
                <td className="px-3 py-3 font-mono text-xs text-slate-400">{asset.uuid}</td>
                <td className="px-3 py-3">
                  {asset.projectId && pm[asset.projectId]
                    ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 whitespace-nowrap">{pm[asset.projectId]}</span>
                    : <span className="text-xs text-slate-300">—</span>}
                </td>
                <td className="px-3 py-3"><StatusBadge status={asset.status} /></td>
                <td className="px-3 py-3 text-slate-600 text-xs whitespace-nowrap">{asset.location}</td>
                <td className="px-3 py-3"><HealthBar score={asset.healthScore} /></td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-0.5">
                    {asset.rfidTag && <span className="font-mono text-[10px] text-slate-400">RFID:{asset.rfidTag}</span>}
                    {asset.bleTag && <span className="font-mono text-[10px] text-blue-400">BLE:{asset.bleTag}</span>}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{new Date(asset.lastUpdated).toLocaleDateString()}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
                    {/* QR button */}
                    <button
                      onClick={async () => {
                        const url = await buildQRDataUrl(asset.uuid);
                        setQrDataUrl(url); setQrAsset(asset);
                      }}
                      title="Show QR Code"
                      className="rounded border border-slate-200 p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                      <QrCode className="h-3.5 w-3.5" />
                    </button>
                    {/* ⋯ action menu */}
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpenId(menuOpenId === asset.id ? null : asset.id)}
                        className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                        title="Actions">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                      {menuOpenId === asset.id && (
                        <>
                          {/* Backdrop to close on outside click */}
                          <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />
                          <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Actions</p>
                            {[
                              { mode: "checkout" as const, label: "Check Out", icon: LogOut,          color: "text-orange-600", bg: "hover:bg-orange-50" },
                              { mode: "checkin"  as const, label: "Check In",  icon: LogIn,           color: "text-emerald-600", bg: "hover:bg-emerald-50" },
                              { mode: "transfer" as const, label: "Transfer",  icon: ArrowRightLeft,  color: "text-purple-600", bg: "hover:bg-purple-50" },
                            ].map(({ mode, label, icon: Icon, color, bg }) => (
                              <button
                                key={mode}
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setCheckoutMode(mode);
                                  setCheckoutAsset(asset);
                                }}
                                className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 ${bg} transition-colors`}>
                                <Icon className={`h-4 w-4 ${color}`} />
                                {label}
                              </button>
                            ))}
                            {asset.status !== "Retired" && (
                              <>
                                <div className="my-1 border-t border-slate-100" />
                                <button
                                  onClick={() => { setMenuOpenId(null); setRetireCategory("Damaged"); setRetireReason(""); setRetireAsset(asset); }}
                                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-red-50 transition-colors">
                                  <Archive className="h-4 w-4 text-red-500" />
                                  Retire Asset
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Add Asset Modal ─────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h3 className="font-semibold text-slate-900">Add Asset</h3>
              <button onClick={() => setShowAdd(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-1 border-b border-slate-100 bg-slate-50 px-4 py-2">
              {([["single", "Single Asset"], ["bulk", "Bulk Add (Form)"], ["csv", "CSV Import"]] as const).map(([m, label]) => (
                <button key={m} onClick={() => setAddMode(m)}
                  className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${addMode === m ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-200"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Single ── */}
            {addMode === "single" && (
              <form onSubmit={handleAdd} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Asset Name *</label>
                    <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Smart Container SC-104"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Description / Category</label>
                    <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="e.g. Smart Container"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Unit Cost / Declared Value (₹)</label>
                    <input type="number" min={0} value={form.cost} onChange={(e) => setForm((p) => ({ ...p, cost: +e.target.value }))}
                      placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">UUID / Serial No. *</label>
                    <input required value={form.uuid} onChange={(e) => setForm((p) => ({ ...p, uuid: e.target.value }))}
                      placeholder="SC-104-XXXX"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Initial Status</label>
                    <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as Asset["status"] }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                      {["Available", "Dispatched", "In-Transit", "Maintenance"].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                    Initial Location *
                    <span className="ml-1 font-normal text-amber-600">(Master Warehouse only)</span>
                  </label>
                  {masterWarehouses.length === 0 ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      No Master Warehouse configured — go to Locations and designate one first.
                    </div>
                  ) : (
                    <select required value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none focus:border-amber-500">
                      <option value="">Select Master Warehouse…</option>
                      {masterWarehouses.map((l) => (
                        <option key={l.id} value={l.name}>⭐ {l.name}</option>
                      ))}
                    </select>
                  )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Assign to Project</label>
                    <select value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                      <option value="">— No Project —</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.client})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Health Score (0–100)</label>
                    <input type="number" min={0} max={100} value={form.healthScore}
                      onChange={(e) => setForm((p) => ({ ...p, healthScore: +e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">RFID Tag ID</label>
                    <div className="flex gap-2">
                      <input
                        id="rfid-tag-input"
                        value={form.rfidTag}
                        onChange={(e) => setForm((p) => ({ ...p, rfidTag: e.target.value }))}
                        placeholder={rfidReading ? "Scanning…" : "Optional — type or use reader"}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm font-mono outline-none transition-colors ${rfidReading ? "border-emerald-400 bg-emerald-50 animate-pulse" : "border-slate-300 focus:border-slate-500"}`}
                      />
                      <button
                        type="button"
                        onClick={() => readTag("rfid")}
                        disabled={rfidReading}
                        title="Read from RFID reader"
                        className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {rfidReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                        Read
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">BLE Tag ID</label>
                    <div className="flex gap-2">
                      <input
                        id="ble-tag-input"
                        value={form.bleTag}
                        onChange={(e) => setForm((p) => ({ ...p, bleTag: e.target.value }))}
                        placeholder={bleReading ? "Scanning…" : "Optional — type or use reader"}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm font-mono outline-none transition-colors ${bleReading ? "border-blue-400 bg-blue-50 animate-pulse" : "border-slate-300 focus:border-slate-500"}`}
                      />
                      <button
                        type="button"
                        onClick={() => readTag("ble")}
                        disabled={bleReading}
                        title="Read from BLE reader"
                        className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {bleReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                        Read
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Kit Items ── */}
                <div className="border-t border-slate-100 pt-4">
                  <label className="flex items-center gap-3 cursor-pointer mb-3">
                    <span className="text-xs font-semibold text-slate-700">Does this asset have a Kit?</span>
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => setHasKit(false)}
                        className={`px-3 py-1.5 transition-colors ${!hasKit ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                      >No</button>
                      <button
                        type="button"
                        onClick={() => setHasKit(true)}
                        className={`px-3 py-1.5 transition-colors ${hasKit ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                      >Yes</button>
                    </div>
                  </label>

                  {hasKit && (
                    <div className="space-y-2">
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                              <th className="border-b border-slate-200 px-3 py-2 text-left font-medium">Kit Description</th>
                              <th className="border-b border-slate-200 px-3 py-2 text-left font-medium w-24">Qty per Asset</th>
                              <th className="border-b border-slate-200 px-2 py-2 w-8"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {kitItems.map((kit, i) => (
                              <tr key={i}>
                                <td className="px-2 py-1.5">
                                  <input
                                    value={kit.description}
                                    onChange={(e) => setKitItems((k) => k.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                                    placeholder="e.g. Mounting Bracket"
                                    className="w-full rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="number" min={1} value={kit.qty}
                                    onChange={(e) => setKitItems((k) => k.map((x, idx) => idx === i ? { ...x, qty: Math.max(1, +e.target.value) } : x))}
                                    className="w-full rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent"
                                  />
                                </td>
                                <td className="px-1 py-1">
                                  {kitItems.length > 1 && (
                                    <button type="button" onClick={() => setKitItems((k) => k.filter((_, idx) => idx !== i))}
                                      className="text-red-400 hover:text-red-600">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKitItems((k) => [...k, { description: "", qty: 1 }])}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:bg-slate-50"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Kit Item
                      </button>
                    </div>
                  )}
                </div>

                {form.projectId && <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">Linking to: <strong>{pm[form.projectId] ?? form.projectId}</strong></div>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowAdd(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
                  <button type="submit" disabled={saving}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add Asset
                  </button>
                </div>
              </form>
            )}

            {/* ── Bulk Form ── */}
            {addMode === "bulk" && (
              <div className="space-y-0">
                {/* Option picker */}
                <div className="flex gap-1 border-b border-slate-100 bg-slate-50 px-4 py-2">
                  <button onClick={() => { setBulkSubMode("table"); setSerialPreview([]); }}
                    className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${bulkSubMode === "table" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-200"}`}>
                    Option A — Row by Row
                  </button>
                  <button onClick={() => { setBulkSubMode("serial"); setSerialPreview([]); }}
                    className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${bulkSubMode === "serial" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-200"}`}>
                    Option B — Serial / Auto-sequence
                  </button>
                </div>

                {/* ── Option A: Row-by-row table ── */}
                {bulkSubMode === "table" && (
                  <div className="p-5 space-y-4">
                    <p className="text-xs text-slate-500">Fill in each row. Rows with empty Name, UUID, or Location are skipped automatically.</p>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                            {["#","Name *","UUID *","Description","Location *","Status","Health","Cost (₹)","Project"].map((h) => (
                              <th key={h} className="border-b border-slate-200 px-2 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {bulkRows.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="px-2 py-1.5 text-slate-400 text-center font-mono">{i + 1}</td>
                              <td className="px-1 py-1">
                                <input value={row.name} onChange={(e) => updateRow(i, "name", e.target.value)}
                                  placeholder="Asset name" className="w-full min-w-36 rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                              </td>
                              <td className="px-1 py-1">
                                <input value={row.uuid} onChange={(e) => updateRow(i, "uuid", e.target.value)}
                                  placeholder="UUID" className="w-full min-w-28 rounded px-2 py-1 text-xs font-mono outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                              </td>
                              <td className="px-1 py-1">
                                <input value={row.description} onChange={(e) => updateRow(i, "description", e.target.value)}
                                  placeholder="Category" className="w-full min-w-24 rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                              </td>
                              <td className="px-1 py-1">
                                <input list="bulk-loc-a" value={row.location} onChange={(e) => updateRow(i, "location", e.target.value)}
                                  placeholder="Location" className="w-full min-w-28 rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                                <datalist id="bulk-loc-a">{locations.map((l) => <option key={l.id} value={l.name} />)}</datalist>
                              </td>
                              <td className="px-1 py-1">
                                <select value={row.status} onChange={(e) => updateRow(i, "status", e.target.value as Asset["status"])}
                                  className="rounded px-1 py-1 text-xs outline-none bg-transparent">
                                  {["Available","Dispatched","In-Transit","Maintenance"].map((s) => <option key={s}>{s}</option>)}
                                </select>
                              </td>
                              <td className="px-1 py-1">
                                <input type="number" min={0} max={100} value={row.healthScore} onChange={(e) => updateRow(i, "healthScore", +e.target.value)}
                                  className="w-14 rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                              </td>
                              <td className="px-1 py-1">
                                <input type="number" min={0} value={row.cost} onChange={(e) => updateRow(i, "cost", +e.target.value)}
                                  className="w-20 rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                              </td>
                              <td className="px-1 py-1">
                                <select value={row.projectId} onChange={(e) => updateRow(i, "projectId", e.target.value)}
                                  className="rounded px-1 py-1 text-xs outline-none bg-transparent">
                                  <option value="">—</option>
                                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setBulkRows((r) => [...r, EMPTY_ROW()])}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        <Plus className="h-3.5 w-3.5" /> Add Row
                      </button>
                      {bulkRows.length > 1 && (
                        <button onClick={() => setBulkRows((r) => r.slice(0, -1))}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-50">
                          Remove Last
                        </button>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => setShowAdd(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
                      <button onClick={handleBulkAdd} disabled={bulkSaving}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                        {bulkSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Add {bulkRows.filter((r) => r.name && r.uuid && r.location).length} Assets
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Option B: Serial / Auto-sequence ── */}
                {bulkSubMode === "serial" && (
                  <div className="p-5 space-y-5">
                    {/* Explanation */}
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                      <p className="text-xs font-semibold text-blue-800 mb-1">How serial generation works</p>
                      <p className="text-xs text-blue-700">
                        Enter the <strong>first asset</strong>'s details and the <strong>total count</strong> you want to add.
                        The app will auto-increment the last number in the UUID for each subsequent asset.
                      </p>
                      <p className="text-xs text-blue-500 mt-1 font-mono">
                        e.g. SC-100-<strong>001</strong>, count 5 → SC-100-001 … SC-100-005
                      </p>
                    </div>

                    {/* First asset seed form */}
                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">First Asset Details</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs font-medium text-slate-600">Asset Name *</label>
                          <input value={serialSeed.name}
                            onChange={(e) => { setSerialSeed((p) => ({ ...p, name: e.target.value })); setSerialPreview([]); }}
                            placeholder="e.g. Smart Container SC-100"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">UUID (first in series) *</label>
                          <input value={serialSeed.uuid}
                            onChange={(e) => { setSerialSeed((p) => ({ ...p, uuid: e.target.value })); setSerialPreview([]); }}
                            placeholder="e.g. SC-100-001"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-500" />
                          {serialSeed.uuid && (
                            <p className="mt-1 text-[10px] text-slate-400">
                              Next: <span className="font-mono text-slate-600">{incrementUUID(serialSeed.uuid, 1)}</span>,{" "}
                              <span className="font-mono text-slate-600">{incrementUUID(serialSeed.uuid, 2)}</span>, …
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600 flex items-center gap-2">
                            Total Asset Count *
                            <span className="text-slate-400 font-normal">(max 500)</span>
                          </label>
                          <input type="number" min={1} max={500} value={serialCount}
                            onChange={(e) => { setSerialCount(Math.min(500, Math.max(1, +e.target.value))); setSerialPreview([]); }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-500" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Initial Location *
                            <span className="ml-1 font-normal text-amber-600">(Master WH)</span>
                          </label>
                          {masterWarehouses.length === 0 ? (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">No Master Warehouse set</div>
                          ) : (
                            <select required value={serialSeed.location}
                              onChange={(e) => { setSerialSeed((p) => ({ ...p, location: e.target.value })); setSerialPreview([]); }}
                              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none focus:border-amber-500">
                              <option value="">Select Master Warehouse…</option>
                              {masterWarehouses.map((l) => <option key={l.id} value={l.name}>⭐ {l.name}</option>)}
                            </select>
                          )}
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                          <select value={serialSeed.status} onChange={(e) => { setSerialSeed((p) => ({ ...p, status: e.target.value as Asset["status"] })); setSerialPreview([]); }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                            {["Available", "Dispatched", "In-Transit", "Maintenance"].map((s) => <option key={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Health Score</label>
                          <input type="number" min={0} max={100} value={serialSeed.healthScore}
                            onChange={(e) => { setSerialSeed((p) => ({ ...p, healthScore: +e.target.value })); setSerialPreview([]); }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Project</label>
                          <select value={serialSeed.projectId} onChange={(e) => { setSerialSeed((p) => ({ ...p, projectId: e.target.value })); setSerialPreview([]); }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                            <option value="">No Project</option>
                            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={serialSeed.autoIncrementName}
                              onChange={(e) => { setSerialSeed((p) => ({ ...p, autoIncrementName: e.target.checked })); setSerialPreview([]); }}
                              className="rounded" />
                            <span className="text-xs text-slate-600">
                              Also auto-increment asset name{" "}
                              {serialSeed.autoIncrementName && serialSeed.name && (
                                <span className="font-mono text-slate-400">
                                  ({serialSeed.name} → {incrementName(serialSeed.name, 1)}, {incrementName(serialSeed.name, 2)}…)
                                </span>
                              )}
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Preview */}
                    {serialPreview.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-slate-700">{serialPreview.length} assets ready to save</p>
                          <button onClick={() => setSerialPreview([])} className="text-xs text-slate-400 hover:text-slate-600 underline">Clear</button>
                        </div>
                        <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
                          {serialPreview.map((row, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2">
                              <div>
                                <p className="text-xs font-medium text-slate-700">{row.name}</p>
                                <p className="font-mono text-[10px] text-slate-400">{row.uuid}</p>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                <span>{row.location}</span>
                                <span className={`rounded-full px-1.5 py-0.5 font-medium ${
                                  row.status === "Available" ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600"
                                }`}>{row.status}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => setShowAdd(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
                      {serialPreview.length === 0 ? (
                        <button onClick={handleSerialPreview}
                          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-700 py-2 text-sm font-medium text-white">
                          Preview {serialCount} Assets →
                        </button>
                      ) : (
                        <button onClick={handleSerialSave} disabled={serialSaving}
                          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                          {serialSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Save {serialPreview.length} Assets
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── CSV Import ── */}
            {addMode === "csv" && (
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">CSV Import</p>
                    <p className="text-xs text-slate-400 mt-0.5">Paste CSV data below or download the template first</p>
                  </div>
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    <Download className="h-3.5 w-3.5" /> Template
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-mono text-slate-500">
                  name,uuid,status,location,healthScore,projectId
                </div>

                <textarea
                  rows={8}
                  value={csvText}
                  onChange={(e) => { setCsvText(e.target.value); setCsvParsed([]); }}
                  placeholder={"name,uuid,status,location,healthScore,projectId\nSmart Container SC-110,SC-110-XXXX,Available,Warehouse A,90,"}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono outline-none focus:border-slate-500"
                />

                {csvParsed.length > 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <p className="text-xs font-semibold text-emerald-800">{csvParsed.length} valid assets ready to import:</p>
                    <ul className="mt-1 space-y-0.5">
                      {csvParsed.slice(0, 5).map((r, i) => (
                        <li key={i} className="text-xs text-emerald-700">• {r.name} <span className="font-mono text-emerald-500">({r.uuid})</span> — {r.location}</li>
                      ))}
                      {csvParsed.length > 5 && <li className="text-xs text-emerald-500">…and {csvParsed.length - 5} more</li>}
                    </ul>
                  </div>
                )}

                <div className="flex gap-3">
                  {csvParsed.length === 0 ? (
                    <>
                      <button onClick={() => setShowAdd(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
                      <button onClick={parseCSV} disabled={!csvText.trim()}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-700 py-2 text-sm font-medium text-white disabled:opacity-50">
                        <FileSpreadsheet className="h-4 w-4" /> Parse CSV
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setCsvParsed([])} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Re-parse</button>
                      <button onClick={handleCSVImport} disabled={csvSaving}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                        {csvSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Import {csvParsed.length} Assets
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {checkoutAsset && (
        <CheckInOutDialog asset={checkoutAsset} locations={allowedLocations} initialMode={checkoutMode} onClose={() => { setCheckoutAsset(null); load(); }} />
      )}
      {showBulkTx && (
        <BulkCheckInOutDialog assetIds={selected} locations={allowedLocations} onClose={() => { setShowBulkTx(false); setSelected([]); load(); }} />
      )}

      {/* ── Retire Asset Dialog ── */}
      {retireAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setRetireAsset(null)}>
          <div className="w-[420px] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-red-600 px-5 py-4">
              <div className="flex items-center gap-2 text-white">
                <Archive className="h-5 w-5" />
                <span className="font-semibold text-base">Retire Asset</span>
              </div>
              <button onClick={() => setRetireAsset(null)} className="text-white/80 hover:text-white">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-600">
                Retiring <span className="font-semibold text-slate-800">{retireAsset.name}</span> ({retireAsset.uuid}). This action marks the asset as permanently out of service.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Retirement Reason</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["Damaged", "End of Life", "Lost", "Other"] as const).map((cat) => (
                    <button key={cat}
                      onClick={() => setRetireCategory(cat)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        retireCategory === cat
                          ? "border-red-500 bg-red-50 text-red-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                <textarea
                  rows={3}
                  value={retireReason}
                  onChange={(e) => setRetireReason(e.target.value)}
                  placeholder="Describe the condition or reason for retirement…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-red-400 focus:outline-none resize-none"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setRetireAsset(null)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleRetire} disabled={retireSaving}
                  className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  {retireSaving ? "Retiring…" : "Confirm Retire"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ── */}
      {qrAsset && qrDataUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setQrAsset(null)}>
          <div className="w-72 rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between bg-indigo-600 px-4 py-3">
              <div>
                <p className="text-xs font-bold text-white">{qrAsset.name}</p>
                <p className="text-[10px] text-slate-400 font-mono">{qrAsset.uuid}</p>
              </div>
              <button onClick={() => setQrAsset(null)}><X className="h-4 w-4 text-slate-400 hover:text-white" /></button>
            </div>
            {/* QR image */}
            <div className="flex flex-col items-center gap-3 p-5">
              <img src={qrDataUrl} alt={`QR for ${qrAsset.uuid}`}
                className="h-52 w-52 rounded-lg border border-slate-200" />
              <p className="text-center text-xs font-mono font-bold text-slate-700 tracking-wider">{qrAsset.uuid}</p>
              <p className="text-center text-[10px] text-slate-400">Scan to identify this asset</p>
            </div>
            {/* Actions */}
            <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
              <a href={qrDataUrl} download={`QR-${qrAsset.uuid}.png`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                <Download className="h-3.5 w-3.5" /> Download PNG
              </a>
              <button onClick={() => setQrAsset(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
