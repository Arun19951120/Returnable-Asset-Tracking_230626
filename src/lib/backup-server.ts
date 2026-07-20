import fs from "fs";
import path from "path";

/**
 * Server-side backup engine.
 *
 * Snapshots of every `data/*.json` collection are written into a storage
 * directory on disk so they survive a browser wipe and can be restored
 * without the operator having kept the download. A scheduler (see
 * `src/instrumentation.ts`) calls `runAutoBackup()` on a timer.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "backup_settings.json");

/** Where snapshots live when the operator hasn't chosen somewhere else. */
export const DEFAULT_BACKUP_DIR = path.join(process.cwd(), "backups");

export interface BackupSettings {
  /** Storage directory — absolute, or relative to the app root. */
  directory: string;
  /** Run backups on a timer. */
  auto: boolean;
  /** Hours between automatic backups. */
  intervalHours: number;
  /** Keep only the N newest snapshots (0 = keep everything). */
  retain: number;
  lastRunAt: string | null;
  lastError: string | null;
}

const DEFAULTS: BackupSettings = {
  directory: DEFAULT_BACKUP_DIR,
  auto: false,
  intervalHours: 24,
  retain: 30,
  lastRunAt: null,
  lastError: null,
};

const clamp = (n: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

export function readSettings(): BackupSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<BackupSettings>;
    return {
      directory: typeof raw.directory === "string" && raw.directory.trim() ? raw.directory : DEFAULTS.directory,
      auto: !!raw.auto,
      intervalHours: clamp(Number(raw.intervalHours), 1, 24 * 7, DEFAULTS.intervalHours),
      retain: clamp(Number(raw.retain), 0, 500, DEFAULTS.retain),
      lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
      lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(next: BackupSettings) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + "\n");
}

/** Resolve the configured directory to an absolute path and ensure it exists. */
export function resolveDir(settings = readSettings()): string {
  // The directory is operator-configurable, so this path is genuinely dynamic;
  // the ignore comment stops Turbopack tracing the whole project because of it.
  const dir = path.isAbsolute(settings.directory)
    ? settings.directory
    : path.join(/* turbopackIgnore: true */ process.cwd(), settings.directory);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Bundle every data collection into one snapshot object. */
export function buildSnapshot(): Record<string, unknown> {
  const collections: Record<string, unknown> = {};
  for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"))) {
    const name = file.replace(/\.json$/, "");
    if (name === "backup_settings") continue;   // config, not data
    try {
      collections[name] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    } catch {
      collections[name] = [];
    }
  }
  return {
    _meta: {
      app: "RSPL Returnable Asset Tracking",
      version: 1,
      createdAt: new Date().toISOString(),
    },
    collections,
  };
}

/** Backup filenames are `rspl-backup-<stamp>[-auto].json` — nothing else is listed. */
const FILE_RE = /^rspl-backup-[\w-]+\.json$/;

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
  auto: boolean;
}

export function listBackups(settings = readSettings()): BackupFile[] {
  const dir = resolveDir(settings);
  try {
    return fs.readdirSync(dir)
      .filter((f) => FILE_RE.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, createdAt: st.mtime.toISOString(), auto: name.includes("-auto") };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));   // newest first
  } catch {
    return [];
  }
}

/**
 * Resolve a user-supplied filename to a path inside the storage directory.
 * Returns null if the name is not a backup file or tries to escape the dir.
 */
export function safeBackupPath(name: string, settings = readSettings()): string | null {
  if (!FILE_RE.test(name)) return null;
  const dir = resolveDir(settings);
  const full = path.join(dir, name);
  // path.join already collapses "..", but re-check the result really is inside dir
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) return null;
  return full;
}

/** Delete the oldest snapshots beyond the retention limit. */
function prune(settings: BackupSettings) {
  if (settings.retain <= 0) return;
  const dir = resolveDir(settings);
  const extra = listBackups(settings).slice(settings.retain);
  for (const f of extra) {
    try { fs.unlinkSync(path.join(dir, f.name)); } catch { /* best effort */ }
  }
}

/** Write a snapshot into the storage directory. Returns the filename. */
export function createBackup(opts: { auto?: boolean } = {}): BackupFile {
  const settings = readSettings();
  const dir = resolveDir(settings);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const name = `rspl-backup-${stamp}${opts.auto ? "-auto" : ""}.json`;
  const full = path.join(dir, name);
  fs.writeFileSync(full, JSON.stringify(buildSnapshot(), null, 2) + "\n");
  prune(settings);
  const st = fs.statSync(full);
  return { name, size: st.size, createdAt: st.mtime.toISOString(), auto: !!opts.auto };
}

/** Collections the restore path is allowed to overwrite. */
const ALLOWED = new Set([
  "asset_cycles", "assets", "audit_logs", "custom_roles", "dc_cancellations",
  "dc_logs", "hardware_config", "locations", "movements", "notifications",
  "orders", "pickup_requests", "projects", "scheduled_reports", "transfers", "users",
]);

export function restoreSnapshot(body: unknown): { restored: string[]; skipped: string[] } | { error: string } {
  const collections = (body as { collections?: Record<string, unknown> })?.collections;
  if (!collections || typeof collections !== "object") {
    return { error: "Not a valid backup file (missing 'collections')" };
  }
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const [name, data] of Object.entries(collections)) {
    if (!ALLOWED.has(name)) { skipped.push(name); continue; }
    // hardware_config is an object; every other collection is an array
    const isConfig = name === "hardware_config";
    if (isConfig ? typeof data !== "object" : !Array.isArray(data)) { skipped.push(name); continue; }
    try {
      fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
      restored.push(name);
    } catch {
      skipped.push(name);
    }
  }
  if (restored.length === 0) return { error: "No valid collections found to restore" };
  return { restored, skipped };
}

/** True when enough time has passed since the last automatic run. */
export function isBackupDue(settings = readSettings()): boolean {
  if (!settings.auto) return false;
  if (!settings.lastRunAt) return true;
  const last = Date.parse(settings.lastRunAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= settings.intervalHours * 3600_000;
}

/**
 * Run an automatic backup if one is due. Safe to call often — it no-ops until
 * the interval has elapsed. Records success/failure into the settings file so
 * the schedule survives a restart and the UI can surface problems.
 */
export function runAutoBackup(): BackupFile | null {
  const settings = readSettings();
  if (!isBackupDue(settings)) return null;
  try {
    const file = createBackup({ auto: true });
    writeSettings({ ...settings, lastRunAt: new Date().toISOString(), lastError: null });
    return file;
  } catch (e) {
    writeSettings({ ...settings, lastRunAt: new Date().toISOString(), lastError: String(e).slice(0, 300) });
    return null;
  }
}
