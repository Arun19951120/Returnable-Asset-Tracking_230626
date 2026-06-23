import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function filePath(collection: string) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function read(collection: string): Record<string, unknown>[] {
  const fp = filePath(collection);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

function write(collection: string, data: unknown[]) {
  fs.writeFileSync(filePath(collection), JSON.stringify(data, null, 2));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ collection: string; id: string }> }
) {
  const { collection, id } = await params;
  const records = read(collection);
  const record = records.find((r) => r.id === id || r.uid === id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ collection: string; id: string }> }
) {
  const { collection, id } = await params;
  const body = await req.json();
  const records = read(collection);
  const idx = records.findIndex((r) => r.id === id || r.uid === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  records[idx] = { ...records[idx], ...body, updatedAt: new Date().toISOString() };
  write(collection, records);
  return NextResponse.json(records[idx]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ collection: string; id: string }> }
) {
  const { collection, id } = await params;
  const records = read(collection);
  const filtered = records.filter((r) => r.id !== id && r.uid !== id);
  write(collection, filtered);
  return NextResponse.json({ ok: true });
}
