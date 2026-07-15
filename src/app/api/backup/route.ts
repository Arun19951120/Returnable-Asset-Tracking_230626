import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

// Full backup — bundles every data/*.json collection into a single snapshot.
export async function GET() {
  const snapshot: Record<string, unknown> = {
    _meta: {
      app: "RSPL Returnable Asset Tracking",
      version: 1,
      createdAt: new Date().toISOString(),
    },
    collections: {} as Record<string, unknown[]>,
  };

  try {
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    const collections: Record<string, unknown[]> = {};
    for (const file of files) {
      const name = file.replace(/\.json$/, "");
      try {
        collections[name] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
      } catch {
        collections[name] = [];
      }
    }
    snapshot.collections = collections;
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
