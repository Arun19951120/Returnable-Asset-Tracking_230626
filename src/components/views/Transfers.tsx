"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAll, addDocument, updateDocument, logAudit } from "@/lib/storage";
import { Transfer, Asset, Location, Project } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowRightLeft, Plus, X, FileText, Loader2, Download,
  MessageSquare, CheckSquare, Square,
} from "lucide-react";
import FilterBar, { DayRange, filterByDays } from "@/components/ui/FilterBar";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
const TYPE_OPTIONS: Transfer["type"][] = [
  "Outbound Dispatch","Inbound Return","Inter-plant Transfer","Project Transfer","Site-to-Site Transfer",
];
const STATUS_STYLES: Record<Transfer["status"], string> = {
  Pending:"bg-amber-100 text-amber-700", Approved:"bg-sky-100 text-sky-700", Completed:"bg-emerald-100 text-emerald-700",
};
const TYPE_STYLES: Record<Transfer["type"], string> = {
  "Outbound Dispatch":"bg-blue-100 text-blue-700","Inbound Return":"bg-emerald-100 text-emerald-700",
  "Inter-plant Transfer":"bg-purple-100 text-purple-700","Project Transfer":"bg-orange-100 text-orange-700",
  "Site-to-Site Transfer":"bg-slate-100 text-slate-700",
};

// ─── DC number generator ──────────────────────────────────────────────────────
function dcNumber(id: string, prefix = "DC") {
  const seq = id.replace(/\D/g, "").slice(-4).padStart(4, "0");
  const yr  = new Date().getFullYear();
  return `${prefix}-${yr}-${seq}`;
}

const COPY_LABELS = ["ORIGINAL", "DUPLICATE", "TRIPLICATE"] as const;
const COPY_COLORS: Record<string, [number,number,number]> = {
  ORIGINAL:   [30, 41, 59],
  DUPLICATE:  [30, 80, 30],
  TRIPLICATE: [80, 30, 30],
};

