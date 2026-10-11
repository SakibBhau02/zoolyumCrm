import { jsPDF } from "jspdf";
import { API_URL } from "./api";
import { numberToWords } from "./invoice-utils";

export interface PdfInvoiceLine {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  amount?: number | string;
}

export interface PdfInvoiceContact {
  name?: string;
  email?: string | null;
  phone?: string | null;
  roleTitle?: string | null;
}

export interface PdfPayment {
  amount?: number | string;
  paymentMethod?: string | null;
  paymentDate?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  recordedBy?: { name?: string } | null;
}

export interface PdfInvoice {
  invoiceNumber: string;
  issueDate?: string | null;
  dueDate?: string | null;
  status?: string | null;
  currency?: string | null;
  taxApplicable?: boolean | null;
  taxRate?: number | string | null;
  discountRate?: number | string | null;
  shippingFee?: number | string | null;
  templateStyle?: string | null;
  terms?: string | null;
  notes?: string | null;
  paymentDetails?: Record<string, any> | null;
  client?: {
    companyName?: string;
    address?: string | null;
    taxId?: string | null;
    contacts?: PdfInvoiceContact[] | null;
  } | null;
  project?: { name?: string } | null;
  lineItems?: PdfInvoiceLine[];
  payments?: PdfPayment[];
  /** public invoice URL — encoded as the QR code (bottom-right of the sheet) */
  shareUrl?: string | null;
  /** pre-rendered QR PNG data URL (built in buildInvoicePdfAsync) */
  qrDataUrl?: string | null;
  projectBalance?: {
    value?: number | null;
    paid?: number | null;
    due?: number | null;
    project?: { name?: string } | null;
    invoices?: { invoiceNumber?: string | null; status?: string | null; invoiceType?: string | null; title?: string | null; amount?: number | string | null }[] | null;
    payments?: { amount?: number | string | null; paymentDate?: string | null; invoiceNumber?: string | null }[] | null;
  } | null;
}

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;
const W = PAGE_W - M * 2;
const RM = PAGE_W - M;
const INK: [number, number, number] = [15, 23, 42];
const SLATE: [number, number, number] = [71, 85, 105];
const FAINT: [number, number, number] = [100, 116, 139];
const FAINTER: [number, number, number] = [148, 163, 184];

/**
 * Fit natural image dimensions inside a box, preserving aspect ratio.
 * Falls back to the full box when dimensions are unknown.
 */
export function fitImageBox(natW: number, natH: number, maxW: number, maxH: number): { w: number; h: number } {
  if (!Number.isFinite(natW) || !Number.isFinite(natH) || natW <= 0 || natH <= 0) return { w: maxW, h: maxH };
  const s = Math.min(maxW / natW, maxH / natH);
  return { w: Math.max(natW * s, 0.5), h: Math.max(natH * s, 0.5) };
}

// ── Embedded body font (Bengali ৳ support) ─────────────────────────────
// Helvetica (jsPDF built-in) has no U+09F3 glyph — amounts rendered as "ó".
// Hind Siliguri is fetched once from /fonts, embedded per-document, and used
// for the whole sheet so Latin + Bengali share one consistent typeface.
// If loading fails (offline), BODY_FONT stays Helvetica and PDFs still build.
const TAKA_FONT = "hind-siliguri";
let BODY_FONT: string = "helvetica";
let takaFontCache: { regular: string; bold: string } | null = null;
let takaFontFailed = false;

export async function ensurePdfFonts(): Promise<boolean> {
  if (takaFontCache) return true;
  if (takaFontFailed || typeof fetch === "undefined") return false;
  try {
    const [reg, bold] = await Promise.all([
      fetch("/fonts/HindSiliguri-Regular.ttf").then((r) => {
        if (!r.ok) throw new Error("font 404");
        return r.arrayBuffer();
      }),
      fetch("/fonts/HindSiliguri-Bold.ttf").then((r) => {
        if (!r.ok) throw new Error("font 404");
        return r.arrayBuffer();
      }),
    ]);
    takaFontCache = { regular: arrayBufferToBase64(reg), bold: arrayBufferToBase64(bold) };
    BODY_FONT = TAKA_FONT;
    return true;
  } catch {
    takaFontFailed = true;
    return false;
  }
}

