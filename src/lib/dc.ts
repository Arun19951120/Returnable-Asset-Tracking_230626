import type { Asset, Location, DCLog, Project } from "@/lib/types";
import { addDocument } from "@/lib/storage";
import { resolveLoopCost } from "@/lib/loops";
import { toast } from "sonner";

/** Option 01 — one row per asset with UUID, optional RFID/BLE, Unit Price, Qty=1, Total */
/** Option 02 — one row per asset type (cumulative qty); serial grid at the bottom         */
export type DCLineMode = "individual" | "cumulative";

export interface DCOptions {
  lineMode?: DCLineMode;
  showRFID?: boolean;
  showBLE?: boolean;
  vehicleNo?: string;
  driverName?: string;
  hsnCode?: string;   // default 998549 — editable per DC
}

function fmt(v: number | undefined) {
  return v == null || isNaN(v) ? "—" : `Rs. ${v.toFixed(2)}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Company logo — loaded once, downscaled for print, cached across DCs.
let dcLogoCache: string | null | undefined;
let dcLogoAspect = 1;   // width / height, refined on load
async function getDcLogo(): Promise<string | null> {
  if (dcLogoCache !== undefined) return dcLogoCache;
  try {
    const img = new Image();
    img.src = "/rustoppers-logo.jpg";
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("logo")); });
    if (img.width && img.height) dcLogoAspect = img.width / img.height;
    const maxW = 320;
    const scale = Math.min(1, maxW / (img.width || maxW));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("ctx");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    dcLogoCache = c.toDataURL("image/jpeg", 0.85);
  } catch { dcLogoCache = null; }
  return dcLogoCache;
}

// Logo palette — background/accents kept compatible with the Rustoppers logo.
const INK: [number, number, number] = [51, 41, 33];       // dark brown-grey text
const ACCENT: [number, number, number] = [234, 130, 40];  // logo orange
const SUBTLE: [number, number, number] = [120, 110, 100]; // muted brown-grey

export async function generateAssetsDC(
  assets: Asset[],
  fromLocation: string,
  toLocation: string,
  movementType: string,
  lineModeOrOptions: DCLineMode | DCOptions | "uuid" | "description" = "individual",
  signatureImg?: string,
  allLocations: Location[] = [],
  companyName = "PLENOVA SUPPLY CHAIN PRIVATE LIMITED",
  createdBy?: string,
  projects: Project[] = []
) {
  if (!assets.length) return;

  // Declared value for an asset on this DC leg: the price of the loop it's on
  // (per its project), falling back to the asset's own unit cost.
  const valueOf = (a: Asset): number => {
    const proj = projects.find((p) => p.id === a.projectId);
    const loop = proj ? resolveLoopCost(proj, fromLocation, toLocation) : null;
    return loop ?? (a.cost ?? 0);
  };

  // Normalise argument
  let lineMode: DCLineMode = "individual";
  let showRFID = false;
  let showBLE  = false;
  let vehicleNo  = "";
  let driverName = "";
  let hsnCode    = "998549";
  if (typeof lineModeOrOptions === "string") {
    lineMode = (lineModeOrOptions === "cumulative" || lineModeOrOptions === "description")
      ? "cumulative" : "individual";
  } else {
    lineMode   = lineModeOrOptions.lineMode  ?? "individual";
    showRFID   = lineModeOrOptions.showRFID  ?? false;
    showBLE    = lineModeOrOptions.showBLE   ?? false;
    vehicleNo  = lineModeOrOptions.vehicleNo  ?? "";
    driverName = lineModeOrOptions.driverName ?? "";
    hsnCode    = lineModeOrOptions.hsnCode    ?? "998549";
  }

  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const COPIES    = ["ORIGINAL", "DUPLICATE", "TRIPLICATE"] as const;
  const HDR: Record<string, [number,number,number]> = {
    ORIGINAL: [30,41,59], DUPLICATE: [30,80,30], TRIPLICATE: [80,30,30],
  };

  const doc   = new jsPDF({ unit: "mm", format: "a4" });
  const W     = 210;
  const mg    = 14;
  const dcNo  = `DC-${Date.now().toString().slice(-7)}`;
  const now   = new Date();
  const fromL = allLocations.find((l) => l.name === fromLocation);
  const toL   = allLocations.find((l) => l.name === toLocation);
  // Assets are registered at (and dispatched from) the Master Warehouse —
  // its organization name & address head the challan.
  const masterWH   = allLocations.find((l) => l.isMasterWarehouse);
  const headOrg     = masterWH?.name || companyName;
  const headAddress = masterWH?.address || "";
  const headGst     = masterWH?.gst || "";

  // ── Group by description (for Option 02) ────────────────────────────────────
  type Group = { name: string; uuids: string[]; rfids: string[]; bles: string[]; unitCost: number };
  function buildGroups(): Group[] {
    const map = new Map<string, Group>();
    assets.forEach((a) => {
      const key = a.description?.trim() || a.name;
      if (!map.has(key)) map.set(key, { name: key, uuids: [], rfids: [], bles: [], unitCost: valueOf(a) });
      const g = map.get(key)!;
      g.uuids.push(a.uuid);
      if (a.rfidTag) g.rfids.push(a.rfidTag);
      if (a.bleTag)  g.bles.push(a.bleTag);
    });
    return [...map.values()];
  }

  const grandTotal = assets.reduce((s, a) => s + valueOf(a), 0);
  const logoUrl = await getDcLogo();

  for (let ci = 0; ci < 3; ci++) {
    if (ci > 0) doc.addPage();
    const lbl = COPIES[ci];
    const clr = HDR[lbl];

    // ── Header band (white — compatible with the logo) ──────────────────────────
    const bandH = 34;
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, W, bandH, "F");

    // Company logo (top-left), true aspect ratio
    const logoH = 18;
    const logoW = logoH * dcLogoAspect;
    if (logoUrl) { try { doc.addImage(logoUrl, "JPEG", mg, 3, logoW, logoH, "dc-logo"); } catch { /* ignore */ } }

    // Organization name + address + GSTIN (centred, dark on white)
    doc.setTextColor(...INK);
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text(headOrg, W / 2, 8, { align: "center" });
    if (headAddress) {
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...SUBTLE);
      const addrLine = headGst ? `${headAddress}  ·  GSTIN: ${headGst}` : headAddress;
      doc.text(addrLine, W / 2, 12.5, { align: "center" });
    }

    // ── Title — "Returnable Delivery Challan" (bold, legible, accent) ──
    doc.setTextColor(...ACCENT);
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Returnable Delivery Challan", W / 2, 20.5, { align: "center" });

    // Meta row: DC No / Date / [COPY], below the logo
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...INK);
    doc.text(`DC No: ${dcNo}`, mg, 29);
    doc.text(`Date: ${now.toLocaleDateString("en-IN")}`, W / 2, 29, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setTextColor(...clr);
    doc.text(`[ ${lbl} COPY ]`, W - mg, 29, { align: "right" });

    // Accent underline keyed to the copy (keeps ORIGINAL / DUPLICATE / TRIPLICATE distinct)
    doc.setDrawColor(...ACCENT); doc.setLineWidth(0.8);
    doc.line(0, bandH - 0.4, W, bandH - 0.4);

    // ── From / To ──────────────────────────────────────────────────────────────
    const half = (W - mg * 2) / 2 - 2;
    const boxH = 30;
    const boxY = bandH + 4;
    doc.setFillColor(241, 245, 249);
    doc.rect(mg, boxY, half, boxH, "F");
    doc.rect(mg + half + 4, boxY, half, boxH, "F");
    doc.setTextColor(30, 41, 59); doc.setFontSize(7); doc.setFont("helvetica", "bold");
    doc.text("CONSIGNOR (FROM)", mg + 2, boxY + 5);
    doc.text("CONSIGNEE (TO)", mg + half + 6, boxY + 5);

    // Party block: organization name, address (wrapped), GST
    const renderParty = (name: string, loc: Location | undefined, x: number) => {
      let py = boxY + 10;
      doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.splitTextToSize(name, half - 4).slice(0, 2).forEach((line: string) => { doc.text(line, x, py); py += 4; });
      doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      if (loc?.address) {
        doc.splitTextToSize(loc.address, half - 4).slice(0, 2).forEach((line: string) => { doc.text(line, x, py); py += 3.5; });
      }
      if (loc?.gst) { doc.setFont("helvetica", "bold"); doc.text(`GSTIN: ${loc.gst}`, x, py); }
    };
    renderParty(fromLocation, fromL, mg + 2);
    renderParty(toLocation, toL, mg + half + 6);

    // ── OPTION 01 — Individual line items ─────────────────────────────────────
    if (lineMode === "individual") {
      const head: string[] = ["#", "Asset Name", "HSN", "UUID / Serial"];
      if (showRFID) head.push("RFID");
      if (showBLE)  head.push("BLE");
      head.push("Unit Price", "Qty", "Total Value");

      const body = assets.map((a, i) => {
        const cost = valueOf(a);
        const row: (string|number)[] = [i + 1, a.name, hsnCode, a.uuid];
        if (showRFID) row.push(a.rfidTag || "");
        if (showBLE)  row.push(a.bleTag  || "");
        row.push(fmt(cost), 1, fmt(cost));
        return row;
      });

      const foot: (string|number)[] = ["", `TOTAL: ${assets.length} asset(s)`, "", ""];
      if (showRFID) foot.push("");
      if (showBLE)  foot.push("");
      foot.push("", assets.length, fmt(grandTotal));

      autoTable(doc, {
        startY: boxY + boxH + 4, head: [head], body, foot: [foot], theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, textColor: [30,41,59] },
        headStyles: { fillColor: [30,41,59], textColor: 255, fontStyle: "bold", fontSize: 8 },
        footStyles: { fillColor: [30,41,59], textColor: 255, fontStyle: "bold", fontSize: 8 },
        columnStyles: { 0: { cellWidth: 8, halign: "center" } },
        margin: { left: mg, right: mg },
      });
    }

    // ── OPTION 02 — Cumulative + serial grid at bottom ────────────────────────
    else {
      const groups = buildGroups();

      // Main table: # | Asset Name | HSN | Unit Price | Qty | Total Value  (NO UUID/RFID/BLE)
      const body02 = groups.map((g, i) => {
        const qty = g.uuids.length;
        return [i + 1, g.name, hsnCode, fmt(g.unitCost), qty, fmt(g.unitCost * qty)];
      });
      const foot02 = ["", `TOTAL: ${assets.length} asset(s)`, "", "", assets.length, fmt(grandTotal)];

      autoTable(doc, {
        startY: boxY + boxH + 4,
        head: [["#", "Asset Name", "HSN", "Unit Price", "Qty", "Total Value"]],
        body: body02, foot: [foot02], theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, textColor: [30,41,59] },
        headStyles: { fillColor: [30,41,59], textColor: 255, fontStyle: "bold", fontSize: 8 },
        footStyles: { fillColor: [30,41,59], textColor: 255, fontStyle: "bold", fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 8, halign: "center" },
          2: { cellWidth: 28, halign: "right" },
          3: { cellWidth: 14, halign: "center" },
          4: { cellWidth: 28, halign: "right" },
        },
        margin: { left: mg, right: mg },
      });

      // ── Assets Serial Details ────────────────────────────────────────────────
      let sy = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

      doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30,41,59);
      doc.text("ASSETS SERIAL DETAILS", mg, sy);
      sy += 3;

      const CHUNK = 8; // serials per row
      groups.forEach((g, gi) => {
        // Group title
        doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(30,41,59);
        doc.text(`${gi + 1}. ${g.name}  (${g.uuids.length} unit${g.uuids.length > 1 ? "s" : ""})`, mg, sy + 4);
        sy += 6;

        // Pad rfids / bles to same length as uuids
        const rfidsPadded = g.uuids.map((_, k) => g.rfids[k] || "");
        const blesPadded  = g.uuids.map((_, k) => g.bles[k]  || "");

        chunk(g.uuids, CHUNK).forEach((uuidChunk, ci2) => {
          const offset = ci2 * CHUNK;
          const rfidChunk = rfidsPadded.slice(offset, offset + CHUNK);
          const bleChunk  = blesPadded.slice(offset, offset + CHUNK);

          // Build rows: first cell = label, rest = values
          const gridBody: (string)[][] = [["UUID", ...uuidChunk]];
          if (showRFID) gridBody.push(["RFID", ...rfidChunk]);
          if (showBLE)  gridBody.push(["BLE",  ...bleChunk]);

          // Column widths: label col fixed, value cols share remaining
          const labelW  = 18;
          const avail   = W - mg * 2 - labelW;
          const valW    = Math.min(avail / uuidChunk.length, 28);
          const colStyles: Record<string, { cellWidth: number; fontStyle?: "bold"|"normal"; fillColor?: [number,number,number] }> = {
            "0": { cellWidth: labelW, fontStyle: "bold", fillColor: [241,245,249] },
          };
          for (let k = 1; k <= uuidChunk.length; k++) colStyles[String(k)] = { cellWidth: valW };

          autoTable(doc, {
            startY: sy,
            body: gridBody,
            theme: "grid",
            styles: { fontSize: 7, cellPadding: 2, textColor: [30,41,59], overflow: "ellipsize" },
            columnStyles: colStyles,
            margin: { left: mg, right: mg },
          });
          sy = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
        });

        sy += 2;
      });

      // Sync position for sections below
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY = sy;
    }

    let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

    const y2 = y;

    // ── Carrier details ───────────────────────────────────────────────────────
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30,41,59);
    doc.text("CARRIER / VEHICLE DETAILS", mg, y2 + 4);
    autoTable(doc, {
      startY: y2 + 7,
      head: [["Vehicle No.", "Driver Name", "Date of Despatch", "Date of Receipt"]],
      body: [[vehicleNo || "", driverName || "", now.toLocaleDateString("en-IN"), ""]],
      theme: "grid", styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [71,85,105], textColor: 255, fontStyle: "bold", fontSize: 8 },
      margin: { left: mg, right: mg },
    });
    const y3 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

    // ── Terms ─────────────────────────────────────────────────────────────────
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(30,41,59);
    doc.text("TERMS & CONDITIONS", mg, y3 + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(71,85,105); doc.setFontSize(7.5);
    ["1. Goods are supplied for returnable packaging services not for sale purpose.",
     "2. Assets must be returned in original condition within the agreed period.",
     "3. Any damage or loss is chargeable at declared unit value.",
    ].forEach((t, i) => doc.text(t, mg, y3 + 10 + i * 4.5));

    // ── Signatures ────────────────────────────────────────────────────────────
    const sigY = Math.max(y3 + 30, 255);
    doc.setDrawColor(203,213,225); doc.setLineWidth(0.4); doc.line(mg, sigY, W - mg, sigY);
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(71,85,105);
    if (signatureImg) { try { doc.addImage(signatureImg, "PNG", mg, sigY + 2, 40, 14); } catch { /**/ } }
    doc.text("Authorised Signatory (Consignor)", mg, sigY + 20);
    doc.text("Signature & Stamp", mg, sigY + 25);
    doc.text("Received By (Consignee)", W - mg - 50, sigY + 14);
    doc.text("Signature & Stamp", W - mg - 50, sigY + 20);
    doc.setFontSize(7); doc.setTextColor(148,163,184);
    doc.text(`${companyName} | ${dcNo} | ${lbl} | ${now.toLocaleString("en-IN")}`, W / 2, 290, { align: "center" });
  }

  doc.save(`${dcNo}.pdf`);
  toast.success(`${dcNo} downloaded — 3 copies (Original / Duplicate / Triplicate)`);

  // ── Save DC log ──────────────────────────────────────────────────────────────
  const groups4log = (() => {
    const map = new Map<string, number>();
    assets.forEach((a) => { const k = a.description?.trim() || a.name; map.set(k, (map.get(k) ?? 0) + 1); });
    return [...map.entries()].map(([n, q]) => `${n} ×${q}`).join(", ");
  })();
  try {
    await addDocument("dc_logs", {
      dcNo,
      createdAt: now.toISOString(),
      fromLocation,
      toLocation,
      movementType,
      description: groups4log || assets[0]?.name || "—",
      qty: assets.length,
      lineMode,
      showRFID,
      showBLE,
      createdBy,
      assetSnapshots: assets.map((a) => ({
        id: a.id, name: a.name, uuid: a.uuid,
        rfidTag: a.rfidTag, bleTag: a.bleTag,
        cost: valueOf(a), description: a.description,
      })),
    } satisfies Omit<DCLog, "id">);
  } catch { /* non-critical */ }
}