// ─── Single DC PDF ────────────────────────────────────────────────────────────
async function generateDC(
  transfer: Transfer,
  allAssets: Asset[],
  locations: Location[],
  comment: string,
  signatureImg?: string,
  companyName = "PLENOVA SUPPLY CHAIN PRIVATE LIMITED"
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, mg = 14;

  const fromLoc = locations.find((l) => l.name === transfer.fromLocation);
  const toLoc   = locations.find((l) => l.name === transfer.toLocation);
  const dcNo    = dcNumber(transfer.id);
  const transferAssets = allAssets.filter((a) => transfer.assetIds.includes(a.id));

  for (let copyIdx = 0; copyIdx < 3; copyIdx++) {
    if (copyIdx > 0) doc.addPage();
    const copyLabel = COPY_LABELS[copyIdx];
    const headerColor = COPY_COLORS[copyLabel];

    // ── Header band ──
    doc.setFillColor(...headerColor);
    doc.rect(0, 0, W, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("DELIVERY CHALLAN", W / 2, 10, { align: "center" });
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text("GOODS DISPATCHED ON RETURNABLE BASIS — NOT FOR SALE", W / 2, 16, { align: "center" });

    // Copy label stamp (top-right)
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(`[ ${copyLabel} COPY ]`, W - mg, 8, { align: "right" });

    // ── DC meta ──
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(`DC No: ${dcNo}`, mg, 29);
    doc.text(`Date: ${new Date(transfer.createdAt).toLocaleDateString("en-IN")}`, mg, 34);
    doc.text(`Type: ${transfer.type}`, mg, 39);
    if (transfer.carrier) doc.text(`Carrier: ${transfer.carrier}`, mg, 44);
    doc.setFont("helvetica", "normal");
    doc.text(`Status: ${transfer.status}`, W - mg, 29, { align: "right" });
    doc.text(`Ref: ${transfer.id.toUpperCase()}`, W - mg, 34, { align: "right" });

    // ── Address block ──
    const addrY = 50;
    doc.setLineWidth(0.3); doc.setDrawColor(203, 213, 225);
    doc.line(mg, addrY, W - mg, addrY);
    const colW = (W - mg * 2 - 10) / 2;
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(100, 116, 139);
    doc.text("FROM (CONSIGNOR)", mg, addrY + 6);
    doc.text("TO (CONSIGNEE)", mg + colW + 10, addrY + 6);
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(companyName, mg, addrY + 12);
    doc.text(transfer.fromLocation, mg + colW + 10, addrY + 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
    const fromLines = doc.splitTextToSize(fromLoc?.address ?? "—", colW);
    const toLines   = doc.splitTextToSize(toLoc?.address   ?? "—", colW);
    doc.text(fromLines, mg, addrY + 17);
    doc.text(toLines,   mg + colW + 10, addrY + 17);

    // ── Asset details table ──
    const tableY = addrY + 30;
    doc.setLineWidth(0.3); doc.line(mg, tableY - 4, W - mg, tableY - 4);
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("ASSET DETAILS", mg, tableY);

    const rows = transferAssets.map((a, i) => [
      i + 1,
      a.description || a.name.split(" ").slice(0, 2).join(" "),
      a.name,
      a.uuid,
      1,
      a.cost ? `₹${a.cost.toLocaleString("en-IN")}` : "—",
      a.cost ? `₹${a.cost.toLocaleString("en-IN")}` : "—",
    ]);
    const totalValue = transferAssets.reduce((s, a) => s + (a.cost ?? 0), 0);

    autoTable(doc, {
      startY: tableY + 3,
      head: [["S.No", "Description", "Asset Name", "UUID / Tag", "Qty", "Unit Value", "Total Value"]],
      body: rows,
      foot: [["", "", "", "", transferAssets.length, "", totalValue ? `₹${totalValue.toLocaleString("en-IN")}` : "—"]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, textColor: [30, 41, 59] },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [241, 245, 249], fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        4: { cellWidth: 12, halign: "center" },
        5: { cellWidth: 24, halign: "right" },
        6: { cellWidth: 24, halign: "right" },
      },
      margin: { left: mg, right: mg },
    });

    let afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    // ── Kit Items Summary ──
    const kitSummary: Record<string, number> = {};
    transferAssets.forEach((a) => {
      (a.kitItems ?? []).forEach((kit) => {
        kitSummary[kit.description] = (kitSummary[kit.description] ?? 0) + kit.qty;
      });
    });
    if (Object.keys(kitSummary).length > 0) {
      doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
      doc.text("KIT ITEMS SUMMARY", mg, afterTable + 4);
      autoTable(doc, {
        startY: afterTable + 7,
        head: [["Kit Description", "Total Qty (Cumulative)"]],
        body: Object.entries(kitSummary).map(([desc, qty]) => [desc, qty]),
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, textColor: [30, 41, 59] },
        headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: "bold", fontSize: 8 },
        margin: { left: mg, right: mg },
      });
      afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }

    // ── Notes block ──
    doc.setLineWidth(0.3); doc.line(mg, afterTable, W - mg, afterTable);
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("TERMS & CONDITIONS / NOTES", mg, afterTable + 6);
    doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105);
    [
      "1. Goods are dispatched on a RETURNABLE basis and are NOT for sale.",
      "2. The consignee must return all assets listed above in good condition within the agreed period.",
      "3. Any damage or loss shall be chargeable to the consignee at declared unit value.",
      "4. Subject to local jurisdiction.",
    ].forEach((note, i) => doc.text(note, mg, afterTable + 12 + i * 5));

    if (comment.trim()) {
      doc.setFont("helvetica", "bolditalic"); doc.setTextColor(30, 41, 59);
      doc.text("Additional Instructions:", mg, afterTable + 34);
      doc.setFont("helvetica", "italic"); doc.setTextColor(71, 85, 105);
      doc.text(doc.splitTextToSize(comment, W - mg * 2), mg, afterTable + 39);
    }
    const afterNotes = afterTable + (comment.trim() ? 52 : 36);

    // ── Receipt Acknowledgement Table ──
    doc.setLineWidth(0.3); doc.line(mg, afterNotes, W - mg, afterNotes);
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("RECEIPT ACKNOWLEDGEMENT", mg, afterNotes + 6);

    const receiptRows = transferAssets.map((a, i) => [
      i + 1,
      a.name,
      a.uuid,
      a.rfidTag || a.bleTag || "—",
      "",   // Received (Y/N) — blank for manual fill
      "",   // Condition — blank
      "",   // Remarks — blank
    ]);
    autoTable(doc, {
      startY: afterNotes + 9,
      head: [["S.No", "Asset Name", "UUID / Serial", "RFID / BLE Tag", "Rcvd (Y/N)", "Condition", "Remarks"]],
      body: receiptRows,
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [30, 41, 59], minCellHeight: 8 },
      headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: "bold", fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        4: { cellWidth: 20, halign: "center" },
        5: { cellWidth: 24 },
        6: { cellWidth: 30 },
      },
      margin: { left: mg, right: mg },
    });
    const afterReceipt = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    // ── Carrier / Vehicle Details ──
    doc.setLineWidth(0.3); doc.line(mg, afterReceipt, W - mg, afterReceipt);
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("CARRIER / VEHICLE DETAILS", mg, afterReceipt + 6);
    const carW = (W - mg * 2) / 4;
    const carY = afterReceipt + 10;
    doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105); doc.setFontSize(7.5);
    [
      ["Vehicle No.:", transfer.carrier || ""],
      ["Driver Name:", ""],
      ["Date of Despatch:", new Date(transfer.createdAt).toLocaleDateString("en-IN")],
      ["Date of Receipt:", ""],
    ].forEach(([label, val], i) => {
      const x = mg + i * carW;
      doc.setFont("helvetica", "bold"); doc.text(label, x, carY);
      doc.setFont("helvetica", "normal"); doc.text(val || "__________________", x, carY + 5);
    });
    const afterCarrier = carY + 12;

    // ── Signature block ──
    const sigY = Math.max(afterCarrier + 6, 255);
    doc.setLineWidth(0.3); doc.line(mg, sigY, W - mg, sigY);
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105);
    if (signatureImg) {
      try { doc.addImage(signatureImg, "PNG", mg, sigY + 2, 40, 14); } catch { /* ignore */ }
    }
    doc.text("Authorised Signatory (Consignor)", mg, sigY + 18);
    doc.text("Received By (Consignee)", W - mg - 50, sigY + 14);
    doc.text("Signature & Stamp", mg, sigY + 22);
    doc.text("Signature & Stamp", W - mg - 50, sigY + 20);

    // ── Footer ──
    doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text(`${companyName} | ${dcNo} | ${copyLabel} | Generated: ${new Date().toLocaleString("en-IN")}`, W / 2, 290, { align: "center" });
  }

  doc.save(`${dcNo}.pdf`);
  toast.success(`${dcNo} downloaded (3 copies)`);
}