export function registerPdfFonts(doc: jsPDF): void {
  if (!takaFontCache || (doc as any).__takaRegistered) return;
  doc.addFileToVFS("HindSiliguri-Regular.ttf", takaFontCache.regular);
  doc.addFileToVFS("HindSiliguri-Bold.ttf", takaFontCache.bold);
  doc.addFont("HindSiliguri-Regular.ttf", TAKA_FONT, "normal");
  doc.addFont("HindSiliguri-Regular.ttf", TAKA_FONT, "italic");
  doc.addFont("HindSiliguri-Bold.ttf", TAKA_FONT, "bold");
  doc.addFont("HindSiliguri-Bold.ttf", TAKA_FONT, "bolditalic");
  (doc as any).__takaRegistered = true;
}

export interface InvoiceBranding {
  primaryColor?: string | null;
  logoDarkUrl?: string | null;
  logoBase64?: string | null;
  appName?: string | null;
  tagline?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  taxId?: string | null;
  website?: string | null;
  authorizedSignerName?: string | null;
  authorizedSignerTitle?: string | null;
  signatureImageUrl?: string | null;
  signatureBase64?: string | null;
  defaultPaymentDetails?: Record<string, any> | null;
  defaultCurrency?: string | null;
  defaultNotes?: string | null;
  defaultTerms?: string | null;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = (hex ?? "").trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(h)) return null;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function resolveAccent(branding?: InvoiceBranding | null, style?: string | null): [number, number, number] {
  if (branding?.primaryColor) {
    const rgb = hexToRgb(branding.primaryColor);
    if (rgb) return rgb;
  }
  if (style === "classic-corporate") return [37, 99, 235];
  if (style === "zoolyum-dark") return [24, 24, 27];
  return [234, 88, 12];
}

function resolveAppName(branding?: InvoiceBranding | null): string {
  const n = branding?.appName?.trim();
  return n ? n : "ZOOLYUM";
}

function currencySymbol(code?: string | null): string {
  switch ((code ?? "BDT").toUpperCase()) {
    case "BDT": return "৳";
    case "USD": return "$";
    case "EUR": return "€";
    case "GBP": return "£";
    case "INR": return "₹";
    default: return code ?? "৳";
  }
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money2 = (v: any) => num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateOnly = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

type Totals = { subtotal: number; tax: number; discount: number; shipping: number; grand: number; paid: number; due: number };

function calcTotals(inv: PdfInvoice): Totals {
  const subtotal = (inv.lineItems ?? []).reduce((s, l) => s + num(l.amount), 0);
  const tax = inv.taxApplicable && num(inv.taxRate) ? (subtotal * num(inv.taxRate)) / 100 : 0;
  const discount = num(inv.discountRate) ? (subtotal * num(inv.discountRate)) / 100 : 0;
  const shipping = num(inv.shippingFee);
  const grand = Math.max(0, subtotal + tax - discount + shipping);
  const paid = (inv.payments ?? []).reduce((s, p) => s + num(p.amount), 0);
  return { subtotal, tax, discount, shipping, grand, paid, due: Math.max(grand - paid, 0) };
}

function statusBadge(doc: jsPDF, statusRaw: string | null | undefined, x: number, y: number) {
  const s = (statusRaw ?? "DRAFT").toUpperCase();
  let bg: [number, number, number] = [244, 244, 245];
  let border: [number, number, number] = [212, 212, 216];
  let fg: [number, number, number] = [82, 82, 91];
  let label = "DRAFT";
  if (s === "PAID") {
    bg = [220, 252, 231]; border = [134, 239, 172]; fg = [21, 128, 61]; label = "PAID IN FULL";
  } else if (s === "OVERDUE") {
    bg = [254, 226, 226]; border = [252, 165, 165]; fg = [185, 28, 28]; label = "OVERDUE";
  } else if (["SENT", "VIEWED", "PARTIALLY_PAID"].includes(s)) {
    bg = [254, 243, 199]; border = [252, 211, 77]; fg = [180, 83, 9]; label = "PENDING PAYMENT";
  }
  const bw = 42;
  const bh = 6.5;
  doc.setFillColor(...bg);
  doc.setDrawColor(...border);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, bw, bh, 1.5, 1.5, "FD");
  doc.setFillColor(...fg);
  doc.circle(x + 4, y + bh / 2, 0.9, "F");
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(7);
  doc.setTextColor(...fg);
  doc.text(label, x + 6 + (bw - 6) / 2, y + 4.4, { align: "center" });
  return bh;
}

