import type { Asset } from "./types";
import { toast } from "sonner";

/** Encode an asset UUID as a QR data-URL (shared by the single-asset modal & bulk sheet). */
export async function buildQRDataUrl(uuid: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  // Encode UUID only as per requirement
  return QRCode.toDataURL(uuid, { width: 256, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
}

/**
 * Mass QR download — renders a printable A4 PDF sheet of QR codes
 * (one labelled cell per asset) for the given assets.
 */
export async function generateQRSheet(assets: Asset[], title: string) {
  if (!assets.length) { toast.error("No assets to generate QR codes for"); return; }

  const QRCode = (await import("qrcode")).default;
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, mg = 12;
  const COLS = 3;
  const cellW = (W - mg * 2) / COLS;   // 62mm
  const cellH = 62;
  const qrSize = 36;
  const now = new Date();

  function header(pageNo: number, pages: number) {
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, W, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text(title, mg, 9);
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
    doc.text(`${assets.length} asset${assets.length > 1 ? "s" : ""}  ·  ${now.toLocaleDateString("en-IN")}`, mg, 15);
    doc.text(`Page ${pageNo} of ${pages}`, W - mg, 15, { align: "right" });
  }

  const startY = 26;
  const rowsPerPage = Math.floor((H - startY - mg) / cellH);
  const perPage = rowsPerPage * COLS;
  const pages = Math.ceil(assets.length / perPage);

  for (let i = 0; i < assets.length; i++) {
    const pageIdx = Math.floor(i / perPage);
    const idxOnPage = i % perPage;

    if (idxOnPage === 0) {
      if (pageIdx > 0) doc.addPage();
      header(pageIdx + 1, pages);
    }

    const col = idxOnPage % COLS;
    const row = Math.floor(idxOnPage / COLS);
    const x = mg + col * cellW;
    const y = startY + row * cellH;

    const a = assets[i];

    // Cell border
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3);
    doc.roundedRect(x + 1, y, cellW - 2, cellH - 4, 2, 2, "S");

    // QR image (centred)
    try {
      const url = await QRCode.toDataURL(a.uuid, { width: 256, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
      doc.addImage(url, "PNG", x + (cellW - qrSize) / 2, y + 4, qrSize, qrSize);
    } catch { /* skip unrenderable code */ }

    // UUID (bold, monospace-ish)
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8); doc.setFont("courier", "bold");
    doc.text(a.uuid, x + cellW / 2, y + qrSize + 9, { align: "center", maxWidth: cellW - 6 });

    // Asset name (wrapped, max 2 lines)
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    const lines = doc.splitTextToSize(a.name ?? "", cellW - 6).slice(0, 2) as string[];
    lines.forEach((ln, k) => doc.text(ln, x + cellW / 2, y + qrSize + 13.5 + k * 3, { align: "center" }));
  }

  const stamp = now.toISOString().slice(0, 10);
  const safe = title.replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  doc.save(`qr-codes-${safe}-${stamp}.pdf`);
  toast.success(`QR sheet downloaded — ${assets.length} code${assets.length > 1 ? "s" : ""}`);
}
