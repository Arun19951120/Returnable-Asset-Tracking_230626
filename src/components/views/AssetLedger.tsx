"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import { Asset, Location, Project } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Search, Plus, Download, QrCode, X, Loader2,
  Upload, FileSpreadsheet,
  Wifi, Trash2, MoreHorizontal, LogOut, LogIn, ArrowRightLeft, Archive,
  ChevronDown, ChevronRight, Layers, List, Columns3, Clock, RotateCcw,
  ChevronUp, ChevronsUpDown, Info, Tag,
} from "lucide-react";
import { AssetMovement } from "@/lib/types";
import { KitItem } from "@/lib/types";
import CheckInOutDialog from "@/components/dialogs/CheckInOutDialog";
import BulkCheckInOutDialog from "@/components/dialogs/BulkCheckInOutDialog";
import AssetDetailDialog from "@/components/dialogs/AssetDetailDialog";
import BulkQRDialog from "@/components/dialogs/BulkQRDialog";
import { buildQRDataUrl } from "@/lib/qr";
import { generateAssetLabels } from "@/lib/label";
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
    Available:      "bg-emerald-100 text-emerald-700",
    Dispatched:     "bg-blue-100 text-blue-700",
    "In-Transit":   "bg-amber-100 text-amber-700",
    Maintenance:    "bg-orange-100 text-orange-700",
    Retired:        "bg-slate-200 text-slate-500",
    "Under Repair": "bg-yellow-100 text-yellow-700",
    Damaged:        "bg-red-100 text-red-700",
    Lost:           "bg-rose-100 text-rose-800",
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

const EMPTY = { name: "", uuid: "", description: "", status: "Available" as Asset["status"], location: "", healthScore: 90, cost: 0, projectId: "", rfidTag: "", bleTag: "" };

// Sortable inventory columns
type SortKey = "name" | "uuid" | "project" | "description" | "status" | "location" | "cycleDays" | "cycleCount" | "health" | "tags" | "updated";

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