function drawLogo(doc: jsPDF, branding: InvoiceBranding | null | undefined, appName: string, accent: [number, number, number], x: number, y: number): number {
  const logoSource = branding?.logoBase64 ?? (branding?.logoDarkUrl?.startsWith("data:") ? branding.logoDarkUrl : null);
  if (logoSource) {
    try {
      const fmt = detectImageFormat(logoSource);
      // preserve the logo's natural aspect ratio inside the 42×14 slot
      let w = 42;
      let h = 14;
      try {
        const props = doc.getImageProperties(logoSource);
        const fit = fitImageBox(props.width, props.height, 42, 14);
        w = fit.w;
        h = fit.h;
      } catch {
        /* keep the legacy fixed box */
      }
      doc.addImage(logoSource, fmt, x, y + (14 - h) / 2, w, h);
      return y + 16;
    } catch { /* fall through to emblem */ }
  }
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 8.5, 8.5, 2, 2, "F");
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  const initials = appName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "ZL";
  doc.text(initials, x + 4.25, y + 5.8, { align: "center" });
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(appName, x + 11.5, y + 6.8);
  return y + 10;
}

function drawSignatureBlock(
  doc: jsPDF,
  branding: InvoiceBranding | null | undefined,
  x: number,
  y: number,
  w: number
) {
  const sigSource = branding?.signatureBase64 ?? (branding?.signatureImageUrl?.startsWith("data:") ? branding.signatureImageUrl : null);
  let imgH = 0;
  if (sigSource) {
    try {
      // preserve the signature's natural aspect ratio inside the 40×13 slot
      let w = 40;
      let h = 13;
      try {
        const props = doc.getImageProperties(sigSource);
        const fit = fitImageBox(props.width, props.height, 40, 13);
        w = fit.w;
        h = fit.h;
      } catch {
        /* keep the legacy fixed box */
      }
      doc.addImage(sigSource, detectImageFormat(sigSource), x + (40 - w) / 2, y, w, h);
      imgH = h;
    } catch { imgH = 0; }
  }
  if (!imgH) {
    // No uploaded signature: a script-style placeholder sits ABOVE the line,
    // with clear gaps so it can never overlap the signer name below.
    doc.setFont("times", "italic");
    doc.setFontSize(13);
    doc.setTextColor(37, 99, 235);
    doc.text("Authorized Representative", x + w / 2, y + 5, { align: "center" });
    y += 8;
  } else {
    y += imgH + 1.5;
  }
  doc.setDrawColor(...FAINTER);
  doc.setLineWidth(0.3);
  doc.line(x, y + 1, x + w, y + 1);
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(branding?.authorizedSignerName?.trim() || "Authorized Signer", x + w / 2, y + 5, { align: "center" });
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(7);
  doc.setTextColor(...FAINT);
  doc.text(branding?.authorizedSignerTitle?.trim() || "Authorized Signature", x + w / 2, y + 8.5, { align: "center" });
  return y + 8.5;
}

function stampFooters(doc: jsPDF, appName: string, addressLine: string, website: string) {
  const totalPages = doc.getNumberOfPages();
  const left = [appName, addressLine].filter(Boolean).join(" • ");
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(M, PAGE_H - 12, RM, PAGE_H - 12);
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text(left.slice(0, 95), M, PAGE_H - 8);
    doc.text(`Page ${i} of ${totalPages}`, RM, PAGE_H - 8, { align: "right" });
    // brand credit line — centered, faint, clear of the content above
    doc.setFontSize(6.5);
    doc.setTextColor(...FAINTER);
    doc.text(`Powered by Zoolyum OS${website ? ` • ${website}` : ""}`, PAGE_W / 2, PAGE_H - 4.6, { align: "center" });
  }
}

