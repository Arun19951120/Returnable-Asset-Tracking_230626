/**
 * POST /api/rfid/write
 * Body: { ip, port, newEpc, matchEpc? }
 *
 * Connects to RFID reader, sends an AccessSpec to write the given EPC to a
 * tag. If matchEpc is provided, only that tag is overwritten; otherwise the
 * first tag in the field gets the new EPC.
 *
 * newEpc must be a 24-char hex string (96-bit EPC Gen2).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  LLRPClient,
  buildAddROSpec, buildEnableROSpec, buildStartROSpec,
  buildWriteEPCSpec, buildEnableAccessSpec, buildDeleteAccessSpec,
  ENABLE_EVENTS, KEEPALIVE_ACK,
} from "@/lib/llrp";
import net from "net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json() as { ip?: string; port?: number; newEpc?: string; matchEpc?: string };
  const ip      = body.ip      || "192.168.1.100";
  const port    = body.port    || 5084;
  const newEpc  = (body.newEpc || "").replace(/\s/g, "").toUpperCase();
  const matchEpc= (body.matchEpc || "").replace(/\s/g, "").toUpperCase();

  if (!newEpc || newEpc.length !== 24) {
    return NextResponse.json({ ok: false, error: "newEpc must be a 24-character hex string (96-bit EPC)" }, { status: 400 });
  }

  // Connect, write EPC, disconnect — wrapped in a timeout
  const result = await Promise.race([
    doWrite(ip, port, newEpc, matchEpc),
    new Promise<{ ok: boolean; error: string }>((_, reject) =>
      setTimeout(() => reject(new Error("Write timed out (8s)")), 8000)
    ),
  ]).catch((err: Error) => ({ ok: false as const, error: err.message }));

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

async function doWrite(
  ip: string, port: number, newEpc: string, matchEpc: string
): Promise<{ ok: boolean; written?: string; error?: string }> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let rxBuf = Buffer.alloc(0);
    let msgIdSeq = 1;
    let phase = 0; // 0=connecting, 1=startup, 2=writing, 3=done

    function send(buf: Buffer) { sock.write(buf); }

    function parseMessages(data: Buffer) {
      rxBuf = Buffer.concat([rxBuf, data]);
      while (rxBuf.length >= 10) {
        const len = rxBuf.readUInt32BE(2);
        if (len < 10 || rxBuf.length < len) break;
        const msg = rxBuf.slice(0, len);
        rxBuf = rxBuf.slice(len);
        const type = msg.readUInt16BE(0) & 0x3FF;
        onMessage(type, msg);
      }
    }

    function onMessage(type: number, _msg: Buffer) {
      if (type === 62) { send(KEEPALIVE_ACK); return; } // KEEPALIVE
      if (phase === 1 && (type === 30 || type === 34 || type === 32)) {
        // Got ADD_ROSPEC_RESPONSE or ENABLE/START response — proceed to write
        phase = 2;
        const writeSpec = buildWriteEPCSpec(newEpc, matchEpc, msgIdSeq++);
        send(writeSpec);
        const enableAccess = buildEnableAccessSpec(msgIdSeq - 1);
        send(enableAccess);
      } else if (phase === 2 && (type === 50 || type === 54)) {
        // ADD_ACCESSSPEC_RESPONSE or ENABLE_ACCESSSPEC_RESPONSE
        // Send start ROSpec to trigger a tag encounter → write happens automatically
        send(buildStartROSpec());
      } else if (phase === 2 && type === 61) {
        // RO_ACCESS_REPORT — write happened (or tag not found)
        phase = 3;
        send(buildDeleteAccessSpec(msgIdSeq - 1));
        sock.destroy();
        resolve({ ok: true, written: newEpc });
      }
    }

    sock.setTimeout(8000);
    sock.on("data", parseMessages);
    sock.on("error", (err) => resolve({ ok: false, error: err.message }));
    sock.on("timeout", () => { sock.destroy(); resolve({ ok: false, error: "Timed out waiting for tag" }); });

    sock.connect(port, ip, () => {
      phase = 1;
      send(ENABLE_EVENTS);
      setTimeout(() => {
        send(buildAddROSpec());
        send(buildEnableROSpec());
      }, 300);
    });
  });
}
