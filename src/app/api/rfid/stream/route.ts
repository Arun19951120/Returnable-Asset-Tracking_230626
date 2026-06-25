/**
 * GET /api/rfid/stream?ip=192.168.1.100&port=5084
 *
 * Server-Sent Events (SSE) endpoint. Opens a real LLRP TCP connection to the
 * configured RFID reader and streams every tag read as a JSON SSE event.
 *
 * Event shapes:
 *   { type: "connected" }
 *   { type: "tag", epc: "E20011...", rssi: -55, antennaId: 1, timestamp: 1234567890 }
 *   { type: "error", message: "..." }
 *   { type: "done" }
 */
import { NextRequest } from "next/server";
import { LLRPClient } from "@/lib/llrp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ip   = searchParams.get("ip")   || "192.168.1.100";
  const port = parseInt(searchParams.get("port") || "5084", 10);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch { /* stream already closed */ }
      }

      const client = new LLRPClient();

      client.on("connected", () => send({ type: "connected" }));
      client.on("tag",       (tag) => send({ type: "tag", ...tag }));
      client.on("error",     (err) => { send({ type: "error", message: err.message }); });
      client.on("close",     ()    => { send({ type: "done" }); try { controller.close(); } catch {} });

      try {
        await client.connect(ip, port, 6000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Connection failed";
        send({ type: "error", message: msg });
        try { controller.close(); } catch {}
        return;
      }

      // Disconnect when client navigates away
      req.signal.addEventListener("abort", () => client.disconnect());
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
