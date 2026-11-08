"use client";

import { jsPDF } from "jspdf";
import { ensurePdfFonts, registerPdfFonts, resolveBrandingImages, hexToRgb, type InvoiceBranding } from "./invoice-pdf";

const M = 14;
const W = 210 - M * 2;
const RM = 210 - M;

const money = (v: any) =>
  Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateShort = (d: any) => {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d).slice(0, 10) : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * Salary slip PDF.
 *
 * The payslip page could only `window.print()` — there was no file to keep,
 * forward to a bank, or attach to a visa application. This builds the same
 * sheet as a downloadable A4 PDF, reusing the invoice font pipeline so the
 * Taka sign (৳) renders correctly instead of a missing-glyph box.
 */
export async function buildPayslipPdf(data: any, branding?: InvoiceBranding | null): Promise<jsPDF> {
  const fontsOk = await ensurePdfFonts();
  const font = fontsOk ? "hind-siliguri" : "helvetica";
  const b = (await resolveBrandingImages(branding).catch(() => branding)) ?? branding;
  const accent = hexToRgb(b?.primaryColor ?? "") ?? [124, 58, 237];
  const INK: [number, number, number] = [24, 24, 27];
  const SLATE: [number, number, number] = [100, 116, 139];
  const FAINT: [number, number, number] = [148, 163, 184];

  const r = data?.record ?? {};
  const emp = data?.employee ?? {};
  const bd = r.breakdown ?? {};
  const appName = b?.appName?.trim() || data?.company?.name || "Zoolyum OS";
  const sym = "৳";

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerPdfFonts(doc);

  // ── Header ────────────────────────────────────────────────────────────
  doc.setFillColor(...accent);
  doc.rect(0, 0, 210, 4, "F");

  let y = 18;
  const logo = (b as any)?.logoBase64 as string | undefined;
  let drewLogo = false;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", M, y - 6, 34, 12, undefined, "FAST");
      drewLogo = true;
    } catch {
      /* fall through to the wordmark */
    }
  }
  if (!drewLogo) {
    doc.setFont(font, "bold");
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(appName, M, y);
  }
  const addrLine = [b?.address, b?.city, b?.country].filter(Boolean).join(", ");
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  if (addrLine) doc.text(addrLine, M, y + 5);
  if (b?.phone || b?.email) doc.text([b?.phone, b?.email].filter(Boolean).join("  •  "), M, y + 9);

  doc.setFont(font, "bold");
  doc.setFontSize(8);
  doc.setTextColor(...accent);
  doc.text("SALARY SLIP", RM, y - 2, { align: "right" });
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(String(r.period ?? "—"), RM, y + 5, { align: "right" });
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(`Status: ${String(r.status ?? "DRAFT")}`, RM, y + 10, { align: "right" });

  y += 14;
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.6);
  doc.line(M, y, RM, y);

  // ── Employee block ────────────────────────────────────────────────────
  y += 8;
  doc.setFont(font, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(emp.name ?? "Employee", M, y);
  doc.setFont(font, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  y += 5;
  doc.text([emp.roleTitle, emp.department].filter(Boolean).join(" · ") || "—", M, y);
  y += 4.2;
  doc.text(`Joined ${dateShort(emp.joinDate)} · Pay period ${r.period ?? "—"}`, M, y);

  // Net pay callout, right side of the employee block
  doc.setFillColor(245, 243, 255);
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.3);
  doc.roundedRect(RM - 62, y - 14, 62, 22, 2, 2, "FD");
  doc.setFont(font, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...accent);
  doc.text("NET PAY", RM - 59, y - 9);
  doc.setFont(font, "bold");
  doc.setFontSize(15);
  doc.setTextColor(...accent);
  doc.text(`${sym} ${money(r.netPay)}`, RM - 59, y - 1.5);

  // ── Tables ────────────────────────────────────────────────────────────
  y += 12;
  const halfW = (W - 8) / 2;
  const leftX = M;
  const rightX = M + halfW + 8;

  const sectionTitle = (label: string, x: number) => {
    doc.setFont(font, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...accent);
    doc.text(label, x, y);
  };
  const row = (label: string, value: string, x: number, yy: number, opts: { bold?: boolean; tone?: [number, number, number] } = {}) => {
    doc.setFont(font, opts.bold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.setTextColor(...(opts.tone ?? INK));
    doc.text(label, x, yy);
    doc.text(value, x + halfW, yy, { align: "right" });
  };

  const earningsY = y;
  sectionTitle("EARNINGS", leftX);
  let ey = earningsY + 6;
  const basic = Number(r.basicSalary ?? 0);
  const allow = Number(r.allowances ?? 0);
  const bonus = Number(r.bonus ?? 0);
  row("Basic salary", `${sym} ${money(basic)}`, leftX, ey); ey += 5;
  if (allow) { row("Allowances", `${sym} ${money(allow)}`, leftX, ey); ey += 5; }
  if (bonus) { row("Bonus", `${sym} ${money(bonus)}`, leftX, ey, { tone: [5, 150, 105] }); ey += 5; }
  const gross = basic + allow + bonus;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(leftX, ey - 3, leftX + halfW, ey - 3);
  row("Gross", `${sym} ${money(gross)}`, leftX, ey, { bold: true }); ey += 4;

  sectionTitle("DEDUCTIONS", rightX);
  let dy = earningsY + 6;
  const late = Number(r.lateDeduction ?? 0);
  const half = Number(r.halfDayDeduction ?? 0);
  const absent = Number(r.absentDeduction ?? 0);
  const unpaid = Number(r.unpaidLeaveDeduction ?? 0);
  const dedRows: [string, number][] = [
    ["Late arrivals", late],
    ["Half-day LOP", half],
    ["Absent days", absent],
    ["Unpaid leave", unpaid],
  ];
  for (const [label, v] of dedRows) {
    if (!v) continue;
    row(label, `- ${sym} ${money(v)}`, rightX, dy, { tone: [220, 38, 38] });
    dy += 5;
  }
  if (dy === earningsY + 6) {
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    doc.setTextColor(...FAINT);
    doc.text("No deductions this period", rightX, dy);
    dy += 5;
  }
  const totalDed = late + half + absent + unpaid;
  if (totalDed > 0) {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(rightX, dy - 4.6, rightX + halfW, dy - 4.6);
    row("Total deductions", `- ${sym} ${money(totalDed)}`, rightX, dy, { bold: true, tone: [220, 38, 38] });
    dy += 4;
  }

  y = Math.max(ey, dy) + 10;

  // ── Attendance context ────────────────────────────────────────────────
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(M, y, W, 16, 2, 2, "FD");
  doc.setFont(font, "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...accent);
  doc.text("ATTENDANCE THIS PERIOD", M + 4, y + 5.2);
  doc.setFont(font, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  const stats = [
    `Working days: ${bd.workingDays ?? "—"}`,
    `Late: ${bd.lateCount ?? 0}`,
    `Half days: ${bd.halfDays ?? 0}`,
    `Absent: ${bd.absentDays ?? 0}`,
    Number(bd.dailyRate ?? 0) > 0 ? `Daily rate: ${sym} ${money(bd.dailyRate)}` : null,
  ].filter(Boolean) as string[];
  doc.text(stats.join("     •     "), M + 4, y + 11.5);

  y += 24;

  // ── Net pay band ──────────────────────────────────────────────────────
  doc.setFillColor(...accent);
  doc.roundedRect(M, y, W, 14, 2, 2, "F");
  doc.setFont(font, "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("NET PAY", M + 4, y + 9);
  doc.setFontSize(13);
  doc.text(`${sym} ${money(r.netPay)}`, RM - 4, y + 9, { align: "right" });

  // ── Footer ────────────────────────────────────────────────────────────
  // Sit right under the content (capped near the bottom) — anchoring to the
  // page edge left a large void on a short slip.
  const footY = Math.min(272, y + 34);
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, footY - 6, RM, footY - 6);
  doc.setFont(font, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...FAINT);
  doc.text(`Generated ${dateShort(new Date())} · Deductions follow the attendance policy (late ladder, half-day cutoff, daily rate divisor).`, M, footY);
  doc.text("Authorized signature", RM, footY + 6, { align: "right" });
  doc.line(RM - 44, footY + 2, RM, footY + 2);
  doc.setFontSize(7);
  doc.text(`Powered by ${appName}`, M, footY + 10);

  return doc;
}
