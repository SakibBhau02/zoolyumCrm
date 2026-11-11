import { jsPDF } from "jspdf";
import { API_URL } from "./api";
import { numberToWords } from "./invoice-utils";

export interface PdfInvoiceLine {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  amount?: number | string;
}

/** BANK_TRANSFER → "Bank Transfer" (raw enum labels looked unfinished). */
const methodLabel = (m?: string | null): string =>
  m ? m.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

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
/** 14 Oct 2026 — the rest of the sheet speaks this, so the statement must too. */
const dateShort = (d: any) => {
  if (!d) return "-";
  // Date-only values arrive as UTC midnight; parse the calendar part directly so
  // a client west of UTC never prints the previous day on a legal document.
  const iso = typeof d === "string" ? d.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, day] = iso.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

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

/**
 * Status pill, right-aligned to `rightX`.
 *
 * The dot + label pair is centred inside the pill as one optical unit — the old
 * version left-aligned the label inside the remaining space, so "PENDING
 * PAYMENT" sat several millimetres right of the pill's centre.
 */
function statusBadge(doc: jsPDF, statusRaw: string | null | undefined, rightX: number, y: number) {
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
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(7);
  const labelW = doc.getTextWidth(label);
  const dotD = 1.8;
  const gap = 2.4;
  const padX = 4;
  const bw = Math.max(40, labelW + dotD + gap + padX * 2);
  const bh = 6.5;
  const x = rightX - bw;
  doc.setFillColor(...bg);
  doc.setDrawColor(...border);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, bw, bh, 1.5, 1.5, "FD");
  doc.setFillColor(...fg);
  const contentW = dotD + gap + labelW;
  const startX = x + (bw - contentW) / 2;
  doc.circle(startX + dotD / 2, y + bh / 2, dotD / 2, "F");
  doc.setTextColor(...fg);
  doc.text(label, startX + dotD + gap, y + bh / 2 + 1.05);
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
  const sigSource =
    branding?.signatureBase64 ??
    (branding?.signatureImageUrl?.startsWith("data:") ? branding.signatureImageUrl : null);
  // Everything in this block — image, rule, name, title — is centred on the
  // exact same vertical axis. The old code centred a 40mm image inside a 55mm
  // slot but drew the rule across all 55mm, so the signature looked shifted
  // left compared with the line under it.
  const slotW = Math.max(30, w);
  const slotH = 13;
  let imgH = 0;
  if (sigSource) {
    try {
      let imgW = Math.min(40, slotW - 4);
      let imgHs = slotH;
      try {
        const props = doc.getImageProperties(sigSource);
        const fit = fitImageBox(props.width, props.height, slotW - 6, slotH);
        imgW = fit.w;
        imgHs = fit.h;
      } catch {
        /* keep the legacy fixed box */
      }
      doc.addImage(
        sigSource,
        detectImageFormat(sigSource),
        x + (slotW - imgW) / 2,
        y,
        imgW,
        imgHs
      );
      imgH = imgHs;
    } catch {
      imgH = 0;
    }
  }
  const signerName = branding?.authorizedSignerName?.trim();
  if (!imgH) {
    // No uploaded signature. Only add the script-style name when a real signer
    // exists — printing "Authorized Representative" on every invoice looked like
    // an unfinished placeholder.
    if (signerName) {
      doc.setFont("times", "italic");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235);
      doc.text(signerName, x + slotW / 2, y + 5, { align: "center" });
      y += 8;
    }
  } else {
    y += imgH + 1.5;
  }
  doc.setDrawColor(...FAINTER);
  doc.setLineWidth(0.3);
  doc.line(x + 4, y + 1, x + slotW - 4, y + 1);
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(signerName || branding?.appName?.trim() || "", x + slotW / 2, y + 5, {
    align: "center",
  });
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(7);
  doc.setTextColor(...FAINT);
  doc.text(
    branding?.authorizedSignerTitle?.trim() || "Authorized Signature",
    x + slotW / 2,
    y + 8.5,
    { align: "center" }
  );
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
  registerPdfFonts(doc);
  doc.setFont(BODY_FONT, "normal");
  const accent = resolveAccent(branding, style);
  const appName = resolveAppName(branding);
  const sym = currencySymbol(inv.currency);
  const t = calcTotals(inv);
  const dark = style === "zoolyum-dark";

  /**
   * One right edge for every piece of unboxed content (invoice meta, amounts,
   * totals). The old sheet had three different right margins — 3 mm for the
   * table, 0 mm for the totals and 4 mm inside the project band — which is what
   * made the columns look ragged when printed.
   */
  const RE = RM - 3;

  // Items-table grid: 10 + 84 + 18 + 34 + 36 = 182 mm (the full content width).
  const colNumW = 10, colDescW = 84, colQtyW = 18, colRateW = 34;
  const xNum = M, xDesc = M + colNumW, xQty = xDesc + colDescW, xRate = xQty + colQtyW;

  let y = M;

  const accentBar = () => {
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
  };

  /**
   * Start a continuation page. Every page keeps the same accent bar and a small
   * "continued" caption so a printed stack can never be shuffled silently.
   */
  const continuation = () => {
    doc.addPage();
    y = M;
    accentBar();
    y += 6;
    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...FAINT);
    doc.text(`Invoice ${inv.invoiceNumber} — continued`, M, y);
    doc.setFont(BODY_FONT, "normal");
    y += 4;
  };

  /** Truncate a single-line label to a width, keeping an ellipsis. */
  const fitText = (text: string, maxW: number) => {
    if (doc.getTextWidth(text) <= maxW) return text;
    let s = text;
    while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxW) s = s.slice(0, -1);
    return `${s}…`;
  };

  /** Draw wrapped text right-aligned to `rightX`, returning the next baseline. */
  const rightLines = (text: string, maxW: number, rightX: number, yy: number, lead = 3.8) => {
    for (const ln of doc.splitTextToSize(text, maxW)) {
      doc.text(ln, rightX, yy, { align: "right" });
      yy += lead;
    }
    return yy;
  };

  accentBar();
  y += 5;

  // ── Header: brand block left, invoice meta right ─────────────────────
  const headerTop = y;
  const leftColW = 108;
  const leftBottom = drawLogo(doc, branding, appName, accent, M, y);
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  let ly = Math.max(leftBottom, headerTop + 11);
  if (branding?.tagline) {
    doc.setFont(BODY_FONT, "italic");
    for (const ln of doc.splitTextToSize(branding.tagline, leftColW)) {
      doc.text(ln, M, ly);
      ly += 3.8;
    }
    doc.setFont(BODY_FONT, "normal");
  }
  const addrLine = [branding?.address, branding?.city, branding?.country].filter(Boolean).join(", ");
  if (addrLine) {
    for (const ln of doc.splitTextToSize(addrLine, leftColW)) {
      doc.text(ln, M, ly);
      ly += 3.8;
    }
  }
  const contactBits = [
    branding?.phone ? `Phone: ${branding.phone}` : "",
    branding?.email ? `Email: ${branding.email}` : "",
  ].filter(Boolean).join("   •   ");
  if (contactBits) {
    for (const ln of doc.splitTextToSize(contactBits, leftColW)) {
      doc.text(ln, M, ly);
      ly += 3.8;
    }
  }
  const taxWeb = [branding?.taxId ? `Tax ID: ${branding.taxId}` : "", branding?.website].filter(Boolean).join("   •   ");
  if (taxWeb) {
    for (const ln of doc.splitTextToSize(taxWeb, leftColW)) {
      doc.text(ln, M, ly);
      ly += 3.8;
    }
  }

  // Right column — every line shares the same right edge.
  const metaW = RM - (M + leftColW + 4);
  doc.setFont(BODY_FONT, "bold");
  let numSize = 18;
  doc.setFontSize(numSize);
  const numText = `#${inv.invoiceNumber}`;
  while (numSize > 9 && doc.getTextWidth(numText) > metaW) {
    numSize -= 0.5;
    doc.setFontSize(numSize);
  }
  doc.setTextColor(...accent);
  doc.text(numText, RE, headerTop + 6.5, { align: "right" });
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(`Issue Date: ${dateShort(inv.issueDate)}`, RE, headerTop + 12.5, { align: "right" });
  doc.text(`Due Date: ${dateShort(inv.dueDate)}`, RE, headerTop + 17, { align: "right" });
  const badgeH = statusBadge(doc, inv.status, RE, headerTop + 21);

  y = Math.max(ly, headerTop + 21 + badgeH) + 4;
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, y, RM, y);
  y += 5.5;

  // ── Parties: client left, payment instructions right ─────────────────
  const secY = y;
  const payColW = 72;
  const clientColW = W - payColW - 12;
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...accent);
  doc.text("BILLED TO / CLIENT", M, secY);
  doc.text("PAYMENT INSTRUCTIONS", RE, secY, { align: "right" });

  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  let cy = secY + 5.5;
  for (const ln of doc.splitTextToSize(inv.client?.companyName || "Valued Client", clientColW).slice(0, 2)) {
    doc.text(ln, M, cy);
    cy += 4.8;
  }
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  for (const c of (inv.client?.contacts ?? []).slice(0, 3)) {
    const parts = [c.name, c.phone, c.email].filter(Boolean).join("  •  ");
    if (!parts) continue;
    for (const ln of doc.splitTextToSize(parts, clientColW)) {
      doc.text(ln, M, cy);
      cy += 3.8;
    }
  }
  if (inv.client?.address) {
    for (const ln of doc.splitTextToSize(inv.client.address, clientColW)) {
      doc.text(ln, M, cy);
      cy += 3.8;
    }
  }
  if (inv.client?.taxId) {
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    for (const ln of doc.splitTextToSize(`Tax ID: ${inv.client.taxId}`, clientColW)) {
      doc.text(ln, M, cy);
      cy += 3.8;
    }
  }
  if (inv.project?.name) {
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    for (const ln of doc.splitTextToSize(`Project: ${inv.project.name}`, clientColW)) {
      doc.text(ln, M, cy);
      cy += 3.8;
    }
  }

  const pay: Record<string, any> = inv.paymentDetails ?? branding?.defaultPaymentDetails ?? {};
  let py = secY + 5.5;
  if (pay.bankName) {
    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    py = rightLines(String(pay.bankName), payColW, RE, py);
  }
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  const acct = [pay.accountNumber, pay.accountName].filter(Boolean).join(" · ");
  if (acct) py = rightLines(`A/C: ${acct}`, payColW, RE, py);
  const branchBits = [pay.branch ? `Branch: ${pay.branch}` : "", pay.routingNumber ? `Routing: ${pay.routingNumber}` : ""].filter(Boolean).join("  •  ");
  if (branchBits) py = rightLines(branchBits, payColW, RE, py);
  if (pay.mobileWalletNumber) {
    const walletType = String(pay.mobileWalletType || (["BKASH", "NAGAD"].includes(String(pay.method ?? "").toUpperCase()) ? pay.method : "bKash")).toUpperCase();
    doc.setFont(BODY_FONT, "bold");
    doc.setTextColor(...accent);
    py = rightLines(`${walletType}: ${pay.mobileWalletNumber}`, payColW, RE, py);
    doc.setFont(BODY_FONT, "normal");
  }
  doc.setFontSize(7.5);
  if (!pay.bankName && !pay.accountNumber && !pay.mobileWalletNumber) {
    doc.setTextColor(...SLATE);
    py = rightLines("Please transfer the balance and quote the reference below.", payColW, RE, py);
  }
  doc.setTextColor(...FAINTER);
  py = rightLines(`Ref: Invoice #${inv.invoiceNumber}`, payColW, RE, py);

  y = Math.max(cy, py) + 3;
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, y, RM, y);
  y += 5;

  // ── Line items ───────────────────────────────────────────────────────
  const drawTableHeader = () => {
    const hh = 8;
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
    doc.text("#", xNum + colNumW / 2, y + 5.3, { align: "center" });
    doc.text("ITEM & DESCRIPTION", xDesc + 3, y + 5.3);
    doc.text("QTY", xQty + colQtyW / 2, y + 5.3, { align: "center" });
    doc.text(`RATE (${sym})`, xRate + colRateW - 3, y + 5.3, { align: "right" });
    doc.text(`AMOUNT (${sym})`, RE, y + 5.3, { align: "right" });
    y += hh;
  };

  drawTableHeader();

  const items = inv.lineItems ?? [];
  const lineH = 4.3;
  items.forEach((item, index) => {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    const descLines = doc.splitTextToSize(item.description || "Service / Product", colDescW - 6);
    const rowH = Math.max(8, descLines.length * lineH + 3.4);
    if (y + rowH > PAGE_H - 26) {
      continuation();
      drawTableHeader();
    }
    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, W, rowH, "F");
    }
    // One separator per row — the previous sheet drew the row border *and* a
    // second divider 2 mm lower, which printed as a double line.
    doc.setDrawColor(238, 242, 247);
    doc.setLineWidth(0.2);
    doc.line(M, y + rowH, RM, y + rowH);

    const textBlockH = (descLines.length - 1) * lineH + 2.9;
    const firstBaseline = y + (rowH - textBlockH) / 2 + 2.9;
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(String(index + 1), xNum + colNumW / 2, firstBaseline, { align: "center" });
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    let dlY = firstBaseline;
    for (const ln of descLines) {
      doc.text(ln, xDesc + 3, dlY);
      dlY += lineH;
    }
    doc.setTextColor(51, 65, 85);
    doc.text(String(item.quantity ?? 1), xQty + colQtyW / 2, firstBaseline, { align: "center" });
    doc.text(money2(item.unitPrice), xRate + colRateW - 3, firstBaseline, { align: "right" });
    doc.setFont(BODY_FONT, "bold");
    doc.setTextColor(...INK);
    doc.text(money2(item.amount), RE, firstBaseline, { align: "right" });
    y += rowH;
  });

  // ── Payment history (left) + totals (right) ──────────────────────────
  const payments = inv.payments ?? [];
  const payBoxH = payments.length ? 9 + payments.length * 4.8 + 1.4 : 0;
  const totalRows = 1 + (t.tax > 0 ? 1 : 0) + (t.discount > 0 ? 1 : 0) + (t.shipping > 0 ? 1 : 0);
  const totalsH = 5 + 5.6 + totalRows * 4.8 + 6.8 + (t.paid > 0 ? 9.4 : 0);
  const blockH = Math.max(totalsH, payBoxH, 10);
  if (y + blockH + 8 > PAGE_H - 20) continuation();

  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, y, RM, y);
  y += 5;

  const totalsW = 72;
  const totalsL = RM - totalsW;
  // Both columns share their first baseline with the history panel title.
  let totY = y + 5.6;

  if (payments.length) {
    const bx = M, by = y, bw = totalsL - M - 6;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.28);
    doc.roundedRect(bx, by, bw, payBoxH, 2, 2, "FD");
    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...accent);
    doc.text("PAYMENT HISTORY & INSTALLMENTS", bx + 3.5, by + 5.6);
    let pY = by + 10.4;
    payments.forEach((p, i) => {
      const rec = `#${p.referenceId || `${inv.invoiceNumber}-P${i + 1}`}`;
      doc.setFont(BODY_FONT, "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(30, 41, 59);
      const left = fitText(rec, 26);
      doc.text(left, bx + 3.5, pY);
      const tagX = bx + 3.5 + doc.getTextWidth(left);
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(...FAINT);
      const meta = ` (${dateShort(p.paymentDate)}) • ${methodLabel(p.paymentMethod)}`;
      doc.text(fitText(meta, bw - (tagX - bx) - 30), tagX, pY);
      doc.setFont(BODY_FONT, "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(16, 185, 129);
      doc.text(`${sym} ${money2(p.amount)}`, bx + bw - 3.5, pY, { align: "right" });
      pY += 4.8;
    });
  }

  const totRow = (k: string, v: string, color: [number, number, number] = INK) => {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...SLATE);
    doc.text(k, totalsL, totY);
    doc.setFont(BODY_FONT, "bold");
    doc.setTextColor(...color);
    doc.text(v, RE, totY, { align: "right" });
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
    doc.text(`- ${sym} ${money2(t.discount)}`, RE, totY, { align: "right" });
    totY += 4.8;
  }
  if (t.shipping > 0) totRow("Shipping / Delivery:", `+ ${sym} ${money2(t.shipping)}`);

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.line(totalsL, totY - 2.2, RE, totY - 2.2);
  totY += 4.2;
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...accent);
  doc.text("Grand Total:", totalsL, totY);
  doc.setFontSize(11);
  doc.text(`${sym} ${money2(t.grand)}`, RE, totY, { align: "right" });
  totY += 5.8;
  if (t.paid > 0) {
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(16, 185, 129);
    doc.text("Paid Amount:", totalsL, totY);
    doc.setFont(BODY_FONT, "bold");
    doc.text(`${sym} ${money2(t.paid)}`, RE, totY, { align: "right" });
    totY += 4.6;
    doc.setTextColor(220, 38, 38);
    doc.text("Balance Due:", totalsL, totY);
    doc.text(`${sym} ${money2(t.due)}`, RE, totY, { align: "right" });
    totY += 5;
  }

  let afterTotalsY = Math.max(totY, y + payBoxH) + 3;

  // ── Project statement (full-width ledger band) ───────────────────────
  const pb = inv.projectBalance;
  if (pb && pb.project && (pb.value != null || pb.paid != null || pb.due != null)) {
    const pbInvoices = (pb.invoices ?? []).slice(0, 5);
    const pbPayments = (pb.payments ?? []).slice(0, 5);
    const innerW = W - 12;
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(6.6);
    const titleLines = pbInvoices.map((it: any) => (it.title ? doc.splitTextToSize(String(it.title), innerW).slice(0, 2) : []));
    const titleH = titleLines.reduce((n: number, l: string[]) => n + l.length * 3.3, 0);
    const bodyH = 21 + pbInvoices.length * 4.4 + titleH + pbPayments.length * 4.4;
    if (afterTotalsY + bodyH > PAGE_H - 24) {
      continuation();
      afterTotalsY = y;
    }
    const bx = M;
    const by = afterTotalsY;
    const bw = W;
    if (dark) {
      doc.setFillColor(24, 24, 27);
      doc.setDrawColor(63, 63, 70);
    } else {
      doc.setFillColor(250, 245, 255);
      doc.setDrawColor(233, 213, 255);
    }
    doc.setLineWidth(0.3);
    doc.roundedRect(bx, by, bw, bodyH, 2, 2, "FD");

    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...accent);
    doc.text(`PROJECT STATEMENT — ${String(pb.project.name ?? "Project").toUpperCase()}`, bx + 4, by + 5.6);

    // Three summary figures on one row, all sharing the same baseline.
    const summary = [
      { k: "PROJECT VALUE", v: `${sym} ${money2(pb.value ?? 0)}`, tone: INK },
      { k: "PAID TO DATE", v: `${sym} ${money2(pb.paid ?? 0)}`, tone: [5, 150, 105] as [number, number, number] },
      { k: "BALANCE DUE", v: `${sym} ${money2(pb.due ?? 0)}`, tone: [217, 119, 6] as [number, number, number] },
    ];
    const colW = (bw - 8) / 3;
    summary.forEach((c, i) => {
      const cx = bx + 4 + i * colW;
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(6.6);
      doc.setTextColor(...FAINT);
      doc.text(c.k, cx, by + 10.8);
      doc.setFont(BODY_FONT, "bold");
      doc.setFontSize(9);
      doc.setTextColor(...c.tone);
      doc.text(c.v, cx, by + 15.2);
    });

    let pbY = by + 19.6;
    if (pbInvoices.length || pbPayments.length) {
      doc.setDrawColor(dark ? 63 : 226, dark ? 63 : 213, dark ? 70 : 255);
      doc.setLineWidth(0.2);
      doc.line(bx + 4, pbY - 2.8, bx + bw - 4, pbY - 2.8);
      pbY += 2.4;
    }
    pbInvoices.forEach((it: any, i: number) => {
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...SLATE);
      doc.text(`${it.invoiceNumber ?? ""}${it.invoiceType === "ADVANCE" ? " · Advance" : ""} · ${String(it.status ?? "").replace(/_/g, " ")}`, bx + 4, pbY);
      doc.setFont(BODY_FONT, "bold");
      doc.setTextColor(...INK);
      doc.text(`${sym} ${money2(it.amount)}`, RE, pbY, { align: "right" });
      pbY += 4.4;
      if (titleLines[i]?.length) {
        doc.setFont(BODY_FONT, "normal");
        doc.setFontSize(6.6);
        doc.setTextColor(148, 163, 184);
        for (const ln of titleLines[i]) {
          doc.text(ln, bx + 4, pbY);
          pbY += 3.3;
        }
      }
    });
    for (const p of pbPayments) {
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...FAINT);
      doc.text(`${p.invoiceNumber ?? ""} · ${dateShort(p.paymentDate)}`, bx + 4, pbY);
      doc.setFont(BODY_FONT, "bold");
      doc.setTextColor(5, 150, 105);
      doc.text(`${sym} ${money2(p.amount)}`, RE, pbY, { align: "right" });
      pbY += 4.4;
    }
    afterTotalsY = by + bodyH + 4;
  }
  y = afterTotalsY;

  // ── Amount in words ──────────────────────────────────────────────────
  const words = numberToWords(t.grand, inv.currency ?? "BDT");
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8.5);
  const inWordsLabel = "In Words:";
  const inWordsLabelW = doc.getTextWidth(inWordsLabel);
  doc.setFont(BODY_FONT, "italic");
  const wordLines = doc.splitTextToSize(words, W - inWordsLabelW - 12).slice(0, 4);
  const inWordsH = Math.max(10, 6.4 + wordLines.length * 4);
  if (y + inWordsH + 4 > PAGE_H - 20) continuation();
  if (dark) {
    doc.setFillColor(244, 244, 245);
    doc.setDrawColor(212, 212, 216);
  } else {
    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(254, 215, 170);
  }
  doc.setLineWidth(0.25);
  doc.roundedRect(M, y, W, inWordsH, 1.5, 1.5, "FD");
  const wordsBaseline = y + 6.4;
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...accent);
  doc.text(inWordsLabel, M + 3.5, wordsBaseline);
  doc.setFont(BODY_FONT, "italic");
  doc.setTextColor(30, 41, 59);
  let wY = wordsBaseline;
  for (const ln of wordLines) {
    doc.text(ln, M + 3.5 + inWordsLabelW + 3, wY);
    wY += 4;
  }
  y += inWordsH + 2;

  // ── Closing band: terms/notes left, QR + signature right ─────────────
  // Anchored to the bottom of the page when there is spare room, so a short
  // invoice does not end in the middle of the sheet with 10 cm of white below.
  const termsStr = inv.terms || branding?.defaultTerms;
  const notesStr = inv.notes || branding?.defaultNotes;
  const hasQr = !!inv.qrDataUrl;
  const termsW = hasQr ? 92 : 112;
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(7.5);
  const termLines: string[] = termsStr ? doc.splitTextToSize(termsStr, termsW).slice(0, 40) : [];
  const noteLines: string[] = notesStr ? doc.splitTextToSize(notesStr, termsW).slice(0, 40) : [];
  const termsH =
    (termLines.length ? 7.4 + termLines.length * 3.6 : 0) +
    (noteLines.length ? (termLines.length ? 1.8 : 0) + 7.4 + noteLines.length * 3.6 : 0);
  const closingContentH = Math.max(termsH, 27);
  const closingH = closingContentH + 6;

  let blockTop = y + 8;
  const anchor = PAGE_H - 20 - closingH;
  if (blockTop < anchor) blockTop = anchor;
  if (blockTop + closingH > PAGE_H - 17) {
    continuation();
    blockTop = y + 2;
  }

  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, blockTop, RM, blockTop);
  const contentTop = blockTop + 6;

  if (termLines.length || noteLines.length) {
    let tY = contentTop;
    doc.setFont(BODY_FONT, "bold");
    doc.setFontSize(8);
    doc.setTextColor(...accent);
    if (termLines.length) {
      doc.text("TERMS & CONDITIONS", M, tY + 3.2);
      tY += 7.4;
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE);
      for (const ln of termLines) {
        doc.text(ln, M, tY);
        tY += 3.6;
      }
    }
    if (noteLines.length) {
      if (termLines.length) tY += 1.8;
      doc.setFont(BODY_FONT, "bold");
      doc.setFontSize(8);
      doc.setTextColor(...accent);
      doc.text("NOTES", M, tY + 3.2);
      tY += 7.4;
      doc.setFont(BODY_FONT, "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...FAINT);
      for (const ln of noteLines) {
        doc.text(ln, M, tY);
        tY += 3.6;
      }
    }
  }

  const sigW = 55;
  const sigX = RM - sigW;
  if (hasQr) {
    // QR sits immediately left of the signature with a fixed 8 mm gutter so the
    // two blocks never collide, whatever the signature image dimensions are.
    const qrS = 20;
    const qrX = sigX - 8 - qrS;
    try {
      doc.addImage(inv.qrDataUrl!, "PNG", qrX, contentTop, qrS, qrS);
    } catch {
      /* QR is decorative — never break the invoice */
    }
    doc.setFont(BODY_FONT, "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...FAINT);
    doc.text("Scan to view invoice", qrX + qrS / 2, contentTop + qrS + 3.5, { align: "center" });
  }
  drawSignatureBlock(doc, branding, sigX, contentTop, sigW);

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
  const RE = RM - 3;

  let y = M;
  doc.setFillColor(...accent);
  doc.roundedRect(M, y, W, 1.8, 0.9, 0.9, "F");
  y += 5;
  drawLogo(doc, branding, appName, accent, M, y);
  doc.setFont(BODY_FONT, "bold");
  doc.setFontSize(18);
  doc.setTextColor(...accent);
  doc.text("PAYMENT RECEIPT", RE, y + 6, { align: "right" });
  doc.setFont(BODY_FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(`Receipt: ${receiptNo}`, RE, y + 12, { align: "right" });
  doc.text(`Date: ${dateShort(payment.paymentDate)}`, RE, y + 16.5, { align: "right" });
  statusBadge(doc, "PAID", RE, y + 20);
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
  box("Method:", methodLabel(payment.paymentMethod));
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