export function buildInvoicePdf(inv: PdfInvoice, branding?: InvoiceBranding | null): jsPDF {
  const style = inv.templateStyle || "modern-orange";
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerPdfFonts(doc); doc.setFont(BODY_FONT, "normal");
  const accent = resolveAccent(branding, style);
  const appName = resolveAppName(branding);
  const sym = currencySymbol(inv.currency);
  const t = calcTotals(inv);
  const dark = style === "zoolyum-dark";

  let y = M;

  // Top accent bar
  if (dark) {
    doc.setFillColor(24, 24, 27);
    doc.roundedRect(M, y, W, 2, 1, 1, "F");
  } else if (style === "minimal-clean") {
    doc.setDrawColor(212, 212, 216);
    doc.setLineWidth(0.4);
    doc.line(M, y, RM, y);
  } else {
    doc.setFillColor(...accent);
    doc.roundedRect(M, y, W, 1.8, 0.9, 0.9, "F");
  }
  y += 5;

  // Header — company left, invoice meta right
  const headerTop = y;
  let leftBottom = drawLogo(doc, branding, appName, accent, M, y);
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  let ty = Math.max(leftBottom, headerTop + 11);
  if (branding?.tagline) {
    doc.setFont(BODY_FONT, "italic");
    doc.text(branding.tagline, M, ty);
    doc.setFont(BODY_FONT, "normal");
    ty += 3.8;
  }
  const addrLine = [branding?.address, branding?.city, branding?.country].filter(Boolean).join(", ");
  if (addrLine) { doc.text(addrLine, M, ty); ty += 3.8; }
  if (branding?.phone) { doc.text(`Phone: ${branding.phone}`, M, ty); ty += 3.8; }
  if (branding?.email) { doc.text(`Email: ${branding.email}`, M, ty); ty += 3.8; }
  const taxWeb = [branding?.taxId, branding?.website].filter(Boolean).join("  |  ");
  if (taxWeb) { doc.text(taxWeb, M, ty); ty += 4; }

  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(18);
  doc.setTextColor(...accent);
  doc.text(`#${inv.invoiceNumber}`, RM, headerTop + 6, { align: "right" });
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(`Issue Date: ${dateOnly(inv.issueDate)}`, RM, headerTop + 12, { align: "right" });
  doc.text(`Due Date: ${dateOnly(inv.dueDate)}`, RM, headerTop + 16.5, { align: "right" });
  const badgeH = statusBadge(doc, inv.status, RM - 42, headerTop + 20);

  y = Math.max(ty, headerTop + 20 + badgeH) + 4;
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, y, RM, y);
  y += 5;

  // Billed-to + payment instructions
  const secY = y;
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...accent);
  doc.text("BILLED TO / CLIENT", M, y);
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(inv.client?.companyName || "Valued Client", M, y + 4.5);
  let cy = y + 8.5;
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  for (const c of inv.client?.contacts ?? []) {
    const parts = [c.name, c.phone, c.email].filter(Boolean).join("  •  ");
    if (parts) { doc.text(parts, M, cy); cy += 3.8; }
  }
  if (inv.client?.address) { doc.text(inv.client.address, M, cy); cy += 3.8; }
  if (inv.client?.taxId) {
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text(inv.client.taxId, M, cy);
    cy += 3.8;
  }
  if (inv.project?.name) {
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text(`Project: ${inv.project.name}`, M, cy);
    cy += 3.8;
  }

  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...accent);
  doc.text("PAYMENT INSTRUCTIONS", RM, secY, { align: "right" });
  let py = secY + 4.5;
  const pay: Record<string, any> = inv.paymentDetails ?? branding?.defaultPaymentDetails ?? {};
  if (pay.bankName) {
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(pay.bankName, RM, py, { align: "right" });
    py += 3.8;
  }
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  if (pay.accountNumber) {
    doc.text(`A/C: ${pay.accountNumber}${pay.accountName ? ` (${pay.accountName})` : ""}`, RM, py, { align: "right" });
    py += 3.8;
  }
  const branchBits = [pay.branch ? `Branch: ${pay.branch}` : "", pay.routingNumber ? `Routing: ${pay.routingNumber}` : ""].filter(Boolean).join("  •  ");
  if (branchBits) { doc.text(branchBits, RM, py, { align: "right" }); py += 3.8; }
  if (pay.mobileWalletNumber) {
    const walletType = (pay.mobileWalletType || (["BKASH", "NAGAD"].includes((pay.method ?? "").toUpperCase()) ? pay.method : "bKash") as string).toUpperCase();
    doc.setFont(BODY_FONT, "bold");
    doc.setTextColor(...accent);
    doc.text(`${walletType}: ${pay.mobileWalletNumber}`, RM, py, { align: "right" });
    py += 3.8;
    doc.setFont(BODY_FONT, "normal");
    doc.setTextColor(...FAINTER);
  }
  doc.setFontSize(7.5);
  doc.text(`Ref: Invoice #${inv.invoiceNumber}`, RM, py, { align: "right" });
  py += 4;

  y = Math.max(cy, py) + 3;
  doc.setDrawColor(228, 228, 231);
  doc.line(M, y, RM, y);
  y += 5;

  // Items table
  const colNumW = 10, colDescW = 86, colQtyW = 18, colRateW = 34, colAmtW = 34;
  const xNum = M, xDesc = M + colNumW, xQty = xDesc + colDescW, xRate = xQty + colQtyW;
  const drawTableHeader = () => {
    const hh = 7.5;
    if (dark) {
      doc.setFillColor(24, 24, 27);
      doc.rect(M, y, W, hh, "F");
      doc.setTextColor(244, 244, 245);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, W, hh, "F");
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(M, y + hh, RM, y + hh);
      doc.setTextColor(...SLATE);
    }
    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(7.5);
    doc.text("#", xNum + colNumW / 2, y + 5, { align: "center" });
    doc.text("ITEM & DESCRIPTION", xDesc + 3, y + 5);
    doc.text("QTY", xQty + colQtyW / 2, y + 5, { align: "center" });
    doc.text(`RATE (${sym})`, xRate + colRateW - 3, y + 5, { align: "right" });
    doc.text(`AMOUNT (${sym})`, RM - 3, y + 5, { align: "right" });
    y += hh;
  };
  drawTableHeader();

  const items = inv.lineItems ?? [];
  items.forEach((item, index) => {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    const descLines = doc.splitTextToSize(item.description || "Service / Product", colDescW - 6);
    const rowH = Math.max(7.5, descLines.length * 4.2 + 3);
    if (y + rowH > PAGE_H - 35) {
      doc.addPage();
      y = M;
      doc.setFont(BODY_FONT, "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...FAINT);
      doc.text(`Invoice #${inv.invoiceNumber} (Continued)`, M, y);
      y += 4;
      drawTableHeader();
    }
    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, W, rowH, "F");
    }
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(M, y + rowH, RM, y + rowH);
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(String(index + 1), xNum + colNumW / 2, y + 5, { align: "center" });
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    let ly = y + 5;
    for (const ln of descLines) { doc.text(ln, xDesc + 3, ly); ly += 4.2; }
    doc.setTextColor(51, 65, 85);
    doc.text(String(item.quantity ?? 1), xQty + colQtyW / 2, y + 5, { align: "center" });
    doc.text(money2(item.unitPrice), xRate + colRateW - 3, y + 5, { align: "right" });
    doc.setFont(BODY_FONT, "bold");
    doc.setTextColor(...INK);
    doc.text(money2(item.amount), RM - 3, y + 5, { align: "right" });
    y += rowH;
  });
  y += 2;

  // Payment history (left) + totals (right)
  const payments = inv.payments ?? [];
  const payBoxH = payments.length > 0 ? 8.5 + payments.length * 4.6 : 0;
  if (y + Math.max(45, payBoxH) + 25 > PAGE_H - 20) {
    doc.addPage();
    y = M + 5;
  }
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, y, RM, y);
  y += 4;

  const totalsW = 72;
  const totalsL = RM - totalsW;
  let totY = y + 3;
  let leftBottomY = y;
  if (payments.length > 0) {
    const bx = M, by = y + 3, bw = totalsL - M - 6;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.28);
    doc.roundedRect(bx, by, bw, payBoxH, 1.8, 1.8, "FD");
    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...accent);
    doc.text("PAYMENT HISTORY & INSTALLMENTS", bx + 3.5, by + 5.5);
    let pY = by + 10;
    payments.forEach((p, i) => {
      const rec = `#${p.referenceId || `${inv.invoiceNumber}-P${i + 1}`}`;
      doc.setFont(BODY_FONT, "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(30, 41, 59);
      doc.text(rec, bx + 3.5, pY);
      const tagW = doc.getTextWidth(rec);
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(...FAINT);
      doc.text(` (${dateOnly(p.paymentDate)}) • ${(p.paymentMethod || "").toUpperCase()}`, bx + 3.5 + tagW, pY);
      doc.setFont(BODY_FONT, "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(16, 185, 129);
      doc.text(`${sym} ${money2(p.amount)}`, bx + bw - 3.5, pY, { align: "right" });
      pY += 4.6;
    });
    leftBottomY = by + payBoxH;
  }

  const totRow = (k: string, v: string, accentVal = false) => {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...SLATE);
    doc.text(k, totalsL, totY);
    doc.setFont(BODY_FONT, "bold");
    doc.setTextColor(...(accentVal ? accent : INK));
    doc.text(v, RM, totY, { align: "right" });
    totY += 4.8;
  };
  totRow("Subtotal:", `${sym} ${money2(t.subtotal)}`);
  if (t.tax > 0) totRow(`VAT / Tax (${num(inv.taxRate)}%):`, `+ ${sym} ${money2(t.tax)}`);
  if (t.discount > 0) {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(16, 185, 129);
    doc.text(`Discount (${num(inv.discountRate)}%):`, totalsL, totY);
    doc.setFont(BODY_FONT, "bold");
    doc.text(`- ${sym} ${money2(t.discount)}`, RM, totY, { align: "right" });
    totY += 4.8;
  }
  if (t.shipping > 0) totRow("Shipping / Delivery:", `+ ${sym} ${money2(t.shipping)}`);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.line(totalsL, totY, RM, totY);
  totY += 4.8;
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...accent);
  doc.text("Grand Total:", totalsL, totY);
  doc.setFontSize(11);
  doc.text(`${sym} ${money2(t.grand)}`, RM, totY, { align: "right" });
  totY += 5.5;
  if (t.paid > 0) {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(16, 185, 129);
    doc.text("Paid Amount:", totalsL, totY);
    doc.setFont(BODY_FONT, "bold");
    doc.text(`${sym} ${money2(t.paid)}`, RM, totY, { align: "right" });
    totY += 4.5;
    doc.setTextColor(220, 38, 38);
    doc.text("Balance Due:", totalsL, totY);
    doc.text(`${sym} ${money2(t.due)}`, RM, totY, { align: "right" });
    totY += 5;
  }
  // Project statement (one-time projects): running value / paid / due + history
  const pb = inv.projectBalance;
  if (pb && pb.project && (pb.value != null || pb.paid != null || pb.due != null)) {
    const pbInvoices = (pb.invoices ?? []).slice(0, 5);
    // long titles wrap onto their own line(s) so they never collide with amounts
    const titleLines = pbInvoices.reduce((n: number, inv: any) => n + (inv.title ? Math.min(doc.splitTextToSize(String(inv.title), W - 34).length, 2) : 0), 0);
    const needH = 14 + pbInvoices.length * 4.2 + titleLines * 3.6 + Math.min((pb.payments ?? []).length, 5) * 4.2;
    if (totY + needH > PAGE_H - 20) {
      doc.addPage();
      totY = M + 5;
    }
    totY += 2;
    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...accent);
    doc.text(`Project Statement — ${pb.project.name ?? "Project"}`, totalsL, totY);
    totY += 4.8;
    const pbRow = (k: string, v: string) => {
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...SLATE);
      doc.text(k, totalsL, totY);
      doc.setFont(BODY_FONT, "bold");
      doc.setTextColor(...INK);
      doc.text(v, RM, totY, { align: "right" });
      totY += 4.2;
    };
    pbRow("Project value:", `${sym} ${money2(pb.value ?? 0)}`);
    pbRow("Paid to date:", `${sym} ${money2(pb.paid ?? 0)}`);
    pbRow("Balance due:", `${sym} ${money2(pb.due ?? 0)}`);
    for (const inv of pbInvoices) {
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(7);
      doc.setTextColor(...FAINT);
      const invHead = `${inv.invoiceNumber ?? ""}${inv.invoiceType === "ADVANCE" ? " · Advance" : ""} · ${String(inv.status ?? "").replace(/_/g, " ")}`;
      doc.text(invHead, totalsL, totY);
      doc.text(`${sym} ${money2(inv.amount)}`, RM, totY, { align: "right" });
      totY += 4.2;
      if (inv.title) {
        doc.setFontSize(6.5);
        doc.setTextColor(148, 163, 184);
        const wrapped = doc.splitTextToSize(String(inv.title), W - 34);
        for (const ln of wrapped.slice(0, 2)) {
          doc.text(ln, totalsL, totY);
          totY += 3.6;
        }
      }
    }
    for (const p of (pb.payments ?? []).slice(0, 5)) {
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(7);
      doc.setTextColor(...FAINT);
      doc.text(`${p.invoiceNumber ?? ""} · ${dateOnly(p.paymentDate)}`, totalsL, totY);
      doc.text(`${sym} ${money2(p.amount)}`, RM, totY, { align: "right" });
      totY += 4.2;
    }
    totY += 1.5;
  }
  y = Math.max(totY, leftBottomY) + 3;

  // In-words box
  if (y + 45 > PAGE_H - 20) {
    doc.addPage();
    y = M + 5;
  }
  if (dark) {
    doc.setFillColor(244, 244, 245);
    doc.setDrawColor(212, 212, 216);
  } else {
    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(254, 215, 170);
  }
  doc.setLineWidth(0.25);
  doc.roundedRect(M, y, W, 9.5, 1.5, 1.5, "FD");
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...accent);
  doc.text("In Words:", M + 3.5, y + 6.2);
  const lblW = doc.getTextWidth("In Words:");
  doc.setFont(BODY_FONT, "italic");
  doc.setTextColor(30, 41, 59);
  const words = numberToWords(t.grand, inv.currency ?? "BDT");
  const split = doc.splitTextToSize(words, W - lblW - 10);
  doc.text(split[0] || words, M + 3.5 + lblW + 2.5, y + 6.2);
  y += 13.5;

  // Footer — terms left, QR + signature right (pinned toward page bottom)
  const termsStr = inv.terms || branding?.defaultTerms;
  const notesStr = inv.notes || branding?.defaultNotes;
  const termsW = inv.qrDataUrl ? 92 : 105;
  const termLines: string[] = termsStr ? doc.splitTextToSize(termsStr, termsW) : [];
  const noteLines: string[] = notesStr ? doc.splitTextToSize(notesStr, termsW) : [];
  const qrNeed = inv.qrDataUrl ? 30 : 24;
  const needH = Math.max(4 + termLines.length * 3.6 + 2 + noteLines.length * 3.6, qrNeed) + 6;
  const targetY = PAGE_H - 16 - needH;
  let footY: number;
  if (y + needH > PAGE_H - 18) {
    doc.addPage();
    footY = Math.max(M + 5, targetY);
  } else {
    footY = Math.max(y + 6, targetY);
  }
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, footY, RM, footY);
  let fyy = footY + 4;
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8);
  doc.setTextColor(...accent);
  doc.text("TERMS & CONDITIONS", M, fyy);
  fyy += 4;
  if (termLines.length) {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(termLines, M, fyy);
    fyy += termLines.length * 3.6 + 2;
  }
  if (noteLines.length) {
    doc.setFont(BODY_FONT, "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text(noteLines, M, fyy);
  }
  if (inv.qrDataUrl) {
    // QR bottom-right, left of the signature: scan to open this invoice
    const qrS = 20;
    const qrX = RM - 55 - 8 - qrS;
    try {
      doc.addImage(inv.qrDataUrl, "PNG", qrX, footY + 1, qrS, qrS);
    } catch {
      /* QR is decorative — never break the invoice */
    }
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...FAINT);
    doc.text("Scan to view invoice", qrX + qrS / 2, footY + 1 + qrS + 3.5, { align: "center" });
  }
  drawSignatureBlock(doc, branding, RM - 55, footY + 1, 55);

  stampFooters(doc, appName, [branding?.address, branding?.city, branding?.country].filter(Boolean).join(", ") || "Dhaka, Bangladesh", branding?.website || "www.zoolyum.com");
  return doc;
}

