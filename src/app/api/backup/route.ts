import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/backup-server";

// Full backup, streamed straight to the browser as a download.
// (To write a snapshot into the server's storage directory instead,
// POST /api/backups.)
export async function GET() {
  let snapshot: Record<string, unknown>;
  try {
    snapshot = buildSnapshot();
  } catch {
    return NextResponse.json({ error: "Failed to read data directory" }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rspl-backup-${stamp}.json"`,
    },
  });
}
