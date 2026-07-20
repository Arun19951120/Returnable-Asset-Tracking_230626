import { NextRequest, NextResponse } from "next/server";
import {
  createBackup, listBackups, readSettings, writeSettings, resolveDir, DEFAULT_BACKUP_DIR,
} from "@/lib/backup-server";

/** List stored snapshots + the current schedule settings. */
export async function GET() {
  const settings = readSettings();
  let directory = settings.directory;
  let dirError: string | null = null;
  try { directory = resolveDir(settings); }
  catch (e) { dirError = `Cannot access backup directory: ${String(e).slice(0, 200)}`; }

  return NextResponse.json({
    settings,
    directory,                 // the resolved absolute path, for display
    defaultDirectory: DEFAULT_BACKUP_DIR,
    dirError,
    files: dirError ? [] : listBackups(settings),
  });
}

/** Take a snapshot right now, into the storage directory. */
export async function POST() {
  try {
    return NextResponse.json({ ok: true, file: createBackup() });
  } catch (e) {
    return NextResponse.json({ error: `Backup failed: ${String(e).slice(0, 200)}` }, { status: 500 });
  }
}

/** Update the storage directory / automatic-backup schedule. */
export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const current = readSettings();
  const next = {
    ...current,
    directory: typeof body.directory === "string" && body.directory.trim()
      ? body.directory.trim() : current.directory,
    auto: typeof body.auto === "boolean" ? body.auto : current.auto,
    intervalHours: Number(body.intervalHours) || current.intervalHours,
    retain: body.retain === undefined ? current.retain : Number(body.retain),
  };

  // Refuse a directory we cannot actually create/write — otherwise automatic
  // backups would fail silently later.
  try {
    writeSettings(next);
    resolveDir(next);
  } catch (e) {
    writeSettings(current);   // roll back
    return NextResponse.json({ error: `Cannot use that directory: ${String(e).slice(0, 200)}` }, { status: 400 });
  }

  // re-read so the response reflects the clamped/normalised values
  return NextResponse.json({ ok: true, settings: readSettings(), directory: resolveDir() });
}
