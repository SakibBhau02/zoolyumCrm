import { jsPDF } from "jspdf";
import { API_URL } from "./api";

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

export interface PdfInvoice {
  invoiceNumber: string;
  issueDate?: string | null;
  dueDate?: string | null;
  status?: string | null;
  currency?: string | null;
  taxApplicable?: boolean | null;
  taxRate?: number | string | null;
  notes?: string | null;
  client?: { companyName?: string; contacts?: PdfInvoiceContact[] } | null;
  project?: { name?: string } | null;
  lineItems?: PdfInvoiceLine[];
  payments?: { amount?: number | string }[];
}

const PAGE_W = 210;
const M = 16;
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const ACCENT: [number, number, number] = [124, 58, 237];

export interface InvoiceBranding {
  primaryColor?: string | null;
  logoDarkUrl?: string | null;
  logoBase64?: string | null;
  appName?: string | null;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = (hex ?? "").trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(h)) return null;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function resolveAccent(branding?: InvoiceBranding | null): [number, number, number] {
  if (branding?.primaryColor) {
    const rgb = hexToRgb(branding.primaryColor);
    if (rgb) return rgb;
  }
  return ACCENT;
}

function resolveAppName(branding?: InvoiceBranding | null): string {
  const n = branding?.appName?.trim();
  return n ? n : "ZOOLYUM";
}

