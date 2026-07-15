import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

// Only these collections may be written (matches the app's data files).
const ALLOWED = new Set([
  "asset_cycles", "assets", "audit_logs", "custom_roles", "dc_cancellations",
  "dc_logs", "hardware_config", "locations", "movements", "notifications",
  "orders", "pickup_requests", "projects", "scheduled_reports", "transfers", "users",
]);

// Restore from a backup snapshot produced by /api/backup.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON file" }, { status: 400 });
  }

  const collections = (body as { collections?: Record<string, unknown> })?.collections;
  if (!collections || typeof collections !== "object") {
    return NextResponse.json({ error: "Not a valid backup file (missing 'collections')" }, { status: 400 });
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

  if (restored.length === 0) {
    return NextResponse.json({ error: "No valid collections found to restore" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, restored, skipped });
}
