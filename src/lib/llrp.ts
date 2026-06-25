/**
 * Minimal LLRP (Low Level Reader Protocol) client for network RFID readers.
 * Works with Zebra FX7500/FX9600, Impinj Speedway R220/R420, and any reader
 * that supports LLRP 1.0.1 (ISO 15961 / EPCglobal LLRP standard).
 *
 * Default reader port: 5084 (LLRP plain TCP)
 */
import net from "net";
import { EventEmitter } from "events";

// ─── LLRP Message Type Constants ─────────────────────────────────────────────
const T = {
  ADD_ROSPEC:                20,
  ADD_ROSPEC_RESPONSE:       30,
  ENABLE_ROSPEC:             24,
  ENABLE_ROSPEC_RESPONSE:    34,
  START_ROSPEC:              22,
  START_ROSPEC_RESPONSE:     32,
  STOP_ROSPEC:               23,
  DELETE_ROSPEC:             21,
  RO_ACCESS_REPORT:          61,
  KEEPALIVE:                 62,
  KEEPALIVE_ACK:             72,
  READER_EVENT_NOTIFICATION: 63,
  ENABLE_EVENTS_AND_REPORTS: 64,
  // Access (Write) spec
  ADD_ACCESSSPEC:            40,
  ADD_ACCESSSPEC_RESPONSE:   50,
  ENABLE_ACCESSSPEC:         44,
  START_ACCESSSPEC:          42,
  DELETE_ACCESSSPEC:         41,
  ACCESS_REPORT:             63,
} as const;

// ─── Binary helpers ───────────────────────────────────────────────────────────
function mkMsg(type: number, id: number, payload: Buffer): Buffer {
  const len = 10 + payload.length;
  const b = Buffer.alloc(len);
  b.writeUInt16BE((1 << 10) | (type & 0x3FF), 0); // LLRP version 1
  b.writeUInt32BE(len, 2);
  b.writeUInt32BE(id >>> 0, 6);
  payload.copy(b, 10);
  return b;
}

function u8(v: number): Buffer { const b = Buffer.alloc(1); b[0] = v; return b; }
function u16(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16BE(v, 0); return b; }
function u32(v: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; }

// TLV parameter builder: type (2 bytes) + length (2 bytes, includes header) + value
function tlv(type: number, ...parts: Buffer[]): Buffer {
  const value = Buffer.concat(parts);
  const len = 4 + value.length;
  return Buffer.concat([u16(type & 0x03FF), u16(len), value]);
}

// ─── Pre-built LLRP messages ──────────────────────────────────────────────────
export const ENABLE_EVENTS = mkMsg(T.ENABLE_EVENTS_AND_REPORTS, 1, Buffer.alloc(0));
export const KEEPALIVE_ACK = mkMsg(T.KEEPALIVE_ACK, 99, Buffer.alloc(0));

/** ADD_ROSPEC — immediate continuous inventory on all antennas */
export function buildAddROSpec(rospecId = 1): Buffer {
  // TagReportContentSelector: EnableAntennaID | EnablePeakRSSI | EnableFirstSeenTimestamp
  const tagSelector = tlv(238, u16(0x1401));
  // ROReportSpec: trigger=Upon_N_Tags(1), N=1
  const roReportSpec = tlv(237, u8(1), u16(1), tagSelector);
  // InventoryParameterSpec: SpecID=1, Protocol=EPC Global Gen2 (1)
  const invSpec = tlv(13, u16(1), u8(1));
  // AISpecStopTrigger: Null(0), duration=0
  const aiStop = tlv(17, u8(0), u32(0));
  // AISpec: AntennaCount=1, AntennaID=0 (all)
  const aiSpec = tlv(16, u16(1), u16(0), aiStop, invSpec);
  // ROSpecStartTrigger: Immediate (1)
  const roStart = tlv(11, u8(1));
  // ROSpecStopTrigger: Null (0), duration=0
  const roStop = tlv(12, u8(0), u32(0));
  // ROBoundarySpec
  const roBoundary = tlv(10, roStart, roStop);
  // ROSpec: ID, Priority=0, CurrentState=Disabled(0)
  const rospec = tlv(7, u32(rospecId), u8(0), u8(0), roBoundary, aiSpec, roReportSpec);
  return mkMsg(T.ADD_ROSPEC, 2, rospec);
}

