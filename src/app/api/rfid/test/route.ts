/**
 * GET /api/rfid/test?ip=192.168.1.100&port=5084
 * Attempts a real TCP connection to the RFID reader and returns result.
 */
import { NextRequest, NextResponse } from "next/server";
import net from "net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ip   = searchParams.get("ip")   || "192.168.1.100";
  const port = parseInt(searchParams.get("port") || "5084", 10);

  const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
    const sock = new net.Socket();
    const timeout = setTimeout(() => {
      sock.destroy();
      resolve({ ok: false, message: `Timed out — no response from ${ip}:${port}` });
    }, 5000);

    sock.connect(port, ip, () => {
      clearTimeout(timeout);
      sock.destroy();
      resolve({ ok: true, message: `Connected to ${ip}:${port} — RFID reader is reachable` });
    });

    sock.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, message: err.message });
    });
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
