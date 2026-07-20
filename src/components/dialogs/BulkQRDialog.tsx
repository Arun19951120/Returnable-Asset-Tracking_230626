"use client";

import { useMemo, useState } from "react";
import { Asset, Project } from "@/lib/types";
import { generateQRSheet } from "@/lib/qr";
import { generateAssetLabels, LABEL_W, LABEL_H } from "@/lib/label";
import { X, Loader2, QrCode, Download, FolderKanban, Tag, Search, Check } from "lucide-react";

interface Props {
  assets: Asset[];
  projects: Project[];
  /** Pre-select this project (e.g. the ledger's active project filter) */
  initialProjectId?: string;
  onClose: () => void;
}

const ALL = "__all__";
type Output = "labels" | "qr";
/** Print every asset in a project, or just one hand-picked asset. */
type Scope = "project" | "single";

export default function BulkQRDialog({ assets, projects, initialProjectId, onClose }: Props) {
  const [output, setOutput] = useState<Output>("labels");
  const [scope, setScope] = useState<Scope>("project");
  const [sheet, setSheet] = useState(true);   // labels: A4 sheet vs one-per-page
  const [projectId, setProjectId] = useState(initialProjectId || ALL);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const pm = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  const live = useMemo(() => assets.filter((a) => a.status !== "Retired"), [assets]);

  // Search results for the single-asset picker (capped — the list can be huge)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? live.filter((a) =>
          a.uuid.toLowerCase().includes(q) ||
          (a.name ?? "").toLowerCase().includes(q))
      : live;
    return pool.slice(0, 50);
  }, [live, query]);

  const picked = useMemo(() => live.find((a) => a.id === pickedId) ?? null, [live, pickedId]);

  // Assets in the chosen project (retired excluded — no point labelling those)
  const scoped = useMemo(() => {
    if (scope === "single") return picked ? [picked] : [];
    if (projectId === ALL) return live;
    if (projectId === "") return live.filter((a) => !a.projectId);
    return live.filter((a) => a.projectId === projectId);
  }, [live, projectId, scope, picked]);

  // Per-project counts for the picker
  const counts = useMemo(() => {
    const live = assets.filter((a) => a.status !== "Retired");
    const m: Record<string, number> = { [ALL]: live.length, "": live.filter((a) => !a.projectId).length };
    projects.forEach((p) => { m[p.id] = live.filter((a) => a.projectId === p.id).length; });
    return m;
  }, [assets, projects]);

  const title =
    scope === "single" ? (picked?.uuid ?? "Asset")
    : projectId === ALL ? "All Projects"
    : projectId === "" ? "Unassigned Assets"
    : pm[projectId] ?? "Project";

  async function handleDownload() {
    setBusy(true);
    try {
      if (output === "labels") await generateAssetLabels(scoped, title, { sheet });
      else await generateQRSheet(scoped, title);
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
              <Tag className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Print Asset Labels / QR</p>
              <p className="text-xs text-slate-400">By project, or one individual asset</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Output type */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">Output</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setOutput("labels")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${output === "labels" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                <Tag className="h-3.5 w-3.5" /> Asset Labels
              </button>
              <button onClick={() => setOutput("qr")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${output === "qr" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                <QrCode className="h-3.5 w-3.5" /> QR Sheet
              </button>
            </div>
          </div>

          {/* Label layout */}
          {output === "labels" && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">Label Layout</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setSheet(true)}
                  className={`rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${sheet ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <span className="block font-semibold text-slate-700">A4 Sheet</span>
                  <span className="text-slate-400">3 × 10 per page</span>
                </button>
                <button onClick={() => setSheet(false)}
                  className={`rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${!sheet ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <span className="block font-semibold text-slate-700">Label Printer</span>
                  <span className="text-slate-400">one {LABEL_W}×{LABEL_H}mm page each</span>
                </button>
              </div>
            </div>
          )}

          {/* Scope: whole project vs one individual asset */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">Print For</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setScope("project")}
                className={`rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${scope === "project" ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="block font-semibold text-slate-700">A Project</span>
                <span className="text-slate-400">every asset in it</span>
              </button>
              <button onClick={() => { setScope("single"); setSheet(false); }}
                className={`rounded-lg border px-3 py-2 text-left text-[11px] transition-colors ${scope === "single" ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="block font-semibold text-slate-700">Individual Asset</span>
                <span className="text-slate-400">pick one asset</span>
              </button>
            </div>
          </div>

          {scope === "project" ? (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500">
                <option value={ALL}>All Projects ({counts[ALL] ?? 0} assets)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({counts[p.id] ?? 0} assets)</option>
                ))}
                {(counts[""] ?? 0) > 0 && <option value="">— Unassigned — ({counts[""]} assets)</option>}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">Asset</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                  placeholder="Search by asset number or name…"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-500" />
              </div>
              <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                {matches.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-400">No matching assets</p>
                ) : matches.map((a) => (
                  <button key={a.id} onClick={() => setPickedId(a.id)}
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-0 ${pickedId === a.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs font-semibold text-slate-800">{a.uuid}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {a.name || "Unnamed"}{a.projectId && pm[a.projectId] ? ` · ${pm[a.projectId]}` : ""}
                      </p>
                    </div>
                    {pickedId === a.id && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
                  </button>
                ))}
              </div>
              {!query.trim() && live.length > matches.length && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Showing first {matches.length} of {live.length} — search to narrow down.
                </p>
              )}
            </div>
          )}

          {scoped.length > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
              <FolderKanban className="h-4 w-4 shrink-0 text-indigo-500" />
              <p className="text-xs text-indigo-700">
                <strong>{scoped.length}</strong>{" "}
                {output === "labels"
                  ? <>label{scoped.length === 1 ? "" : "s"} ({LABEL_W}×{LABEL_H}mm — QR, barcode, part number, logo)</>
                  : <>QR code{scoped.length === 1 ? "" : "s"} (3 per row on A4)</>}
                {" "}for <strong>{title}</strong>
                {scope === "project" && ". Retired assets are excluded."}
              </p>
            </div>
          )}

          {scoped.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {scope === "single"
                ? "Select an asset above to print its label."
                : "No assets in this project — nothing to generate."}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={handleDownload} disabled={busy || scoped.length === 0}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Generating…" : `Download ${scoped.length} ${output === "labels" ? "Label" : "QR"}${scoped.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