// ─── Bulk DC PDF ──────────────────────────────────────────────────────────────
async function generateBulkDC(
  selectedTransfers: Transfer[],
  allAssets: Asset[],
  locations: Location[],
  comment: string,
  signatureImg?: string,
  companyName = "PLENOVA SUPPLY CHAIN PRIVATE LIMITED"
) {
  const { jsPDF } = await import("jspdf");
  const autoTable   = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, mg = 14;

  const bulkDCNo = `BDC-${new Date().getFullYear()}-${String(selectedTransfers.length).padStart(3,"0")}${Date.now().toString().slice(-3)}`;
  const allAssetIds = [...new Set(selectedTransfers.flatMap((t) => t.assetIds))];
  const txAssets = allAssets.filter((a) => allAssetIds.includes(a.id));

  // Group by description
  const grouped: Record<string, { qty: number; unitCost: number; uuids: string[] }> = {};
  txAssets.forEach((a) => {
    const key = a.description || a.name.split(" ").slice(0,2).join(" ");
    if (!grouped[key]) grouped[key] = { qty: 0, unitCost: a.cost ?? 0, uuids: [] };
    grouped[key].qty++;
    grouped[key].uuids.push(a.uuid);
  });

  const grandTotal = Object.values(grouped).reduce((s, g) => s + g.qty * g.unitCost, 0);

  const masterWH = locations.find((l) => l.isMasterWarehouse);

  for (let copyIdx = 0; copyIdx < 3; copyIdx++) {
    if (copyIdx > 0) doc.addPage();
    const copyLabel = COPY_LABELS[copyIdx];
    const headerColor = COPY_COLORS[copyLabel];

    // ── Header ──
    doc.setFillColor(...headerColor);
    doc.rect(0, 0, W, 22, "F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("CONSOLIDATED DELIVERY CHALLAN", W/2, 10, { align:"center" });
    doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text("GOODS DISPATCHED ON RETURNABLE BASIS — NOT FOR SALE", W/2, 16, { align:"center" });
    doc.setFontSize(9); doc.setFont("helvetica","bold");
    doc.text(`[ ${copyLabel} COPY ]`, W - mg, 8, { align: "right" });

    doc.setTextColor(30,41,59);
    doc.setFontSize(9); doc.setFont("helvetica","bold");
    doc.text(`Bulk DC No: ${bulkDCNo}`, mg, 29);
    doc.text(`Date: ${new Date().toLocaleDateString("en-IN")}`, mg, 34);
    doc.text(`Transfers Covered: ${selectedTransfers.length}`, mg, 39);
    doc.setFont("helvetica","normal");
    doc.text(`Total Assets: ${allAssetIds.length}`, W-mg, 29, { align:"right" });
    doc.text(`Total Value: ₹${grandTotal.toLocaleString("en-IN")}`, W-mg, 34, { align:"right" });

    // ── From address ──
    doc.setLineWidth(0.3); doc.setDrawColor(203,213,225);
    doc.line(mg, 46, W-mg, 46);
    doc.setFontSize(8); doc.setFont("helvetica","bold"); doc.setTextColor(100,116,139);
    doc.text("CONSIGNOR (MASTER WAREHOUSE)", mg, 52);
    doc.setTextColor(30,41,59); doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text(companyName, mg, 57);
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(71,85,105);
    doc.text(masterWH?.name ?? "Master Warehouse", mg, 62);
    doc.text(masterWH?.address ?? "—", mg, 67);

    // ── Consolidated asset summary ──
    const sumY = 74;
    doc.setLineWidth(0.3); doc.line(mg, sumY, W-mg, sumY);
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(30,41,59);
    doc.text("CONSOLIDATED ASSET SUMMARY (By Description)", mg, sumY+6);

    const summaryRows = Object.entries(grouped).map(([desc, g], i) => [
      i + 1, desc, g.qty,
      g.unitCost ? `₹${g.unitCost.toLocaleString("en-IN")}` : "—",
      g.unitCost ? `₹${(g.qty * g.unitCost).toLocaleString("en-IN")}` : "—",
      g.uuids.slice(0,3).join(", ") + (g.uuids.length > 3 ? ` +${g.uuids.length-3} more` : ""),
    ]);

    autoTable(doc, {
      startY: sumY + 9,
      head: [["S.No","Description","Total Qty","Unit Value","Total Value","Asset UUIDs (sample)"]],
      body: summaryRows,
      foot: [["","GRAND TOTAL", allAssetIds.length, "", grandTotal ? `₹${grandTotal.toLocaleString("en-IN")}` : "—", ""]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, textColor: [30,41,59] },
      headStyles: { fillColor: [30,41,59], textColor: 255, fontStyle: "bold", fontSize:8 },
      footStyles: { fillColor: [30,41,59], textColor: 255, fontStyle:"bold", fontSize:8 },
      columnStyles: {
        0: { cellWidth: 10, halign:"center" },
        2: { cellWidth: 18, halign:"center" },
        3: { cellWidth: 26, halign:"right" },
        4: { cellWidth: 26, halign:"right" },
      },
      margin: { left: mg, right: mg },
    });

    let afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    // ── Kit Items Cumulative Summary ──
    const kitSummary: Record<string, number> = {};
    txAssets.forEach((a) => {
      (a.kitItems ?? []).forEach((kit) => {
        kitSummary[kit.description] = (kitSummary[kit.description] ?? 0) + kit.qty;
      });
    });
    if (Object.keys(kitSummary).length > 0) {
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(30,41,59);
      doc.text("KIT ITEMS SUMMARY", mg, afterSummary+4);
      autoTable(doc, {
        startY: afterSummary + 7,
        head: [["Kit Description", "Total Cumulative Qty"]],
        body: Object.entries(kitSummary).map(([desc, qty]) => [desc, qty]),
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, textColor: [30,41,59] },
        headStyles: { fillColor: [71,85,105], textColor: 255, fontStyle:"bold", fontSize:8 },
        margin: { left: mg, right: mg },
      });
      afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }

    // ── Individual transfer breakdown ──
    doc.setLineWidth(0.3); doc.line(mg, afterSummary, W-mg, afterSummary);
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(30,41,59);
    doc.text("INDIVIDUAL TRANSFER DETAILS", mg, afterSummary+6);

    const txRows = selectedTransfers.map((t, i) => [
      i + 1, dcNumber(t.id), t.type, t.fromLocation, t.toLocation, t.assetIds.length, t.carrier || "—", t.status,
    ]);

    autoTable(doc, {
      startY: afterSummary + 9,
      head: [["#","DC Ref","Type","From","To","Assets","Carrier","Status"]],
      body: txRows,
      theme: "striped",
      styles: { fontSize: 7.5, cellPadding: 1.5, textColor:[30,41,59] },
      headStyles: { fillColor:[71,85,105], textColor:255, fontSize:7.5 },
      margin: { left: mg, right: mg },
    });

    const afterTx = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    // ── Notes ──
    doc.setLineWidth(0.3); doc.line(mg, afterTx, W-mg, afterTx);
    doc.setFontSize(8); doc.setFont("helvetica","bold"); doc.setTextColor(30,41,59);
    doc.text("TERMS & CONDITIONS", mg, afterTx+6);
    doc.setFont("helvetica","normal"); doc.setTextColor(71,85,105);
    [
      "1. All goods in this consolidated challan are dispatched on a RETURNABLE basis and are NOT for sale.",
      "2. Assets must be returned in good condition within the agreed period by respective consignees.",
      "3. Any damage or loss is chargeable at declared unit value per the asset summary above.",
    ].forEach((n,i) => doc.text(n, mg, afterTx+12+i*5));
    if (comment.trim()) {
      doc.setFont("helvetica","bolditalic"); doc.setTextColor(30,41,59);
      doc.text("Additional Instructions:", mg, afterTx+30);
      doc.setFont("helvetica","italic"); doc.setTextColor(71,85,105);
      doc.text(doc.splitTextToSize(comment, W-mg*2), mg, afterTx+35);
    }

    // ── Signature block ──
    const sigY = Math.max(afterTx + 48, 235);
    doc.setLineWidth(0.3); doc.line(mg, sigY, W-mg, sigY);
    doc.setFontSize(8); doc.setFont("helvetica","normal"); doc.setTextColor(71,85,105);
    if (signatureImg) {
      try { doc.addImage(signatureImg, "PNG", mg, sigY + 2, 40, 14); } catch { /* ignore */ }
    }
    doc.text("Authorised Signatory (Consignor)", mg, sigY + 18);
    doc.text("Received By (Consignee)", W - mg - 50, sigY + 14);
    doc.text("Signature & Stamp", mg, sigY + 22);
    doc.text("Signature & Stamp", W - mg - 50, sigY + 20);

    // ── Footer ──
    doc.setFontSize(7); doc.setTextColor(148,163,184);
    doc.text(`${companyName} | ${bulkDCNo} | ${copyLabel} | Generated: ${new Date().toLocaleString("en-IN")}`, W/2, 290, { align:"center" });
  }

  doc.save(`${bulkDCNo}.pdf`);
  toast.success(`${bulkDCNo} (${selectedTransfers.length} transfers) downloaded`);
}

