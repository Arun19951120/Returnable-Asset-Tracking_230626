"use client";

import { useMemo, useState } from "react";
import { Asset, Project } from "@/lib/types";
import { generateQRSheet } from "@/lib/qr";
import { X, Loader2, QrCode, Download, FolderKanban } from "lucide-react";

interface Props {
  assets: Asset[];
  projects: Project[];
  /** Pre-select this project (e.g. the ledger's active project filter) */
  initialProjectId?: string;
  onClose: () => void;
}

const ALL = "__all__";

export default function BulkQRDialog({ assets, projects, initialProjectId, onClose }: Props) {
  const [projectId, setProjectId] = useState(initialProjectId || ALL);
  const [busy, setBusy] = useState(false);

  const pm = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  // Assets in the chosen project (retired excluded — no point labelling those)
  const scoped = useMemo(() => {
    const live = assets.filter((a) => a.status !== "Retired");
    if (projectId === ALL) return live;
    if (projectId === "") return live.filter((a) => !a.projectId);
    return live.filter((a) => a.projectId === projectId);
  }, [assets, projectId]);

  // Per-project counts for the picker
  const counts = useMemo(() => {
    const live = assets.filter((a) => a.status !== "Retired");
    const m: Record<string, number> = { [ALL]: live.length, "": live.filter((a) => !a.projectId).length };
    projects.forEach((p) => { m[p.id] = live.filter((a) => a.projectId === p.id).length; });
    return m;
  }, [assets, projects]);

  const title =
    projectId === ALL ? "All Projects"
    : projectId === "" ? "Unassigned Assets"
    : pm[projectId] ?? "Project";

  async function handleDownload() {
    setBusy(true);
    try { await generateQRSheet(scoped, title); onClose(); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
              <QrCode className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Download QR Codes</p>
              <p className="text-xs text-slate-400">Printable QR sheet, grouped by project</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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

          <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
            <FolderKanban className="h-4 w-4 shrink-0 text-indigo-500" />
            <p className="text-xs text-indigo-700">
              <strong>{scoped.length}</strong> QR code{scoped.length === 1 ? "" : "s"} will be generated for <strong>{title}</strong> — 3 per row on A4, each labelled with its UUID and asset name. Retired assets are excluded.
            </p>
          </div>

          {scoped.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No assets in this project — nothing to generate.
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={handleDownload} disabled={busy || scoped.length === 0}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Generating…" : `Download ${scoped.length} QR${scoped.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
