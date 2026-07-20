import type { Asset } from "./types";
import { drawQRVector, type QRMatrix } from "./qr";
import { toast } from "sonner";

/**
 * Asset label — 50mm (L) x 25mm (H)
 *
 * Layout — everything prints black-on-white so it stays crisp on a thermal
 * label printer (no filled colour bands, which print as muddy grey):
 *   ┌───────────────────────────────────────────────┐
 *   │  ┌──────┐   Property of        ┌─────────┐    │
 *   │  │  QR  │   Rustoppers         │  LOGO   │    │
 *   │  │      │   ▌▌▐ ▌▐▐ ▌▌▐ barcode ▌▐ ▌▌▐ ▌▌     │
 *   │  └──────┘        53001 (part no)              │
 *   └───────────────────────────────────────────────┘
 */
export const LABEL_W = 50;   // mm
export const LABEL_H = 25;   // mm

const INK: [number, number, number] = [15, 23, 42];

/**
 * Load the company logo once, downscaled for print.
 * The source JPEG is ~554KB; it prints at ~11x8mm, so a ~260px copy is ample
 * and keeps multi-label PDFs small.
 */
let logoCache: string | null | undefined;
let logoAspect = 5700 / 3900;           // real ratio of Rustoppers_Logo.jpg; refined on load
const LOGO_ALIAS = "rustoppers-logo";   // lets jsPDF embed the image only once
async function getLogo(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const img = new Image();
    img.src = "/Rustoppers_Logo.jpg";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo failed to load"));
    });
    if (img.width && img.height) logoAspect = img.width / img.height;
    const maxW = 260;
    const scale = Math.min(1, maxW / (img.width || maxW));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    logoCache = c.toDataURL("image/jpeg", 0.85);
  } catch {
    logoCache = null;
  }
  return logoCache;
}

/**
 * Code128 bar pattern as booleans (true = dark bar).
 * JsBarcode renders 1px-per-module so we can read the exact pattern off the
 * canvas, then draw it as vectors — crisp at any DPI and far smaller/faster
 * than embedding a bitmap per label.
 */
function barcodePattern(value: string, JsBarcode: typeof import("jsbarcode")): boolean[] | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: "CODE128",
      displayValue: false,   // the part number is printed separately, below the bars
      margin: 0,
      width: 1,              // 1px per module → canvas width == module count
      height: 2,
      background: "#ffffff",
      lineColor: "#000000",
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, canvas.width, 1);
    const out: boolean[] = [];
    for (let i = 0; i < canvas.width; i++) out.push(data[i * 4] < 128); // dark?
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Draw a barcode from its module pattern as vector bars. */
function drawBarcode(doc: import("jspdf").jsPDF, pattern: boolean[], x: number, y: number, w: number, h: number) {
  const unit = w / pattern.length;
  doc.setFillColor(0, 0, 0);
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i]) {
      const start = i;
      while (i < pattern.length && pattern[i]) i++;
      doc.rect(x + start * unit, y, (i - start) * unit, h, "F");
    } else i++;
  }
}


/** The label's "part number" — the asset UUID (what the QR/barcode encode). */
function partNumber(a: Asset): string {
  return a.uuid;
}

interface Rendered { a: Asset; qr: QRMatrix | null; bars: boolean[] | null }