export function buildEnableROSpec(rospecId = 1): Buffer {
  return mkMsg(T.ENABLE_ROSPEC, 3, u32(rospecId));
}
export function buildStartROSpec(rospecId = 1): Buffer {
  return mkMsg(T.START_ROSPEC, 4, u32(rospecId));
}
export function buildStopROSpec(rospecId = 1): Buffer {
  return mkMsg(T.STOP_ROSPEC, 5, u32(rospecId));
}
export function buildDeleteROSpec(rospecId = 1): Buffer {
  return mkMsg(T.DELETE_ROSPEC, 6, u32(rospecId));
}

/**
 * BUILD_WRITE_EPC — EPC Write AccessSpec.
 * Writes a new EPC to any tag that currently has epcToMatch (or pass empty string to match all).
 * newEpc must be a hex string (e.g. "E20011223344556677889900" = 24 hex chars = 96-bit EPC)
 */
export function buildWriteEPCSpec(newEpc: string, epcToMatch = "", accessSpecId = 1): Buffer {
  const epcBytes = Buffer.from(newEpc.replace(/\s/g, ""), "hex");
  const wordCount = Math.ceil(epcBytes.length / 2);

  // C1G2WriteOpSpec: OpSpecID=1, MB=1 (EPC bank), WordPtr=2 (skip PC+CRC), WordCount, Data
  const writeData = Buffer.concat([u16(1), u16(1 /* MB=EPC */), u16(2 /* WordPtr */),
    u16(wordCount), epcBytes]);
  const writeOpSpec = tlv(328, writeData); // type 328 = C1G2Write

  // C1G2TagSpec for matching (empty = match all via mask)
  const epcMatchBytes = epcToMatch ? Buffer.from(epcToMatch.replace(/\s/g, ""), "hex") : Buffer.alloc(0);
  const tagPatternLen = epcMatchBytes.length * 8; // bit count
  const c1g2TagSpec = tlv(320,
    tlv(322, u16(1 /*MB=EPC*/), u16(32 /*BitPointer after PC*/), u16(tagPatternLen), epcMatchBytes, epcMatchBytes)
  );

  // AccessSpec: ID, AntennaID=0(all), Protocol=EPC Gen2(1), CurrentState=Disabled, ROSpecID=0(any)
  const accessOp = tlv(313, c1g2TagSpec, writeOpSpec); // AccessCommand
  const accessSpec = tlv(207,
    u32(accessSpecId), u16(0 /*all antennas*/), u8(1 /*EPC Gen2*/), u8(0 /*Disabled*/), u32(0 /*any ROSpec*/),
    accessOp
  );
  return mkMsg(T.ADD_ACCESSSPEC, 10 + accessSpecId, accessSpec);
}
export function buildEnableAccessSpec(id = 1): Buffer {
  return mkMsg(T.ENABLE_ACCESSSPEC, 20, u32(id));
}
export function buildDeleteAccessSpec(id = 1): Buffer {
  return mkMsg(T.DELETE_ACCESSSPEC, 21, u32(id));
}

// ─── Tag Read result ──────────────────────────────────────────────────────────
export interface TagRead {
  epc: string;       // hex string
  rssi?: number;     // dBm (signed)
  antennaId?: number;
  timestamp: number; // ms since epoch
}