const num = (v: any) => Number(v ?? 0);
const money = (v: any) => num(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const dateOnly = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

export function buildInvoicePdf(inv: PdfInvoice, branding?: InvoiceBranding | null): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = PAGE_W - M * 2;
  let y = 22;
  const accent = resolveAccent(branding);
  const appName = resolveAppName(branding);

  const label = (t: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(t.toUpperCase(), M, y);
    y += 5;
  };

  // Logo: if base64 or data URL provided, embed image sync; otherwise fallback to text logo
  let headerHasLogo = false;
  const logoSource = branding?.logoBase64 ?? (branding?.logoDarkUrl?.startsWith("data:") ? branding.logoDarkUrl : null);
  if (logoSource) {
    try {
      const fmt: string = logoSource.startsWith("data:image/jpeg") || logoSource.startsWith("data:image/jpg")
        ? "JPEG"
        : logoSource.startsWith("data:image/svg") || logoSource.includes("svg")
          ? "SVG"
          : "PNG";
      // detect format from string content if not data URL
      doc.addImage(logoSource, fmt, M, y - 8, 36, 10);
      headerHasLogo = true;
    } catch {
      headerHasLogo = false;
    }
  }

  if (headerHasLogo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(appName.toUpperCase(), M + 40, y);
    doc.setFontSize(9);
    doc.setTextColor(...accent);
    doc.text("FINANCE INVOICE", M + 40, y + 5.5);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(...INK);
    doc.text(appName.toUpperCase(), M, y);
    doc.setFontSize(9);
    doc.setTextColor(...accent);
    doc.text("FINANCE INVOICE", M, y + 5.5);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(inv.invoiceNumber, PAGE_W - M, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Issued: ${dateOnly(inv.issueDate)}     Due: ${dateOnly(inv.dueDate)}`, PAGE_W - M, y + 5.5, { align: "right" });

  const status = (inv.status || "DRAFT").replace(/_/g, " ");
  doc.setFillColor(...INK);
  doc.setDrawColor(...INK);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const sw = doc.getTextWidth(status.toUpperCase()) + 7;
  doc.roundedRect(PAGE_W - M - sw, y + 8.5, sw, 5.5, 1, 1, "F");
  doc.text(status.toUpperCase(), PAGE_W - M - sw + 3.5, y + 12.5);

  y += 22;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(M, y, PAGE_W - M, y);
  y += 12;

  label("Bill to");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(inv.client?.companyName ?? "—", M, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  for (const c of inv.client?.contacts ?? []) {
    const parts = [c.name, c.roleTitle, c.phone, c.email].filter(Boolean);
    if (parts.length) {
      doc.text(parts.join(" · "), M, y);
      y += 4.5;
    }
  }
  if (inv.project?.name) {
    doc.text(`Project: ${inv.project.name}`, M, y);
    y += 4.5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("FROM", PAGE_W - M, 46, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text("ZOOLYUM Digital Agency", PAGE_W - M, 51, { align: "right" });
  doc.setTextColor(...MUTED);
  doc.text("Dhaka, Bangladesh", PAGE_W - M, 55.5, { align: "right" });
  doc.text("billing@zoolyum.com", PAGE_W - M, 60, { align: "right" });

  y += 6;
  doc.setDrawColor(203, 213, 225);
  doc.line(M, y, PAGE_W - M, y);
  y += 8;

  const colX = {
    desc: M + 3,
    qty: PAGE_W - M - 56,
    rate: PAGE_W - M - 36,
    amount: PAGE_W - M - 3,
  };

  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, W, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("DESCRIPTION", colX.desc, y + 5.5);
  doc.text("QTY", colX.qty, y + 5.5, { align: "right" });
  doc.text("RATE", colX.rate, y + 5.5, { align: "right" });
  doc.text("AMOUNT", colX.amount, y + 5.5, { align: "right" });
  y += 8;

  const lines = inv.lineItems ?? [];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  let i = 0;
  for (const l of lines) {
    doc.setDrawColor(226, 232, 240);
    doc.line(M, y + 3, PAGE_W - M, y + 3);
    doc.text(String(l.description ?? ""), colX.desc, y + 6);
    doc.text(money(l.quantity), colX.qty, y + 6, { align: "right" });
    doc.text(money(l.unitPrice), colX.rate, y + 6, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(money(l.amount), colX.amount, y + 6, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 10;
    i += 1;
    if (y > 250 && i < lines.length) {
      doc.addPage();
      y = 22;
    }
  }

  const subtotal = lines.reduce((s, l) => s + num(l.amount), 0);
  const tax = inv.taxApplicable ? (subtotal * num(inv.taxRate)) / 100 : 0;
  const grand = subtotal + tax;
  const paid = (inv.payments ?? []).reduce((s, p) => s + num(p.amount), 0);
  const due = grand - paid;

  const totalsX = PAGE_W - M - 64;
  y += 4;
  const row = (k: string, v: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 9.5);
    doc.setTextColor(...MUTED);
    doc.text(k, totalsX, y);
    doc.setTextColor(...(bold ? INK : MUTED));
    doc.text(v, PAGE_W - M, y, { align: "right" });
    y += 6;
  };

  doc.setDrawColor(226, 232, 240);
  doc.line(totalsX, y - 3, PAGE_W - M, y - 3);
  row("Subtotal", money(subtotal));
  if (inv.taxApplicable && num(inv.taxRate) > 0) row(`Tax (${num(inv.taxRate)}%)`, money(tax));
  row("Total", money(grand), true);
  doc.line(totalsX, y - 3, PAGE_W - M, y - 3);
  row("Paid", `- ${money(paid)}`);
  row("Balance due", money(due), true);

  if (inv.notes) {
    y += 6;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(M, y, W, 20, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("NOTES", M + 5, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(String(inv.notes), M + 5, y + 12, { maxWidth: W - 10 });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Thank you for your business — ${appName} · This invoice was generated from the Zoolyum CRM`, PAGE_W / 2, 285, { align: "center" });

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

export async function buildInvoicePdfAsync(inv: PdfInvoice, branding?: InvoiceBranding | null): Promise<jsPDF> {
  if (!branding?.logoDarkUrl || branding.logoBase64 || branding.logoDarkUrl.startsWith("data:")) {
    return buildInvoicePdf(inv, branding);
  }
  let logoBase64: string | null = null;
  try {
    const fetchUrl = resolveLogoFetchUrl(branding.logoDarkUrl);
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    const fmt = detectImageFormat(branding.logoDarkUrl + " " + contentType);
    const mime = fmt === "JPEG" ? "image/jpeg" : fmt === "SVG" ? "image/svg+xml" : fmt === "WEBP" ? "image/webp" : "image/png";
    logoBase64 = `data:${mime};base64,${b64}`;
  } catch {
    logoBase64 = null;
  }
  if (logoBase64) return buildInvoicePdf(inv, { ...branding, logoBase64 });
  return buildInvoicePdf(inv, branding);
}