// ── Reusable Kit editor ───────────────────────────────────────────────────────
// Shared by the single-asset form and both bulk modes so kitting looks and
// behaves identically everywhere.
function KitEditor({
  hasKit, setHasKit, items, setItems, prompt, qtyLabel,
}: {
  hasKit: boolean;
  setHasKit: (v: boolean) => void;
  items: KitItem[];
  setItems: React.Dispatch<React.SetStateAction<KitItem[]>>;
  prompt: string;
  qtyLabel: string;
}) {
  return (
    <div className="border-t border-slate-100 pt-4">
      <label className="flex items-center gap-3 cursor-pointer mb-3">
        <span className="text-xs font-semibold text-slate-700">{prompt}</span>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
          <button type="button" onClick={() => setHasKit(false)}
            className={`px-3 py-1.5 transition-colors ${!hasKit ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>No</button>
          <button type="button" onClick={() => setHasKit(true)}
            className={`px-3 py-1.5 transition-colors ${hasKit ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>Yes</button>
        </div>
      </label>

      {hasKit && (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                  <th className="border-b border-slate-200 px-3 py-2 text-left font-medium">Kit Description</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left font-medium w-24">{qtyLabel}</th>
                  <th className="border-b border-slate-200 px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((kit, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">
                      <input value={kit.description}
                        onChange={(e) => setItems((k) => k.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                        placeholder="e.g. Mounting Bracket"
                        className="w-full rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min={1} value={kit.qty}
                        onChange={(e) => setItems((k) => k.map((x, idx) => idx === i ? { ...x, qty: Math.max(1, +e.target.value) } : x))}
                        className="w-full rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                    </td>
                    <td className="px-1 py-1">
                      {items.length > 1 && (
                        <button type="button" onClick={() => setItems((k) => k.filter((_, idx) => idx !== i))}
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
          <button type="button" onClick={() => setItems((k) => [...k, { description: "", qty: 1 }])}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" /> Add Kit Item
          </button>
        </div>
      )}
    </div>
  );
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
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [showBulkQR, setShowBulkQR] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [retireAsset, setRetireAsset] = useState<Asset | null>(null);
  const [retireCategory, setRetireCategory] = useState<"Damaged"|"End of Life"|"Lost"|"Other">("Damaged");
  const [retireReason, setRetireReason] = useState("");
  const [markAsset, setMarkAsset] = useState<Asset | null>(null);
  const [markStatus, setMarkStatus] = useState<"Under Repair" | "Damaged" | "Lost">("Under Repair");
  const [markNotes, setMarkNotes] = useState("");
  const [markSaving, setMarkSaving] = useState(false);
  const [retireSaving, setRetireSaving] = useState(false);
  const [showBulkTx, setShowBulkTx] = useState(false);
  // QR modal
  const [qrAsset,   setQrAsset]   = useState<Asset | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  // Add asset modal
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "grouped">("grouped");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  // Column sort — click a header to cycle asc → desc → off
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  // All available columns — persisted to localStorage
  const ALL_COLUMNS = [
    { id: "uuid",        label: "UUID" },
    { id: "project",     label: "Project" },
    { id: "description", label: "Description" },
    { id: "status",      label: "Status" },
    { id: "location",    label: "Location" },
    { id: "cycleDays",   label: "Cycle Days" },
    { id: "cycleCount",  label: "Cycle Count" },
    { id: "health",      label: "Health Score" },
    { id: "tags",        label: "RFID / BLE Tags" },
    { id: "updated",     label: "Last Updated" },
  ] as const;
  type ColId = typeof ALL_COLUMNS[number]["id"];

  const DEFAULT_COLS: ColId[] = ["uuid", "project", "status", "location", "cycleDays", "cycleCount", "health", "tags", "updated"];

  const [visibleCols, setVisibleCols] = useState<ColId[]>(() => {
    try {
      const saved = localStorage.getItem("asset_ledger_cols_v1");
      if (saved) return JSON.parse(saved) as ColId[];
    } catch {}
    return DEFAULT_COLS;
  });

  function toggleCol(id: ColId) {
    setVisibleCols((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      localStorage.setItem("asset_ledger_cols_v1", JSON.stringify(next));
      return next;
    });
  }

  function col(id: ColId) { return visibleCols.includes(id); }

  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"single" | "bulk" | "csv">("single");
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  // RFID / BLE reader state
  const [rfidReading, setRfidReading] = useState(false);
  const [bleReading, setBleReading] = useState(false);

  // Kit items — single-asset form
  const [hasKit, setHasKit] = useState(false);
  const [kitItems, setKitItems] = useState<KitItem[]>([{ description: "", qty: 1 }]);

  // Kit items — bulk (one shared kit applied to every asset in the batch)
  const [bulkHasKit, setBulkHasKit] = useState(false);
  const [bulkKitItems, setBulkKitItems] = useState<KitItem[]>([{ description: "", qty: 1 }]);
  const bulkKit = () => bulkHasKit ? bulkKitItems.filter((k) => k.description.trim()) : [];

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
    const [a, l, p, m] = await Promise.all([
      fetchAll<Asset>("assets"),
      fetchAll<Location>("locations"),
      fetchAll<Project>("projects"),
      fetchAll<AssetMovement>("movements"),
    ]);
    setAssets(a);
    setLocations(l);
    setProjects(p.filter((p) => p.status === "Active"));
    setMovements(m);
  }, []);

  // Master warehouses — the only valid initial registration points
  const masterWarehouses = locations.filter((l) => l.isMasterWarehouse && l.status === "Active");

  useEffect(() => { load(); }, [load]);

  const pm = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  // Master warehouse names set for cycle-day calculation
  const masterWhNames = new Set(locations.filter((l) => l.isMasterWarehouse).map((l) => l.name));

  // cycleDaysMap: assetId → days since last dispatch from master warehouse (null if not dispatched)
  const cycleDaysMap: Record<string, number | null> = {};
  for (const asset of assets) {
    const dispatches = movements
      .filter((m) => m.assetId === asset.id && m.movementType === "Checkout" && masterWhNames.has(m.fromLocation))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (dispatches.length > 0) {
      const days = Math.floor((Date.now() - new Date(dispatches[0].createdAt).getTime()) / 86_400_000);
      cycleDaysMap[asset.id] = days;
    } else {
      cycleDaysMap[asset.id] = null;
    }
  }

  // ── Column sorting ───────────────────────────────────────────────────────────
  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev && prev.key === key
        ? prev.dir === "asc" ? { key, dir: "desc" } : null   // asc → desc → off
        : { key, dir: "asc" }
    );
  }
  function sortValue(a: Asset, key: SortKey): string | number {
    switch (key) {
      case "cycleDays":  return cycleDaysMap[a.id] ?? -1;
      case "cycleCount": return a.cycleCount ?? 0;
      case "health":     return a.healthScore ?? 0;
      case "updated":    return new Date(a.lastUpdated).getTime();
      case "project":    return (pm[a.projectId ?? ""] ?? "").toLowerCase();
      case "tags":       return `${a.rfidTag ?? ""}${a.bleTag ?? ""}`.toLowerCase();
      case "name":       return (a.name ?? "").toLowerCase();
      case "uuid":       return (a.uuid ?? "").toLowerCase();
      case "description":return (a.description ?? "").toLowerCase();
      case "status":     return a.status ?? "";
      case "location":   return (a.location ?? "").toLowerCase();
    }
  }
  function sortAssets(list: Asset[]): Asset[] {
    if (!sort) return list;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }
  // Clickable sortable column header
  function sortTh(label: string, key: SortKey, className: string) {
    const active = sort?.key === key;
    return (
      <th className={className}>
        <button type="button" onClick={() => toggleSort(key)}
          className="inline-flex items-center gap-1 uppercase hover:text-slate-700 transition-colors">
          {label}
          {active
            ? (sort!.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
            : <ChevronsUpDown className="h-3 w-3 text-slate-300" />}
        </button>
      </th>
    );
  }

  const filtered = sortAssets(filterByDays(assets, dayRange, "lastUpdated").filter((a) => {
    const s = search.toLowerCase();
    return (!s || a.name.toLowerCase().includes(s) || a.uuid.toLowerCase().includes(s) || a.location.toLowerCase().includes(s))
      && (statusFilter === "All" || a.status === statusFilter)
      && (!locationFilter || a.location === locationFilter)
      && (!projectFilter || a.projectId === projectFilter);
  }));

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
    if (!form.projectId) { toast.error("Please assign a project"); return; }
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
    if (valid.some((r) => !r.projectId)) { toast.error("Assign a project to every row"); return; }
    setBulkSaving(true);
    try {
      const kit = bulkKit();
      await Promise.all(valid.map((row) => addDocument("assets", {
        ...row,
        kitItems: kit.length ? kit : undefined,
        lastUpdated: new Date().toISOString(),
      })));
      await logAudit({ userId: profile?.uid ?? "", userEmail: profile?.email ?? "", action: `Bulk add: ${valid.length} assets`, category: "Asset", details: valid.map((r) => r.uuid).join(", ") });
      toast.success(`${valid.length} assets added`);
      setBulkRows([EMPTY_ROW()]); setBulkHasKit(false); setBulkKitItems([{ description: "", qty: 1 }]); load();
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
      const kit = bulkKit();
      await Promise.all(
        serialPreview.map((row) => addDocument("assets", {
          ...row,
          kitItems: kit.length ? kit : undefined,
          lastUpdated: new Date().toISOString(),
        }))
      );
      await logAudit({
        userId: profile?.uid ?? "", userEmail: profile?.email ?? "",
        action: `Serial bulk add: ${serialPreview.length} assets starting ${serialPreview[0].uuid}`,
        category: "Asset",
        details: `UUIDs: ${serialPreview[0].uuid} … ${serialPreview[serialPreview.length - 1].uuid}`,
      });
      toast.success(`${serialPreview.length} assets added with serial UUIDs`);
      setSerialPreview([]); setSerialSeed({ ...EMPTY_ROW(), autoIncrementName: true }); setSerialCount(5);
      setBulkHasKit(false); setBulkKitItems([{ description: "", qty: 1 }]); load();
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

  async function handleMarkCondition() {
    if (!markAsset) return;
    setMarkSaving(true);
    try {
      await updateDocument("assets", markAsset.id, {
        status: markStatus,
        conditionNotes: markNotes,
        conditionUpdatedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });
      await logAudit({
        userId: profile?.uid ?? "",
        userEmail: profile?.email ?? "",
        action: `Asset marked as ${markStatus}: ${markAsset.name}`,
        category: "Asset",
        details: markNotes || markAsset.id,
      });
      setMarkAsset(null);
      setMarkNotes("");
      load();
    } finally {
      setMarkSaving(false);
    }
  }

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

  // ── Grouped view logic ────────────────────────────────────────────────────────
  interface AssetGroup {
    key: string;
    name: string;
    description: string;
    projectId: string;
    assets: Asset[];
    statusCounts: Partial<Record<Asset["status"], number>>;
    locations: string[];
    avgHealth: number;
  }

  const groupedData: AssetGroup[] = Object.values(
    filtered.reduce<Record<string, AssetGroup>>((acc, asset) => {
      // Group key: name + projectId (same part in same project = one group)
      const key = `${asset.name}__${asset.projectId ?? ""}`;
      if (!acc[key]) {
        acc[key] = {
          key,
          name: asset.name,
          description: asset.description ?? "",
          projectId: asset.projectId ?? "",
          assets: [],
          statusCounts: {},
          locations: [],
          avgHealth: 0,
        };
      }
      acc[key].assets.push(asset);
      acc[key].statusCounts[asset.status] = (acc[key].statusCounts[asset.status] ?? 0) + 1;
      if (!acc[key].locations.includes(asset.location)) acc[key].locations.push(asset.location);
      return acc;
    }, {})
  ).map((g) => ({
    ...g,
    avgHealth: Math.round(g.assets.reduce((s, a) => s + a.healthScore, 0) / g.assets.length),
  }));

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const STATUS_COLORS: Partial<Record<Asset["status"], string>> = {
    Available:      "bg-emerald-100 text-emerald-700",
    Dispatched:     "bg-blue-100 text-blue-700",
    "In-Transit":   "bg-amber-100 text-amber-700",
    Maintenance:    "bg-orange-100 text-orange-700",
    Retired:        "bg-slate-200 text-slate-500",
    "Under Repair": "bg-yellow-100 text-yellow-700",
    Damaged:        "bg-red-100 text-red-700",
    Lost:           "bg-rose-100 text-rose-800",
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-sm text-slate-500">{filtered.length} of {assets.length} assets</p>
        </div>
        <div className="flex gap-2">
          {/* Column picker */}
          <div className="relative">
            <button onClick={() => setShowColumnPicker((v) => !v)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${showColumnPicker ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <Columns3 className="h-4 w-4" /> Columns
            </button>
            {showColumnPicker && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowColumnPicker(false)} />
                <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-xl border border-slate-200 bg-white shadow-xl p-2">
                  <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                    <p className="text-xs font-bold text-slate-700">Show / Hide Columns</p>
                    <button onClick={() => { setVisibleCols([...DEFAULT_COLS]); localStorage.setItem("asset_ledger_cols_v1", JSON.stringify(DEFAULT_COLS)); }}
                      className="text-[10px] text-indigo-600 hover:underline font-semibold">Reset</button>
                  </div>
                  {ALL_COLUMNS.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={visibleCols.includes(id)} onChange={() => toggleCol(id)}
                        className="rounded border-slate-300 text-indigo-600" />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* View mode toggle */}
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button onClick={() => setViewMode("grouped")}
              title="Grouped view"
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${viewMode === "grouped" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              <Layers className="h-4 w-4" /> Grouped
            </button>
            <button onClick={() => setViewMode("list")}
              title="List view"
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${viewMode === "list" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              <List className="h-4 w-4" /> List
            </button>
          </div>
          <button onClick={() => exportCSV(filtered, projects)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button onClick={() => setShowBulkQR(true)}
            title="Print asset labels or QR codes for a project"
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Tag className="h-4 w-4" /> Labels / QR
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
        statusOptions={["Available", "In-Transit", "Maintenance", "Under Repair", "Damaged", "Lost", "Retired"]}
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

      {/* ── Grouped view ── */}
      {viewMode === "grouped" && (
        <div className="space-y-3">
          {groupedData.length === 0 && (
            <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-400">
              No assets match your filters
            </div>
          )}
          {groupedData.map((group) => {
            const expanded = expandedGroups.has(group.key);
            const avgColor = group.avgHealth >= 80 ? "bg-emerald-500" : group.avgHealth >= 50 ? "bg-amber-400" : "bg-red-500";
            return (
              <div key={group.key} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                {/* Group header row */}
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition-colors text-left"
                >
                  {/* Expand icon */}
                  <div className="shrink-0 text-slate-400">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>

                  {/* Name + description */}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{group.name}</p>
                    {group.description && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">{group.description}</p>
                    )}
                  </div>

                  {/* Project */}
                  <div className="hidden sm:block shrink-0 w-32">
                    {group.projectId && pm[group.projectId]
                      ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{pm[group.projectId]}</span>
                      : <span className="text-xs text-slate-300">—</span>}
                  </div>

                  {/* Status breakdown chips */}
                  <div className="hidden md:flex flex-wrap gap-1 shrink-0 max-w-xs">
                    {(Object.entries(group.statusCounts) as [Asset["status"], number][]).map(([st, cnt]) => (
                      <span key={st} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[st] ?? "bg-slate-100 text-slate-600"}`}>
                        {cnt} {st}
                      </span>
                    ))}
                  </div>

                  {/* Locations */}
                  <div className="hidden lg:block shrink-0 max-w-[160px]">
                    <p className="text-xs text-slate-500 truncate">{group.locations.join(", ")}</p>
                  </div>

                  {/* Cycle days (max in group) */}
                  {col("cycleDays") && (
                    <div className="hidden md:flex shrink-0 flex-col items-end gap-0.5">
                      {(() => {
                        const days = group.assets.map((a) => cycleDaysMap[a.id]).filter((d): d is number => d !== null);
                        if (!days.length) return <span className="text-xs text-slate-300">—</span>;
                        const max = Math.max(...days);
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${max > 30 ? "bg-red-100 text-red-700" : max > 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                            <Clock className="h-3 w-3" />{max}d
                          </span>
                        );
                      })()}
                      <p className="text-[9px] text-slate-400">max cycle</p>
                    </div>
                  )}

                  {/* Cycle count (sum in group) */}
                  {col("cycleCount") && (
                    <div className="hidden md:flex shrink-0 flex-col items-end gap-0.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                        <RotateCcw className="h-3 w-3" />
                        {group.assets.reduce((s, a) => s + (a.cycleCount ?? 0), 0)}
                      </span>
                      <p className="text-[9px] text-slate-400">total cycles</p>
                    </div>
                  )}

                  {/* Avg health */}
                  {col("health") && (
                    <div className="shrink-0 flex items-center gap-2">
                      <div className="h-1.5 w-14 rounded-full bg-slate-100">
                        <div className={`h-1.5 rounded-full ${avgColor}`} style={{ width: `${group.avgHealth}%` }} />
                      </div>
                      <span className="font-mono text-xs text-slate-500 w-6">{group.avgHealth}</span>
                    </div>
                  )}

                  {/* Count badge */}
                  <div className="shrink-0">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                      {group.assets.length}
                    </span>
                  </div>
                </button>

                {/* Expanded individual assets */}
                {expanded && (
                  <div className="border-t border-slate-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-4 py-2.5">
                            <input type="checkbox" className="rounded"
                              checked={group.assets.every((a) => selected.includes(a.id))}
                              onChange={() => {
                                const allIds = group.assets.map((a) => a.id);
                                const allSelected = allIds.every((id) => selected.includes(id));
                                setSelected((prev) => allSelected
                                  ? prev.filter((id) => !allIds.includes(id))
                                  : [...new Set([...prev, ...allIds])]);
                              }} />
                          </th>
                          {(() => { const cls = "px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400"; return <>
                            {col("uuid")        && sortTh("UUID", "uuid", cls)}
                            {col("description") && sortTh("Description", "description", cls)}
                            {col("status")      && sortTh("Status", "status", cls)}
                            {col("location")    && sortTh("Location", "location", cls)}
                            {col("cycleDays")   && sortTh("Cycle Days", "cycleDays", cls)}
                            {col("cycleCount")  && sortTh("Cycles", "cycleCount", cls)}
                            {col("health")      && sortTh("Health", "health", cls)}
                            {col("tags")        && sortTh("Tags", "tags", cls)}
                            {col("updated")     && sortTh("Updated", "updated", cls)}
                          </>; })()}
                          <th className="px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {sortAssets(group.assets).map((asset) => {
                          const cd = cycleDaysMap[asset.id];
                          return (
                          <tr key={asset.id} className="hover:bg-indigo-50/30 transition-colors">
                            <td className="px-4 py-2.5">
                              <input type="checkbox" className="rounded" checked={selected.includes(asset.id)} onChange={() => toggleSelect(asset.id)} />
                            </td>
                            {col("uuid")        && <td className="px-3 py-2.5"><button onClick={() => setDetailAsset(asset)} title="View details & history" className="font-mono text-xs text-indigo-500 hover:text-indigo-700 hover:underline">{asset.uuid}</button></td>}
                            {col("description") && <td className="px-3 py-2.5 text-xs text-slate-500">{asset.description ?? "—"}</td>}
                            {col("status")      && <td className="px-3 py-2.5"><StatusBadge status={asset.status} /></td>}
                            {col("location")    && <td className="px-3 py-2.5 text-xs text-slate-600">{asset.location}</td>}
                            {col("cycleDays")   && (
                              <td className="px-3 py-2.5">
                                {cd !== null
                                  ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cd > 30 ? "bg-red-100 text-red-700" : cd > 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                                      <Clock className="h-3 w-3" />{cd}d
                                    </span>
                                  : <span className="text-xs text-slate-300">—</span>}
                              </td>
                            )}
                            {col("cycleCount")  && (
                              <td className="px-3 py-2.5">
                                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                                  <RotateCcw className="h-3 w-3" />{asset.cycleCount ?? 0}
                                </span>
                              </td>
                            )}
                            {col("health")      && <td className="px-3 py-2.5"><HealthBar score={asset.healthScore} /></td>}
                            {col("tags")        && (
                              <td className="px-3 py-2.5">
                                <div className="flex flex-col gap-0.5">
                                  {asset.rfidTag && <span className="font-mono text-[10px] text-slate-400">RFID:{asset.rfidTag}</span>}
                                  {asset.bleTag  && <span className="font-mono text-[10px] text-blue-400">BLE:{asset.bleTag}</span>}
                                </div>
                              </td>
                            )}
                            {col("updated")     && <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{new Date(asset.lastUpdated).toLocaleDateString()}</td>}
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1">
                                <button onClick={async () => { const url = await buildQRDataUrl(asset.uuid); setQrDataUrl(url); setQrAsset(asset); }}
                                  title="QR Code" className="rounded border border-slate-200 p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                                  <QrCode className="h-3.5 w-3.5" />
                                </button>
                                <div className="relative">
                                  <button onClick={() => setMenuOpenId(menuOpenId === asset.id ? null : asset.id)}
                                    className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 transition-colors">
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </button>
                                  {menuOpenId === asset.id && (
                                    <>
                                      <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />
                                      <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                                        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Actions</p>
                                        <button onClick={() => { setDetailAsset(asset); setMenuOpenId(null); }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Info className="h-3.5 w-3.5 text-indigo-500" /> Details &amp; History</button>
                                        <button onClick={() => { setMenuOpenId(null); generateAssetLabels([asset], asset.uuid, { sheet: false }); }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Tag className="h-3.5 w-3.5 text-slate-500" /> Print Label</button>
                                        <button onClick={() => { setCheckoutMode("checkout"); setCheckoutAsset(asset); setMenuOpenId(null); }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><LogOut className="h-3.5 w-3.5 text-blue-500" /> Check Out</button>
                                        <button onClick={() => { setCheckoutMode("checkin"); setCheckoutAsset(asset); setMenuOpenId(null); }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><LogIn className="h-3.5 w-3.5 text-emerald-500" /> Check In</button>
                                        <button onClick={() => { setCheckoutMode("transfer"); setCheckoutAsset(asset); setMenuOpenId(null); }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><ArrowRightLeft className="h-3.5 w-3.5 text-violet-500" /> Transfer</button>
                                        <div className="my-1 border-t border-slate-100" />
                                        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mark Condition</p>
                                        {(["Under Repair", "Damaged", "Lost"] as const).map((st) => (
                                          <button key={st} onClick={() => { setMarkAsset(asset); setMarkStatus(st); setMenuOpenId(null); }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                                            <span className={`h-2 w-2 rounded-full ${st === "Under Repair" ? "bg-yellow-400" : st === "Damaged" ? "bg-red-400" : "bg-rose-600"}`} /> {st}
                                          </button>
                                        ))}
                                        <div className="my-1 border-t border-slate-100" />
                                        <button onClick={() => { setRetireAsset(asset); setMenuOpenId(null); }}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"><Archive className="h-3.5 w-3.5" /> Retire Asset</button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ); })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── List view (original table) ── */}
      {viewMode === "list" && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3">
                <input type="checkbox" className="rounded"
                  checked={selected.length === filtered.length && filtered.length > 0}
                  onChange={() => setSelected(selected.length === filtered.length ? [] : filtered.map((a) => a.id))} />
              </th>
              {(() => { const cls = "px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500"; return <>
                {sortTh("Asset Name", "name", cls)}
                {col("uuid")        && sortTh("UUID", "uuid", cls)}
                {col("project")     && sortTh("Project", "project", cls)}
                {col("description") && sortTh("Description", "description", cls)}
                {col("status")      && sortTh("Status", "status", cls)}
                {col("location")    && sortTh("Location", "location", cls)}
                {col("cycleDays")   && sortTh("Cycle Days", "cycleDays", cls)}
                {col("cycleCount")  && sortTh("Cycles", "cycleCount", cls)}
                {col("health")      && sortTh("Health", "health", cls)}
                {col("tags")        && sortTh("Tags", "tags", cls)}
                {col("updated")     && sortTh("Updated", "updated", cls)}
              </>; })()}
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="py-12 text-center text-slate-400">No assets match your filters</td></tr>
            )}
            {filtered.map((asset) => {
              const cd = cycleDaysMap[asset.id];
              return (
              <tr key={asset.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded" checked={selected.includes(asset.id)} onChange={() => toggleSelect(asset.id)} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap"><button onClick={() => setDetailAsset(asset)} title="View details & history" className="font-medium text-slate-800 hover:text-indigo-600 hover:underline text-left">{asset.name}</button></td>
                {col("uuid")        && <td className="px-3 py-3"><button onClick={() => setDetailAsset(asset)} className="font-mono text-xs text-indigo-500 hover:text-indigo-700 hover:underline">{asset.uuid}</button></td>}
                {col("project")     && (
                  <td className="px-3 py-3">
                    {asset.projectId && pm[asset.projectId]
                      ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 whitespace-nowrap">{pm[asset.projectId]}</span>
                      : <span className="text-xs text-slate-300">—</span>}
                  </td>
                )}
                {col("description") && <td className="px-3 py-3 text-xs text-slate-500">{asset.description ?? "—"}</td>}
                {col("status")      && <td className="px-3 py-3"><StatusBadge status={asset.status} /></td>}
                {col("location")    && <td className="px-3 py-3 text-slate-600 text-xs whitespace-nowrap">{asset.location}</td>}
                {col("cycleDays")   && (
                  <td className="px-3 py-3">
                    {cd !== null
                      ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cd > 30 ? "bg-red-100 text-red-700" : cd > 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                          <Clock className="h-3 w-3" />{cd}d
                        </span>
                      : <span className="text-xs text-slate-300">—</span>}
                  </td>
                )}
                {col("cycleCount")  && (
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                      <RotateCcw className="h-3 w-3" />{asset.cycleCount ?? 0}
                    </span>
                  </td>
                )}
                {col("health")      && <td className="px-3 py-3"><HealthBar score={asset.healthScore} /></td>}
                {col("tags")        && (
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      {asset.rfidTag && <span className="font-mono text-[10px] text-slate-400">RFID:{asset.rfidTag}</span>}
                      {asset.bleTag && <span className="font-mono text-[10px] text-blue-400">BLE:{asset.bleTag}</span>}
                    </div>
                  </td>
                )}
                {col("updated")     && <td className="px-3 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{new Date(asset.lastUpdated).toLocaleDateString()}</td>}
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
                            <button onClick={() => { setMenuOpenId(null); setDetailAsset(asset); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Info className="h-3.5 w-3.5 text-indigo-500" /> Details &amp; History</button>
                            <button onClick={() => { setMenuOpenId(null); generateAssetLabels([asset], asset.uuid, { sheet: false }); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Tag className="h-3.5 w-3.5 text-slate-500" /> Print Label</button>
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
                            {!["Retired","Lost"].includes(asset.status) && (
                              <>
                                <div className="my-1 border-t border-slate-100" />
                                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mark Condition</p>
                                {([
                                  { s: "Under Repair" as const, label: "Under Repair", color: "text-yellow-600", bg: "hover:bg-yellow-50" },
                                  { s: "Damaged"      as const, label: "Damaged",      color: "text-red-600",    bg: "hover:bg-red-50" },
                                  { s: "Lost"         as const, label: "Lost",          color: "text-rose-700",   bg: "hover:bg-rose-50" },
                                ]).map(({ s, label, color, bg }) => (
                                  <button key={s}
                                    onClick={() => { setMenuOpenId(null); setMarkStatus(s); setMarkNotes(""); setMarkAsset(asset); }}
                                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 ${bg} transition-colors`}>
                                    <span className={`h-2.5 w-2.5 rounded-full ${s === "Under Repair" ? "bg-yellow-400" : s === "Damaged" ? "bg-red-500" : "bg-rose-600"}`} />
                                    <span className={color}>{label}</span>
                                  </button>
                                ))}
                              </>
                            )}
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
            ); })}
          </tbody>
        </table>
      </div>}

      {/* ── Add Asset Modal ─────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h3 className="font-semibold text-slate-900">Add Asset</h3>
              <button onClick={() => setShowAdd(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>

            {/* Mode tabs */}
            <div className="flex shrink-0 gap-1 border-b border-slate-100 bg-slate-50 px-4 py-2">
              {([["single", "Single Asset"], ["bulk", "Bulk Add (Form)"], ["csv", "CSV Import"]] as const).map(([m, label]) => (
                <button key={m} onClick={() => setAddMode(m)}
                  className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${addMode === m ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-200"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">

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
                      {["Available", "In-Transit", "Maintenance", "Under Repair", "Damaged", "Lost"].map((s) => <option key={s}>{s}</option>)}
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
                    <label className="mb-1 block text-xs font-medium text-slate-600">Assign to Project *</label>
                    <select required value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                      <option value="">— Select a project —</option>
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
                <KitEditor hasKit={hasKit} setHasKit={setHasKit} items={kitItems} setItems={setKitItems}
                  prompt="Does this asset have a Kit?" qtyLabel="Qty per Asset" />

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
                                  {["Available","In-Transit","Maintenance","Under Repair","Damaged","Lost"].map((s) => <option key={s}>{s}</option>)}
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
                    <KitEditor hasKit={bulkHasKit} setHasKit={setBulkHasKit} items={bulkKitItems} setItems={setBulkKitItems}
                      prompt="Add a Kit to every asset above?" qtyLabel="Qty per Asset" />
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
                            {["Available", "In-Transit", "Maintenance", "Under Repair", "Damaged", "Lost"].map((s) => <option key={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Health Score</label>
                          <input type="number" min={0} max={100} value={serialSeed.healthScore}
                            onChange={(e) => { setSerialSeed((p) => ({ ...p, healthScore: +e.target.value })); setSerialPreview([]); }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Unit Cost / Declared Value (₹)</label>
                          <input type="number" min={0} value={serialSeed.cost}
                            onChange={(e) => { setSerialSeed((p) => ({ ...p, cost: +e.target.value })); setSerialPreview([]); }}
                            placeholder="0"
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

                    <KitEditor hasKit={bulkHasKit} setHasKit={setBulkHasKit} items={bulkKitItems} setItems={setBulkKitItems}
                      prompt="Add a Kit to every generated asset?" qtyLabel="Qty per Asset" />

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
        </div>
      )}

      {checkoutAsset && (
        <CheckInOutDialog asset={checkoutAsset} locations={allowedLocations} initialMode={checkoutMode} onClose={() => { setCheckoutAsset(null); load(); }} />
      )}
      {showBulkTx && (
        <BulkCheckInOutDialog assetIds={selected} locations={allowedLocations} onClose={() => { setShowBulkTx(false); setSelected([]); load(); }} />
      )}
      {detailAsset && (
        <AssetDetailDialog asset={detailAsset} locations={locations} projects={projects}
          onClose={() => setDetailAsset(null)} onSaved={load} />
      )}
      {showBulkQR && (
        <BulkQRDialog assets={assets} projects={projects} initialProjectId={projectFilter}
          onClose={() => setShowBulkQR(false)} />
      )}

      {/* ── Retire Asset Dialog ── */}
      {retireAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setRetireAsset(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
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

      {/* ── Mark As Condition Dialog ── */}
      {markAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setMarkAsset(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className={`flex items-center justify-between px-5 py-4 text-white ${markStatus === "Under Repair" ? "bg-yellow-500" : markStatus === "Damaged" ? "bg-red-600" : "bg-rose-700"}`}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Mark Asset Condition</p>
                <span className="font-semibold text-base">Mark as {markStatus}</span>
              </div>
              <button onClick={() => setMarkAsset(null)} className="text-white/80 hover:text-white">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-600">
                Asset: <span className="font-semibold text-slate-800">{markAsset.name}</span>
                <span className="ml-2 font-mono text-xs text-slate-400">({markAsset.uuid})</span>
              </p>

              {/* Status selector */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Condition</label>
                <div className="flex gap-2">
                  {(["Under Repair","Damaged","Lost"] as const).map((s) => (
                    <button key={s} onClick={() => setMarkStatus(s)}
                      className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition-all ${
                        markStatus === s
                          ? s === "Under Repair" ? "border-yellow-400 bg-yellow-50 text-yellow-700"
                            : s === "Damaged"    ? "border-red-400 bg-red-50 text-red-700"
                            : "border-rose-500 bg-rose-50 text-rose-800"
                          : "border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Notes / Reason <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea
                  rows={3}
                  value={markNotes}
                  onChange={(e) => setMarkNotes(e.target.value)}
                  placeholder={markStatus === "Under Repair" ? "e.g. Sent to workshop for welding repair" : markStatus === "Damaged" ? "e.g. Dropped during transit, dented frame" : "e.g. Not found after site audit on 2026-06-26"}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setMarkAsset(null)}
                  className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleMarkCondition} disabled={markSaving}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                    markStatus === "Under Repair" ? "bg-yellow-500 hover:bg-yellow-600"
                    : markStatus === "Damaged"    ? "bg-red-600 hover:bg-red-700"
                    : "bg-rose-700 hover:bg-rose-800"
                  }`}>
                  {markSaving ? "Saving…" : `Mark as ${markStatus}`}
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