// ─── Parse RO_ACCESS_REPORT payload → TagRead[] ───────────────────────────────
export function parseROAccessReport(payload: Buffer): TagRead[] {
  const tags: TagRead[] = [];
  let offset = 0;

  while (offset < payload.length) {
    if (offset + 1 > payload.length) break;

    // TV parameter check (bit 7 of first byte = 1)
    if (payload[offset] & 0x80) {
      const tvType = payload[offset] & 0x7F;
      if (tvType === 13 && offset + 13 <= payload.length) {
        // EPC_96: type (1 byte) + 12-byte EPC
        const epc = payload.slice(offset + 1, offset + 13).toString("hex").toUpperCase();
        tags.push({ epc, timestamp: Date.now() });
        offset += 13;
      } else {
        offset += 1;
      }
      continue;
    }

    // TLV parameter
    if (offset + 4 > payload.length) break;
    const tlvType = payload.readUInt16BE(offset) & 0x03FF;
    const tlvLen = payload.readUInt16BE(offset + 2);
    if (tlvLen < 4 || offset + tlvLen > payload.length) break;

    const content = payload.slice(offset + 4, offset + tlvLen);

    if (tlvType === 240) {
      // TagReportData: recurse to find EPC/RSSI/Antenna within
      const inner = parseROAccessReport(content);
      if (inner.length > 0) {
        // Also look for RSSI and AntennaID in sibling fields
        let rssi: number | undefined;
        let antennaId: number | undefined;
        let off2 = 0;
        while (off2 < content.length) {
          if (content[off2] & 0x80) {
            const t2 = content[off2] & 0x7F;
            if (t2 === 14 && off2 + 2 <= content.length) {
              // PeakRSSI TV param: 1 byte signed integer
              rssi = content.readInt8(off2 + 1);
              off2 += 2;
            } else if (t2 === 1 && off2 + 3 <= content.length) {
              // AntennaID TV: 2 bytes
              antennaId = content.readUInt16BE(off2 + 1);
              off2 += 3;
            } else { off2 += 1; }
            continue;
          }
          if (off2 + 4 > content.length) break;
          const t2 = content.readUInt16BE(off2) & 0x03FF;
          const l2 = content.readUInt16BE(off2 + 2);
          if (l2 < 4 || off2 + l2 > content.length) break;
          if (t2 === 219 && l2 >= 5) { rssi = content.readInt8(off2 + 4); }
          off2 += l2;
        }
        for (const tag of inner) {
          tags.push({ ...tag, rssi: tag.rssi ?? rssi, antennaId: tag.antennaId ?? antennaId });
        }
      }
    } else if (tlvType === 241 && tlvLen >= 8) {
      // EPCData: 2 bytes bit count + EPC bytes
      const bitCount = content.readUInt16BE(0);
      const byteCount = Math.ceil(bitCount / 8);
      if (byteCount <= content.length - 2) {
        const epc = content.slice(2, 2 + byteCount).toString("hex").toUpperCase();
        tags.push({ epc, timestamp: Date.now() });
      }
    }

    offset += tlvLen;
  }

  return tags;
}

// ─── LLRPClient EventEmitter ──────────────────────────────────────────────────
export interface LLRPClientEvents {
  connected: () => void;
  tag: (tag: TagRead) => void;
  error: (err: Error) => void;
  close: () => void;
}

export class LLRPClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private rxBuf = Buffer.alloc(0);
  private _msgId = 100;

  /** Connect and start inventory. Resolves when TCP connection is established. */
  connect(host: string, port = 5084, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this.socket = sock;
      sock.setTimeout(timeoutMs);

      sock.once("connect", () => {
        sock.setTimeout(0); // remove connection timeout; reader keepalives keep socket alive
        // Startup sequence: enable events → add/enable/start ROSpec
        sock.write(ENABLE_EVENTS);
        // Give reader 200ms to process, then add ROSpec
        setTimeout(() => {
          sock.write(buildAddROSpec());
          setTimeout(() => {
            sock.write(buildEnableROSpec());
            sock.write(buildStartROSpec());
            this.emit("connected");
            resolve();
          }, 200);
        }, 200);
      });

      sock.on("data", (data: Buffer) => {
        this.rxBuf = Buffer.concat([this.rxBuf, data]);
        this._drain();
      });

      sock.on("error", (err) => { reject(err); this.emit("error", err); });
      sock.on("timeout", () => { sock.destroy(); reject(new Error("Connection timed out")); });
      sock.on("close", () => { this.emit("close"); });

      sock.connect(port, host);
    });
  }

  private _drain() {
    while (this.rxBuf.length >= 10) {
      const msgLen = this.rxBuf.readUInt32BE(2);
      if (msgLen < 10 || this.rxBuf.length < msgLen) break;
      const msg = this.rxBuf.slice(0, msgLen);
      this.rxBuf = this.rxBuf.slice(msgLen);
      this._onMessage(msg);
    }
  }

  private _onMessage(msg: Buffer) {
    const type = msg.readUInt16BE(0) & 0x3FF;
    if (type === T.KEEPALIVE) {
      this.socket?.write(KEEPALIVE_ACK);
    } else if (type === T.RO_ACCESS_REPORT) {
      const tags = parseROAccessReport(msg.slice(10));
      for (const tag of tags) this.emit("tag", tag);
    }
  }

  /** Stop and disconnect cleanly */
  disconnect() {
    if (!this.socket) return;
    try {
      this.socket.write(buildStopROSpec());
      this.socket.write(buildDeleteROSpec());
      this.socket.destroy();
    } catch { /* ignore */ }
    this.socket = null;
  }
}
