import { jsPDF } from "jspdf";
import {
  ensurePdfFonts,
  fitImageBox,
  hexToRgb,
  registerPdfFonts,
  resolveBrandingImages,
  type InvoiceBranding,
} from "./invoice-pdf";

/**
 * Client-portal project report → A4 PDF.
 *
 * Mirrors the invoice sheet (embedded Bengali font, branding, page numbers) so
 * the client can archive the weekly/monthly update the agency sent.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;
const W = PAGE_W - M * 2;
const RM = PAGE_W - M;

const INK: [number, number, number] = [15, 23, 42];
const SLATE: [number, number, number] = [71, 85, 105];
const FAINT: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [228, 228, 231];

export interface PortalReportData {
  id: string;
  title: string;
  projectName: string;
  clientName?: string | null;
  periodStart: string;
  periodEnd: string;
  completed?: any[];
  pending?: any[];
  note?: string | null;
  billing?: { invoiced?: number; collected?: number; outstanding?: number } | null;
  sentAt?: string | null;
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v: any) =>
  num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v: any) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const titleOf = (item: any) => (typeof item === "string" ? item : String(item?.title ?? item?.name ?? "Item"));
const statusOf = (item: any) => String(item?.status ?? "").replace(/_/g, " ").toLowerCase();

export async function buildPortalReportPdf(
  report: PortalReportData,
  branding?: InvoiceBranding | null
): Promise<jsPDF> {
  const fontsLoaded = await ensurePdfFonts();
  const withImages = await resolveBrandingImages(branding ?? null);
  const font = fontsLoaded ? "hind-siliguri" : "helvetica";
  const accent: [number, number, number] =
    (withImages?.primaryColor && hexToRgb(withImages.primaryColor)) || [124, 58, 237];

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerPdfFonts(doc);
  doc.setFont(font, "normal");

  let y = M;

  // accent bar
  doc.setFillColor(...accent);
  doc.roundedRect(M, y, W, 1.8, 0.9, 0.9, "F");
  y += 6;

  const headerTop = y;
  // logo
  const logo =
    withImages?.logoBase64 ??
    (withImages?.logoDarkUrl?.startsWith("data:") ? withImages.logoDarkUrl : null);
  if (logo) {
    try {
      let w = 38;
      let h = 13;
      try {
        const props = doc.getImageProperties(logo);
        const fit = fitImageBox(props.width, props.height, 38, 13);
        w = fit.w;
        h = fit.h;
      } catch {}
      doc.addImage(logo, detectFormat(logo), M, y + (13 - h) / 2, w, h);
      y += 15;
    } catch {
      y += 2;
    }
  } else {
    doc.setFillColor(...accent);
    doc.roundedRect(M, y, 8.5, 8.5, 2, 2, "F");
    doc.setFont(font, "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(
      (withImages?.appName ?? "ZOOLYUM")
        .split(/\s+/)
        .map((x) => x[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      M + 4.25,
      y + 5.8,
      { align: "center" }
    );
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(withImages?.appName ?? "Zoolyum", M + 11.5, y + 6.5);
    y += 10;
  }

  doc.setFont(font, "bold");
  doc.setFontSize(15);
  doc.setTextColor(...accent);
  doc.text("PROJECT REPORT", RM, headerTop + 6, { align: "right" });
  doc.setFont(font, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(`${date(report.periodStart)} — ${date(report.periodEnd)}`, RM, headerTop + 12, { align: "right" });
  doc.setFontSize(8);
  doc.setTextColor(...FAINT);
  doc.text(`Generated ${date(report.sentAt ?? new Date())}`, RM, headerTop + 16.5, { align: "right" });

  let ty = Math.max(y, headerTop + 11);
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  const addr = [withImages?.address, withImages?.city, withImages?.country].filter(Boolean).join(", ");
  if (addr) {
    doc.text(addr, M, ty);
    ty += 3.8;
  }
  const contact = [withImages?.phone, withImages?.email].filter(Boolean).join("  •  ");
  if (contact) {
    doc.text(contact, M, ty);
    ty += 3.8;
  }

  y = Math.max(ty, headerTop + 20) + 4;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, y, RM, y);
  y += 6;

  // title block
  doc.setFont(font, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(report.title, M, y);
  y += 6;
  doc.setFont(font, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(
    [report.projectName, report.clientName].filter(Boolean).join("  •  "),
    M,
    y
  );
  y += 7;

  // summary cards
  const completed = report.completed ?? [];
  const pending = report.pending ?? [];
  const cards = [
    { label: "Completed", value: String(completed.length) },
    { label: "Pending", value: String(pending.length) },
    ...(report.billing
      ? [
          { label: "Invoiced", value: money(report.billing.invoiced) },
          { label: "Outstanding", value: money(report.billing.outstanding) },
        ]
      : []),
  ];
  const cardW = (W - (cards.length - 1) * 3) / cards.length;
  cards.forEach((c, i) => {
    const x = M + i * (cardW + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardW, 15, 1.8, 1.8, "FD");
    doc.setFont(font, "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...FAINT);
    doc.text(c.label.toUpperCase(), x + 3, y + 5);
    doc.setFont(font, "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(c.value, x + 3, y + 11.5);
  });
  y += 21;

  const section = (title: string, subtitle?: string) => {
    if (y > PAGE_H - 30) {
      doc.addPage();
      y = M;
    }
    doc.setFont(font, "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...accent);
    doc.text(title.toUpperCase(), M, y);
    y += subtitle ? 4.2 : 5;
    if (subtitle) {
      doc.setFont(font, "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...FAINT);
      doc.text(subtitle, M, y);
      y += 4.5;
    }
  };

  section("Completed this period", `${completed.length} deliverable(s)`);
  if (!completed.length) {
    doc.setFont(font, "italic");
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text("Nothing marked complete in this period.", M + 2, y + 3);
    y += 8;
  }
  completed.forEach((item, i) => {
    if (y > PAGE_H - 22) {
      doc.addPage();
      y = M;
    }
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(M, y - 1, W, 7.5, 1.2, 1.2, "FD");
    doc.setFont(font, "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(`${i + 1}. ${titleOf(item)}`, M + 3, y + 4);
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    const meta = [
      item?.tasksTotal != null ? `${item.tasksDone ?? 0}/${item.tasksTotal} tasks` : null,
      item?.completedAt ? date(item.completedAt) : null,
    ]
      .filter(Boolean)
      .join("  •  ");
    if (meta) doc.text(meta, RM - 3, y + 4, { align: "right" });
    y += 8.5;
  });
  y += 3;

  section("Pending / in progress", `${pending.length} item(s)`);
  if (!pending.length) {
    doc.setFont(font, "italic");
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text("No open items shared for this period.", M + 2, y + 3);
    y += 8;
  }
  pending.forEach((item, i) => {
    if (y > PAGE_H - 22) {
      doc.addPage();
      y = M;
    }
    doc.setDrawColor(241, 245, 249);
    doc.line(M, y + 6, RM, y + 6);
    doc.setFont(font, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(`${i + 1}. ${titleOf(item)}`, M + 3, y + 4);
    const st = statusOf(item);
    if (st) {
      doc.setFont(font, "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(180, 83, 9);
      doc.text(st.toUpperCase(), RM - 3, y + 4, { align: "right" });
    }
    y += 7.5;
  });
  y += 3;

  if (report.billing) {
    section("Billing snapshot");
    const rows: [string, string][] = [
      ["Invoiced this period", money(report.billing.invoiced)],
      ["Collected", money(report.billing.collected)],
      ["Outstanding", money(report.billing.outstanding)],
    ];
    rows.forEach(([k, v]) => {
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...SLATE);
      doc.text(k, M + 2, y);
      doc.setFont(font, "bold");
      doc.setTextColor(...INK);
      doc.text(v, RM - 3, y, { align: "right" });
      y += 4.6;
    });
    y += 3;
  }

  if (report.note) {
    section("Project manager notes");
    doc.setFont(font, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    const lines = doc.splitTextToSize(report.note, W - 4);
    for (const line of lines) {
      if (y > PAGE_H - 22) {
        doc.addPage();
        y = M;
      }
      doc.text(line, M + 2, y);
      y += 4;
    }
    y += 4;
  }

  // footer on every page
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(M, PAGE_H - 12, RM, PAGE_H - 12);
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text(
      [withImages?.appName ?? "Zoolyum", addr].filter(Boolean).join(" • ").slice(0, 95),
      M,
      PAGE_H - 8
    );
    doc.text(`Page ${i} of ${total}`, RM, PAGE_H - 8, { align: "right" });
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Shared with ${report.clientName ?? "client"} via Zoolyum Portal`,
      PAGE_W / 2,
      PAGE_H - 4.6,
      { align: "center" }
    );
  }
  return doc;
}

function detectFormat(urlOrMime: string): string {
  const s = urlOrMime.toLowerCase();
  if (s.includes("jpeg") || s.includes("jpg")) return "JPEG";
  if (s.includes("webp")) return "WEBP";
  if (s.includes("svg")) return "SVG";
  return "PNG";
}
