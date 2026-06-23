import type { Asset, Location, DCLog } from "@/lib/types";
import { addDocument } from "@/lib/storage";
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

export async function generateAssetsDC(
  assets: Asset[],
  fromLocation: string,
  toLocation: string,
  movementType: string,
  lineModeOrOptions: DCLineMode | DCOptions | "uuid" | "description" = "individual",
  signatureImg?: string,
  allLocations: Location[] = [],
  companyName = "PLENOVA SUPPLY CHAIN PRIVATE LIMITED",
  createdBy?: string
) {
  if (!assets.length) return;

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

  // ── Group by description (for Option 02) ────────────────────────────────────
  type Group = { name: string; uuids: string[]; rfids: string[]; bles: string[]; unitCost: number };
  function buildGroups(): Group[] {
    const map = new Map<string, Group>();
    assets.forEach((a) => {
      const key = a.description?.trim() || a.name;
      if (!map.has(key)) map.set(key, { name: key, uuids: [], rfids: [], bles: [], unitCost: a.cost ?? 0 });
      const g = map.get(key)!;
      g.uuids.push(a.uuid);
      if (a.rfidTag) g.rfids.push(a.rfidTag);
      if (a.bleTag)  g.bles.push(a.bleTag);
    });
    return [...map.values()];
  }

  const grandTotal = assets.reduce((s, a) => s + (a.cost ?? 0), 0);

  for (let ci = 0; ci < 3; ci++) {
    if (ci > 0) doc.addPage();
    const lbl = COPIES[ci];
    const clr = HDR[lbl];

    // ── Header band ────────────────────────────────────────────────────────────
    doc.setFillColor(...clr);
    doc.rect(0, 0, W, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text(companyName, W / 2, 9, { align: "center" });
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Asset Movement Delivery Challan — ${movementType}`, W / 2, 15, { align: "center" });
    doc.setFontSize(8);
    doc.text(`DC No: ${dcNo}`, mg, 22);
    doc.text(`Date: ${now.toLocaleDateString("en-IN")}`, W / 2, 22, { align: "center" });
    doc.text(`[ ${lbl} COPY ]`, W - mg, 22, { align: "right" });

    // ── From / To ──────────────────────────────────────────────────────────────
    const half = (W - mg * 2) / 2 - 2;
    doc.setFillColor(241, 245, 249);
    doc.rect(mg, 32, half, 22, "F");
    doc.rect(mg + half + 4, 32, half, 22, "F");
    doc.setTextColor(30, 41, 59); doc.setFontSize(7); doc.setFont("helvetica", "bold");
    doc.text("CONSIGNOR (FROM)", mg + 2, 37);
    doc.text("CONSIGNEE (TO)", mg + half + 6, 37);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(fromLocation, mg + 2, 43);
    if (fromL?.address) doc.text(fromL.address.slice(0, 45), mg + 2, 48);
    doc.text(toLocation, mg + half + 6, 43);
    if (toL?.address) doc.text(toL.address.slice(0, 45), mg + half + 6, 48);

    // ── OPTION 01 — Individual line items ─────────────────────────────────────
    if (lineMode === "individual") {
      const head: string[] = ["#", "Asset Name", "HSN", "UUID / Serial"];
      if (showRFID) head.push("RFID");
      if (showBLE)  head.push("BLE");
      head.push("Unit Price", "Qty", "Total Value");

      const body = assets.map((a, i) => {
        const cost = a.cost ?? 0;
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
        startY: 58, head: [head], body, foot: [foot], theme: "grid",
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
        startY: 58,
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
        cost: a.cost, description: a.description,
      })),
    } satisfies Omit<DCLog, "id">);
  } catch { /* non-critical */ }
}