/** Official payment receipt (PAID stamp) for a single payment record. */
export function buildReceiptPdf(
  inv: PdfInvoice,
  payment: PdfPayment & { index?: number },
  branding?: InvoiceBranding | null
): jsPDF {
  const style = inv.templateStyle || "modern-orange";
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerPdfFonts(doc); doc.setFont(BODY_FONT, "normal");
  const accent = resolveAccent(branding, style);
  const appName = resolveAppName(branding);
  const sym = currencySymbol(inv.currency);
  const t = calcTotals(inv);
  const receiptNo = payment.referenceId || `${inv.invoiceNumber}-P${(payment.index ?? 0) + 1}`;

  let y = M;
  doc.setFillColor(...accent);
  doc.roundedRect(M, y, W, 1.8, 0.9, 0.9, "F");
  y += 5;
  drawLogo(doc, branding, appName, accent, M, y);
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(18);
  doc.setTextColor(...accent);
  doc.text("PAYMENT RECEIPT", RM, y + 6, { align: "right" });
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(`Receipt: ${receiptNo}`, RM, y + 12, { align: "right" });
  doc.text(`Date: ${dateOnly(payment.paymentDate)}`, RM, y + 16.5, { align: "right" });
  statusBadge(doc, "PAID", RM - 42, y + 20);
  y += 32;
  doc.setDrawColor(228, 228, 231);
  doc.line(M, y, RM, y);
  y += 6;

  const box = (k: string, v: string) => {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...SLATE);
    doc.text(k, M, y);
    doc.setFont(BODY_FONT, "bold");
    doc.setTextColor(...INK);
    doc.text(v, M + 52, y);
    y += 5.5;
  };
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8);
  doc.setTextColor(...accent);
  doc.text("RECEIPT DETAILS", M, y);
  y += 5;
  box("Received from:", inv.client?.companyName ?? "—");
  box("Invoice:", `#${inv.invoiceNumber}  (Total ${sym} ${money2(t.grand)})`);
  box("Method:", (payment.paymentMethod ?? "—").toUpperCase());
  box("Amount:", `${sym} ${money2(payment.amount)}`);
  if (payment.notes) box("Note:", String(payment.notes).slice(0, 80));
  y += 2;

  doc.setFont(BODY_FONT, "italic");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  const words = numberToWords(num(payment.amount), inv.currency ?? "BDT");
  const split = doc.splitTextToSize(`In Words: ${words}`, W);
  doc.text(split, M, y);
  y += split.length * 4.5 + 6;

  // Signature block — pinned toward the page bottom so it always sits
  // aligned (same professional placement as the invoice sheet).
  const sigH = 26;
  let sigY = y + 6;
  if (sigY + sigH > PAGE_H - 18) {
    doc.addPage();
    sigY = M + 10;
  } else {
    sigY = Math.max(sigY, PAGE_H - 16 - sigH);
  }
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, sigY - 4, RM, sigY - 4);
  drawSignatureBlock(doc, branding, RM - 55, sigY, 55);
  stampFooters(doc, appName, [branding?.address, branding?.city, branding?.country].filter(Boolean).join(", ") || "Dhaka, Bangladesh", branding?.website || "www.zoolyum.com");
  return doc;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") return Buffer.from(buf).toString("base64");
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function detectImageFormat(urlOrMime: string): string {
  const s = urlOrMime.toLowerCase();
  if (s.includes("jpeg") || s.includes("jpg")) return "JPEG";
  if (s.includes("svg")) return "SVG";
  if (s.includes("webp")) return "WEBP";
  return "PNG";
}

