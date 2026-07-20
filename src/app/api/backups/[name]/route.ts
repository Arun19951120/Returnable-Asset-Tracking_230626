import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { safeBackupPath, restoreSnapshot } from "@/lib/backup-server";

type Ctx = { params: Promise<{ name: string }> };

/** Download one stored snapshot. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { name } = await params;
  const full = safeBackupPath(name);
  if (!full || !fs.existsSync(full)) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }
  return new NextResponse(fs.readFileSync(full, "utf-8"), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

/** Restore the database from one stored snapshot. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { name } = await params;
  const full = safeBackupPath(name);
  if (!full || !fs.existsSync(full)) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }
  let snapshot: unknown;
  try { snapshot = JSON.parse(fs.readFileSync(full, "utf-8")); }
  catch { return NextResponse.json({ error: "That backup file is corrupt" }, { status: 400 }); }

  const result = restoreSnapshot(snapshot);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, ...result });
}

/** Delete one stored snapshot. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { name } = await params;
  const full = safeBackupPath(name);
  if (!full || !fs.existsSync(full)) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }
  try { fs.unlinkSync(full); }
  catch (e) { return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