/** Draw one 50x25mm label with its top-left corner at (ox, oy). */
function drawLabel(
  doc: import("jspdf").jsPDF,
  { a, qr, bars }: Rendered,
  ox: number,
  oy: number,
  logoUrl: string | null,
  outline: boolean
) {
  const pn = partNumber(a);

  if (outline) {
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2);
    doc.rect(ox, oy, LABEL_W, LABEL_H, "S");
  }

  // ── QR (left) ──
  const qrSize = 16;
  if (qr) drawQRVector(doc, qr, ox + 1.5, oy + 1.5, qrSize);

  // Right-hand column: everything else lives between the QR and the label edge
  const colX = ox + 1.5 + qrSize + 2;   // left edge of the column
  const colR = ox + LABEL_W - 1.5;      // right edge of the column
  const colW = colR - colX;

  // ── Company logo (top-right) — enlarged for legibility, true aspect ratio ──
  const logoH = 9;
  const logoW = logoH * logoAspect;
  const logoX = colR - logoW;
  const logoBottom = 0.8 + logoH;
  if (logoUrl) {
    // alias → the logo bitmap is stored once and re-referenced by every label
    try { doc.addImage(logoUrl, "JPEG", logoX, oy + 0.8, logoW, logoH, LOGO_ALIAS); } catch { /* ignore */ }
  }

  // ── "Property of Rustoppers" — two lines so it can be set much larger ──
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold"); doc.setFontSize(6);
  doc.text("Property of", colX, oy + 4.4);
  doc.text("Rustoppers", colX, oy + 8.4);

  // ── Barcode — full column width, starting BELOW the logo so they never merge ──
  const barY = oy + logoBottom + 0.9;
  const barH = 7;
  if (bars) drawBarcode(doc, bars, colX, barY, colW, barH);

  // ── Part number — plain bold black text, no background fill ──
  const pnY = barY + barH + 4.4;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(pn, colX + colW / 2, pnY, { align: "center", maxWidth: colW });
}

/**
 * Generate a printable PDF of asset labels.
 * `sheet: true`  → many labels tiled on A4 (for sheet printing)
 * `sheet: false` → one 50x25mm page per label (for a roll/label printer)
 */
export async function generateAssetLabels(
  assets: Asset[],
  title: string,
  opts: { sheet?: boolean } = {}
) {
  if (!assets.length) { toast.error("No assets to label"); return; }
  const sheet = opts.sheet ?? true;

  const QRCode = (await import("qrcode")).default;
  const JsBarcode = (await import("jsbarcode")).default;
  const { jsPDF } = await import("jspdf");
  const logoUrl = await getLogo();

  // Pre-compute the QR matrix + barcode pattern for every asset (vector, not bitmaps)
  const rendered: Rendered[] = assets.map((a) => {
    const pn = partNumber(a);
    let qr: Rendered["qr"] = null;
    try { qr = QRCode.create(pn, { errorCorrectionLevel: "M" }) as unknown as Rendered["qr"]; } catch { /* skip */ }
    return { a, qr, bars: barcodePattern(pn, JsBarcode) };
  });

  let doc: import("jspdf").jsPDF;

  if (sheet) {
    // A4 sheet — tile labels in a grid
    doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const PW = 210, PH = 297, mg = 8, gap = 2;
    const cols = Math.floor((PW - mg * 2 + gap) / (LABEL_W + gap));      // 3
    const rows = Math.floor((PH - mg * 2 + gap) / (LABEL_H + gap));      // 10
    const perPage = cols * rows;

    rendered.forEach((r0, i) => {
      if (i > 0 && i % perPage === 0) doc.addPage();
      const idx = i % perPage;
      const c = idx % cols, r = Math.floor(idx / cols);
      const ox = mg + c * (LABEL_W + gap);
      const oy = mg + r * (LABEL_H + gap);
      drawLabel(doc, r0, ox, oy, logoUrl, true);
    });
  } else {
    // One label per page, exactly 50x25mm — for dedicated label printers
    doc = new jsPDF({ unit: "mm", format: [LABEL_W, LABEL_H], orientation: "landscape", compress: true });
    rendered.forEach((r0, i) => {
      if (i > 0) doc.addPage([LABEL_W, LABEL_H], "landscape");
      drawLabel(doc, r0, 0, 0, logoUrl, false);
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const safe = title.replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  doc.save(`asset-labels-${safe}-${stamp}.pdf`);
  toast.success(`${assets.length} label${assets.length > 1 ? "s" : ""} downloaded`);
}