function resolveLogoFetchUrl(url: string): string {
  if (url.startsWith("/api/")) return `${API_URL}${url.slice(4)}`;
  return url;
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(resolveLogoFetchUrl(url));
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    const fmt = detectImageFormat(url + " " + contentType);
    const mime = fmt === "JPEG" ? "image/jpeg" : fmt === "SVG" ? "image/svg+xml" : fmt === "WEBP" ? "image/webp" : "image/png";
    return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return null;
  }
}

export async function resolveBrandingImages(branding?: InvoiceBranding | null): Promise<InvoiceBranding | null | undefined> {
  if (!branding) return branding;
  const needLogo = branding.logoDarkUrl && !branding.logoBase64 && !branding.logoDarkUrl.startsWith("data:");
  const needSig = branding.signatureImageUrl && !branding.signatureBase64 && !branding.signatureImageUrl.startsWith("data:");
  if (!needLogo && !needSig) return branding;
  const [logoBase64, signatureBase64] = await Promise.all([
    needLogo ? fetchAsDataUrl(branding.logoDarkUrl!) : Promise.resolve(branding.logoBase64 ?? null),
    needSig ? fetchAsDataUrl(branding.signatureImageUrl!) : Promise.resolve(branding.signatureBase64 ?? null),
  ]);
  return { ...branding, logoBase64: logoBase64 ?? branding.logoBase64, signatureBase64: signatureBase64 ?? branding.signatureBase64 };
}

export async function buildInvoicePdfAsync(inv: PdfInvoice, branding?: InvoiceBranding | null): Promise<jsPDF> {
  await ensurePdfFonts();
  const withImages = await resolveBrandingImages(branding);
  let qrDataUrl: string | null = null;
  if (inv.shareUrl) {
    try {
      const QRCode = (await import("qrcode")).default;
      qrDataUrl = await QRCode.toDataURL(inv.shareUrl, { width: 240, margin: 1 });
    } catch {
      qrDataUrl = null;
    }
  }
  return buildInvoicePdf({ ...inv, qrDataUrl }, withImages);
}
