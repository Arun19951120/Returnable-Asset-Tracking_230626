import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

const DATA_DIR = path.join(process.cwd(), "data");

function filePath(collection: string) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function read(collection: string): unknown[] {
  const fp = filePath(collection);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

function write(collection: string, data: unknown[]) {
  fs.writeFileSync(filePath(collection), JSON.stringify(data, null, 2));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ collection: string }> }
) {
  const { collection } = await params;
  return NextResponse.json(read(collection));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ collection: string }> }
) {
  const { collection } = await params;
  const body = await req.json();
  const records = read(collection) as Record<string, unknown>[];
  const newRecord = {
    id: body.id ?? `${collection.slice(0, 3)}-${uuid().slice(0, 8)}`,
    ...body,
    createdAt: body.createdAt ?? new Date().toISOString(),
  };
  records.push(newRecord);
  write(collection, records);
  return NextResponse.json(newRecord, { status: 201 });
}
