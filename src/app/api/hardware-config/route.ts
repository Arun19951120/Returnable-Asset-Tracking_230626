import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "hardware_config.json");

export async function GET() {
  if (!fs.existsSync(FILE)) return NextResponse.json({});
  return NextResponse.json(JSON.parse(fs.readFileSync(FILE, "utf-8")));
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  fs.writeFileSync(FILE, JSON.stringify(body, null, 2));
  return NextResponse.json({ ok: true });
}