// ─── Comment Popup ────────────────────────────────────────────────────────────
function DCCommentDialog({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: (comment: string, signatureImg?: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const [signatureImg, setSignatureImg] = useState<string | undefined>();
  const [sigName, setSigName] = useState("");

  function handleSigUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSigName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setSignatureImg(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <MessageSquare className="h-5 w-5 text-slate-500" />
          <div>
            <h3 className="font-semibold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-400">Generates 3 copies: Original, Duplicate & Triplicate</p>
          </div>
          <button onClick={onCancel} className="ml-auto"><X className="h-4 w-4 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Default notes preview */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Default notes (always printed)</p>
            {[
              "Goods are dispatched on a RETURNABLE basis and are NOT for sale.",
              "Assets must be returned in good condition within the agreed period.",
              "Any damage or loss chargeable at declared unit value.",
            ].map((n, i) => (
              <p key={i} className="text-xs text-slate-500">{i + 1}. {n}</p>
            ))}
          </div>

          {/* Signature upload */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Authorised Signatory (optional)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 hover:border-slate-400 hover:bg-slate-50">
              <Download className="h-4 w-4 text-slate-400 rotate-180" />
              <span className="text-xs text-slate-500">{sigName || "Upload signature image (PNG/JPG)"}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleSigUpload} />
            </label>
            {signatureImg && (
              <div className="mt-2 flex items-center gap-2">
                <img src={signatureImg} alt="Signature preview" className="h-10 rounded border border-slate-200 bg-white p-1" />
                <button onClick={() => { setSignatureImg(undefined); setSigName(""); }} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Additional Instructions / Comments
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Please ensure assets are inspected before acceptance."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 resize-none"
            />
            <p className="mt-1 text-[10px] text-slate-400">{comment.length}/500 characters</p>
          </div>
          <div className="flex gap-3">
            <button onClick={onCancel}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={() => onConfirm(comment, signatureImg)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              <FileText className="h-4 w-4" /> Generate DC (3 Copies)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Transfers View ──────────────────────────────────────────────────────
export default function Transfers() {
  const { profile } = useAuth();
  const [transfers, setTransfers]   = useState<Transfer[]>([]);
  const [assets,    setAssets]      = useState<Asset[]>([]);
  const [locations, setLocations]   = useState<Location[]>([]);
  const [projects,  setProjects]    = useState<Project[]>([]);
  const [dayRange,  setDayRange]    = useState<DayRange>("all");
  const [locFilter, setLocFilter]   = useState("");
  const [typeFilter,setTypeFilter]  = useState("All");
  const [showForm,  setShowForm]    = useState(false);
  const [saving,    setSaving]      = useState(false);

  // Selection for bulk DC
  const [selected, setSelected] = useState<string[]>([]);

  // Comment dialog state
  const [dcTarget, setDcTarget] = useState<{ transfers: Transfer[]; isBulk: boolean } | null>(null);

  const [form, setForm] = useState({
    type: "Outbound Dispatch" as Transfer["type"],
    fromLocation: "", toLocation: "", carrier: "", notes: "", assetIds: [] as string[], projectId: "",
  });

  const load = useCallback(async () => {
    const [t, a, l, p] = await Promise.all([
      fetchAll<Transfer>("transfers"), fetchAll<Asset>("assets"),
      fetchAll<Location>("locations"), fetchAll<Project>("projects"),
    ]);
    setTransfers(t.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setAssets(a); setLocations(l.filter((l) => l.status === "Active")); setProjects(p.filter((p) => p.status === "Active"));
  }, []);

  useEffect(() => { load(); }, [load]);

  const projectAssets = form.projectId ? assets.filter((a) => a.projectId === form.projectId) : assets;

  const filtered = filterByDays(transfers, dayRange).filter((t) => {
    const matchLoc  = !locFilter   || t.fromLocation === locFilter || t.toLocation === locFilter;
    const matchType = typeFilter === "All" || t.type === typeFilter;
    return matchLoc && matchType;
  });

  function toggleAsset(id: string) {
    setForm((p) => ({ ...p, assetIds: p.assetIds.includes(id) ? p.assetIds.filter((x) => x !== id) : [...p.assetIds, id] }));
  }
  function toggleSelect(id: string) {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.assetIds.length) { toast.error("Select at least one asset"); return; }
    setSaving(true);
    try {
      await addDocument("transfers", { ...form, status: "Pending", dcGenerated: false, createdBy: profile?.uid ?? "" });
      await logAudit({ userId: profile?.uid ?? "", userEmail: profile?.email ?? "", action: `Transfer: ${form.type} · ${form.fromLocation} → ${form.toLocation}`, category: "Transfer", details: form.assetIds.join(", ") });
      toast.success("Transfer created");
      setShowForm(false); setForm({ type:"Outbound Dispatch", fromLocation:"", toLocation:"", carrier:"", notes:"", assetIds:[], projectId:"" }); load();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  }

  async function advanceStatus(t: Transfer) {
    const next: Record<Transfer["status"], Transfer["status"]> = { Pending:"Approved", Approved:"Completed", Completed:"Completed" };
    if (next[t.status] === t.status) return;
    await updateDocument("transfers", t.id, { status: next[t.status] });
    toast.success(`Marked as ${next[t.status]}`); load();
  }

  // Open comment dialog then generate
  function openDC(t: Transfer) { setDcTarget({ transfers: [t], isBulk: false }); }
  function openBulkDC() {
    const sel = transfers.filter((t) => selected.includes(t.id));
    if (!sel.length) { toast.error("Select at least one transfer"); return; }
    setDcTarget({ transfers: sel, isBulk: true });
  }

  async function handleDCConfirm(comment: string, signatureImg?: string) {
    if (!dcTarget) return;
    if (dcTarget.isBulk) {
      await generateBulkDC(dcTarget.transfers, assets, locations, comment, signatureImg);
    } else {
      await generateDC(dcTarget.transfers[0], assets, locations, comment, signatureImg);
    }
    setDcTarget(null);
  }

  const locationNames = locations.map((l) => l.name);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Transfers</h1>
          <p className="text-sm text-slate-500">{filtered.length} of {transfers.length} transfers</p>
        </div>
        <div className="flex gap-2">
          {selected.length > 0 && (
            <button onClick={openBulkDC}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <FileText className="h-4 w-4" /> Bulk DC ({selected.length})
            </button>
          )}
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            <Plus className="h-4 w-4" /> New Transfer
          </button>
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        dayRange={dayRange} onDayRangeChange={setDayRange}
        locationFilter={locFilter} locations={locationNames} onLocationChange={setLocFilter}
        extraFilters={
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 outline-none">
            <option value="All">All Types</option>
            {TYPE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
          </select>
        }
      />

      {/* Bulk DC hint */}
      {selected.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-700">
          <CheckSquare className="h-4 w-4 text-blue-500" />
          <span><strong>{selected.length} transfer{selected.length > 1 ? "s" : ""}</strong> selected — click "Bulk DC" to generate a consolidated Delivery Challan.</span>
          <button onClick={() => setSelected([])} className="ml-auto underline">Clear</button>
        </div>
      )}

      {/* Transfer list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-400">No transfers found</div>
        )}
        {filtered.map((t) => {
          const isSelected = selected.includes(t.id);
          return (
            <div key={t.id}
              className={`flex items-start gap-3 rounded-xl border bg-white px-4 py-4 transition-colors ${isSelected ? "border-slate-400 bg-slate-50" : "border-slate-200"}`}>
              {/* Checkbox for bulk DC */}
              <button onClick={() => toggleSelect(t.id)} className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700">
                {isSelected ? <CheckSquare className="h-4 w-4 text-slate-700" /> : <Square className="h-4 w-4" />}
              </button>

              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                <ArrowRightLeft className="h-4 w-4 text-slate-600" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[t.type]}`}>{t.type}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status]}`}>{t.status}</span>
                </div>
                <p className="text-sm font-semibold text-slate-800 mt-1">{t.fromLocation} → {t.toLocation}</p>
                <p className="text-xs text-slate-400 font-mono">
                  {t.assetIds.length} asset{t.assetIds.length !== 1 ? "s" : ""}
                  {" · "}
                  {new Date(t.createdAt).toLocaleDateString("en-IN")}
                  {t.carrier && ` · ${t.carrier}`}
                </p>
                {t.notes && <p className="mt-1 text-xs italic text-slate-400">{t.notes}</p>}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openDC(t)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  <FileText className="h-3.5 w-3.5" /> DC
                </button>
                {t.status !== "Completed" && (
                  <button onClick={() => advanceStatus(t)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    {t.status === "Pending" ? "Approve" : "Complete"} →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Transfer Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h3 className="font-semibold text-slate-900">New Transfer</h3>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Transfer Type</label>
                <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as Transfer["type"] }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                  {TYPE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Filter Assets by Project</label>
                <select value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value, assetIds: [] }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                  <option value="">All Projects</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">From Location</label>
                  <select required value={form.fromLocation} onChange={(e) => setForm((p) => ({ ...p, fromLocation: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    <option value="">Select…</option>{locationNames.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">To Location</label>
                  <select required value={form.toLocation} onChange={(e) => setForm((p) => ({ ...p, toLocation: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500">
                    <option value="">Select…</option>{locationNames.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Carrier (optional)</label>
                <input value={form.carrier} onChange={(e) => setForm((p) => ({ ...p, carrier: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-600">
                  Select Assets ({form.assetIds.length} selected)
                </label>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
                  {projectAssets.map((a) => (
                    <label key={a.id} className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50 ${form.assetIds.includes(a.id) ? "bg-slate-50" : ""}`}>
                      <input type="checkbox" checked={form.assetIds.includes(a.id)} onChange={() => toggleAsset(a.id)} className="rounded" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                        <p className="font-mono text-xs text-slate-400">{a.uuid} · {a.location}</p>
                      </div>
                      {a.cost ? <span className="text-xs font-mono text-slate-500 shrink-0">₹{a.cost.toLocaleString("en-IN")}</span> : null}
                    </label>
                  ))}
                </div>
                {form.assetIds.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500 font-mono">
                    Total declared value: ₹{assets
                      .filter((a) => form.assetIds.includes(a.id))
                      .reduce((s, a) => s + (a.cost ?? 0), 0)
                      .toLocaleString("en-IN")}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DC Comment Popup */}
      {dcTarget && (
        <DCCommentDialog
          title={dcTarget.isBulk ? `Bulk DC — ${dcTarget.transfers.length} transfers` : `DC — ${dcTarget.transfers[0].fromLocation} → ${dcTarget.transfers[0].toLocation}`}
          onConfirm={handleDCConfirm}
          onCancel={() => setDcTarget(null)}
        />
      )}
    </div>
  );
}
