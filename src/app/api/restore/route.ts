import { NextRequest, NextResponse } from "next/server";
import { restoreSnapshot } from "@/lib/backup-server";

// Restore from an uploaded backup snapshot produced by /api/backup.
// (Restoring from a snapshot already in the storage directory goes through
// POST /api/backups/[name] instead — both share restoreSnapshot().)
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON file" }, { status: 400 });
  }

  const result = restoreSnapshot(body);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, ...result });
}
