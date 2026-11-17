import { jsPDF } from "jspdf";
import {
  ensurePdfFonts,
  fitImageBox,
  hexToRgb,
  registerPdfFonts,
  resolveBrandingImages,
  type InvoiceBranding,
} from "./invoice-pdf";
import type { ProjectReport, ReportDeliverableItem } from "./types";

/**
 * Project progress report → A4 PDF.
 *
 * Built from the report's stored snapshot, never from live data: what the
 * screen showed is what the client receives, even months later.
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
const CARD_BG: [number, number, number] = [248, 250, 252];

const KIND_LABEL: Record<string, string> = {
  GRAPHIC: "Graphics",
  VIDEO: "Video",
  PHOTO: "Photo",
  COPY: "Copy",
  OTHER: "Other",
};

function detectFormat(urlOrMime: string): string {
  const s = urlOrMime.toLowerCase();
  if (s.includes("jpeg") || s.includes("jpg")) return "JPEG";
  if (s.includes("webp")) return "WEBP";
  if (s.includes("svg")) return "SVG";
  return "PNG";
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (currency: string, v: unknown) =>
  `${currency === "BDT" ? "BDT " : `${currency} `}${num(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const day = (v: unknown) =>
  v
    ? new Date(v as string).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const shortDay = (v: unknown) =>
  v
    ? new Date(v as string).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : "—";

function groupLabel(
  item: ReportDeliverableItem,
  groupBy: string | null | undefined
): string {
  if (groupBy === "KIND") return KIND_LABEL[item.kind ?? "OTHER"] ?? "Other";
  if (groupBy === "OWNER") return item.ownerName ?? "Unassigned";
  if (groupBy === "NONE") return "All deliverables";
  return item.campaignName ?? "No campaign";
}

export async function buildProjectReportPdf(
  report: ProjectReport,
  project: {
    name: string;
    clientName?: string | null;
    currency?: string | null;
    pmName?: string | null;
  },
  opts?: { branding?: InvoiceBranding | null }
): Promise<jsPDF> {
  const fontsLoaded = await ensurePdfFonts();
  // Branding is a nicety: a broken logo URL must never block the report.
  let withImages: InvoiceBranding | null | undefined = null;
  if (opts?.branding) {
    try {
      withImages = await resolveBrandingImages(opts.branding);
    } catch {
      withImages = null;
    }
  }
  const font = fontsLoaded ? "hind-siliguri" : "helvetica";
  const accent: [number, number, number] =
    (withImages?.primaryColor && hexToRgb(withImages.primaryColor)) || [124, 58, 237];
  const currency = String(project.currency ?? "BDT");

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerPdfFonts(doc);
  doc.setFont(font, "normal");

  let y = M;

  // ── header ────────────────────────────────────────────────────────
  doc.setFillColor(...accent);
  doc.roundedRect(M, y, W, 1.8, 0.9, 0.9, "F");
  y += 6;

  // Company logo when the branding row has one — same rule as the invoice sheet.
  const logo =
    withImages?.logoBase64 ??
    (withImages?.logoDarkUrl?.startsWith("data:") ? withImages.logoDarkUrl : null);
  if (logo) {
    try {
      let w = 34;
      let h = 10;
      try {
        const props = doc.getImageProperties(logo);
        const fit = fitImageBox(props.width, props.height, 34, 10);
        w = fit.w;
        h = fit.h;
      } catch {}
      doc.addImage(logo, detectFormat(logo), M, y + (10 - h) / 2, w, h);
      y += 12;
    } catch {
      y += 2;
    }
  }

  if (!logo) {
    doc.setFillColor(...accent);
    doc.roundedRect(M, y, 8.5, 8.5, 2, 2, "F");
    doc.setFont(font, "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text("ZO", M + 4.25, y + 5.8, { align: "center" });
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(withImages?.appName ?? "Zoolyum OS", M + 11.5, y + 6);
  }

  doc.setFont(font, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...accent);
  doc.text("PROJECT REPORT", RM, y + 4, { align: "right" });
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(`${day(report.periodStart)} — ${day(report.periodEnd)}`, RM, y + 9, {
    align: "right",
  });
  y += 14;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, y, RM, y);
  y += 6;

  // ── title block ───────────────────────────────────────────────────
  doc.setFont(font, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  const titleLines = doc.splitTextToSize(String(report.title ?? "Progress report"), W).slice(0, 2);
  titleLines.forEach((line: string, i: number) => doc.text(line, M, y + i * 5.6));
  y += titleLines.length * 5.6 + 1.5;

  doc.setFont(font, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(
    [project.name, project.clientName].filter(Boolean).join("  •  "),
    M,
    y
  );
  y += 4.2;
  doc.setFontSize(7.5);
  doc.setTextColor(...FAINT);
  doc.text(
    [
      project.pmName ? `PM: ${project.pmName}` : null,
      report.campaignLabel ? `Campaign: ${report.campaignLabel}` : null,
      `Generated ${day(report.createdAt)}`,
    ]
      .filter(Boolean)
      .join("  •  "),
    M,
    y
  );
  y += 7;

  // ── summary cards ─────────────────────────────────────────────────
  const summary = report.summary;
  const cards = summary
    ? [
        { label: "Delivered (period)", value: String(summary.deliveredInPeriod) },
        { label: "Pending", value: String(summary.pending) },
        { label: "Total committed", value: String(summary.total) },
        { label: "Shoots", value: String(summary.shoots?.count ?? 0) },
      ]
    : [
        { label: "Completed", value: String(report.completed.length) },
        { label: "Pending", value: String(report.pending.length) },
      ];
  const cardW = (W - (cards.length - 1) * 3) / cards.length;
  cards.forEach((c, i) => {
    const x = M + i * (cardW + 3);
    doc.setFillColor(...CARD_BG);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardW, 15, 1.8, 1.8, "FD");
    doc.setFont(font, "normal");
    doc.setFontSize(6.4);
    doc.setTextColor(...FAINT);
    doc.text(c.label.toUpperCase(), x + 3, y + 5);
    doc.setFont(font, "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(c.value, x + 3, y + 11.5);
  });
  y += 21;

  const section = (heading: string, subtitle?: string) => {
    if (y > PAGE_H - 32) {
      doc.addPage();
      y = M;
    }
    doc.setFont(font, "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...accent);
    doc.text(heading.toUpperCase(), M, y);
    y += subtitle ? 4.2 : 5;
    if (subtitle) {
      doc.setFont(font, "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...FAINT);
      doc.text(subtitle, M, y);
      y += 4.5;
    }
  };

  const empty = (text: string) => {
    doc.setFont(font, "italic");
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(text, M + 2, y + 3);
    y += 8;
  };

  // ── type breakdown ────────────────────────────────────────────────
  if (summary?.byKind && Object.keys(summary.byKind).length) {
    section("Breakdown by type", "Committed vs delivered in the whole project scope");
    const rows = Object.entries(summary.byKind).map(([kind, bucket]) => ({
      kind: KIND_LABEL[kind] ?? kind,
      delivered: bucket.delivered,
      pending: bucket.pending,
      total: bucket.total,
    }));
    const colW = [W - 60, 20, 20, 20];
    const x0 = M;
    doc.setFont(font, "bold");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text("TYPE", x0 + 1, y);
    doc.text("DELIVERED", x0 + colW[0] + colW[1] - 1, y, { align: "right" });
    doc.text("PENDING", x0 + colW[0] + colW[1] + colW[2] - 1, y, { align: "right" });
    doc.text("TOTAL", x0 + colW[0] + colW[1] + colW[2] + colW[3] - 1, y, { align: "right" });
    y += 3;
    doc.setDrawColor(...LINE);
    doc.line(M, y, RM, y);
    y += 4;
    rows.forEach((r) => {
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...INK);
      doc.text(r.kind, x0 + 1, y);
      doc.setTextColor(16, 122, 87);
      doc.text(String(r.delivered), x0 + colW[0] + colW[1] - 1, y, { align: "right" });
      doc.setTextColor(...SLATE);
      doc.text(String(r.pending), x0 + colW[0] + colW[1] + colW[2] - 1, y, { align: "right" });
      doc.setFont(font, "bold");
      doc.setTextColor(...INK);
      doc.text(String(r.total), x0 + colW[0] + colW[1] + colW[2] + colW[3] - 1, y, {
        align: "right",
      });
      y += 5;
    });
    y += 2;
  }

  // ── delivered, grouped ────────────────────────────────────────────
  const groupBy = report.groupBy ?? "CAMPAIGN";
  const deliveredGroups = new Map<string, ReportDeliverableItem[]>();
  for (const item of report.completed ?? []) {
    const key = groupLabel(item, groupBy);
    deliveredGroups.set(key, [...(deliveredGroups.get(key) ?? []), item]);
  }

  section("Delivered this period", `${(report.completed ?? []).length} item(s)`);
  if (!deliveredGroups.size) empty("Nothing marked delivered in this period.");
  for (const [group, items] of deliveredGroups) {
    if (y > PAGE_H - 24) {
      doc.addPage();
      y = M;
    }
    doc.setFont(font, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(`${group} · ${items.length}`, M + 1, y);
    y += 4.5;
    items.forEach((item, i) => {
      if (y > PAGE_H - 20) {
        doc.addPage();
        y = M;
      }
      doc.setFillColor(...CARD_BG);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(M, y - 1.5, W, 8, 1.2, 1.2, "FD");
      doc.setFont(font, "bold");
      doc.setFontSize(7.8);
      doc.setTextColor(...INK);
      const line = doc.splitTextToSize(
        `${i + 1}. ${item.topic || item.title}`,
        W - 52
      )[0];
      doc.text(String(line ?? ""), M + 3, y + 2.5);
      doc.setFont(font, "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(...FAINT);
      const meta = [
        item.objective,
        item.completedAt ? day(item.completedAt) : null,
        item.tasksTotal ? `${item.tasksDone ?? 0}/${item.tasksTotal} tasks` : null,
      ]
        .filter(Boolean)
        .join("  •  ");
      if (meta) doc.text(meta, M + 3, y + 5.6);
      doc.setFont(font, "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(16, 122, 87);
      doc.text(KIND_LABEL[item.kind ?? "OTHER"] ?? "Other", RM - 3, y + 2.5, {
        align: "right",
      });
      y += 9;
    });
    y += 2;
  }
  y += 1;

  // ── pending ───────────────────────────────────────────────────────
  const pendingGroups = new Map<string, ReportDeliverableItem[]>();
  for (const item of report.pending ?? []) {
    const key = groupLabel(item, groupBy);
    pendingGroups.set(key, [...(pendingGroups.get(key) ?? []), item]);
  }

  section("Pending / in progress", `${(report.pending ?? []).length} item(s)`);
  if (!pendingGroups.size) empty("No open items — everything committed has shipped.");
  for (const [group, items] of pendingGroups) {
    if (y > PAGE_H - 24) {
      doc.addPage();
      y = M;
    }
    doc.setFont(font, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(`${group} · ${items.length}`, M + 1, y);
    y += 4.5;
    items.forEach((item) => {
      if (y > PAGE_H - 18) {
        doc.addPage();
        y = M;
      }
      doc.setDrawColor(241, 245, 249);
      doc.line(M, y + 4.5, RM, y + 4.5);
      doc.setFont(font, "normal");
      doc.setFontSize(7.8);
      doc.setTextColor(...INK);
      const line = doc.splitTextToSize(item.topic || item.title, W - 62)[0];
      doc.text(String(line ?? ""), M + 1, y + 2.5);
      doc.setFontSize(6.8);
      doc.setTextColor(...FAINT);
      doc.text(
        [
          KIND_LABEL[item.kind ?? "OTHER"] ?? "Other",
          item.ownerName ? `owner: ${item.ownerName}` : null,
          item.dueDate ? `due ${shortDay(item.dueDate)}` : null,
        ]
          .filter(Boolean)
          .join("  •  "),
        M + 1,
        y + 6.2
      );
      y += 8;
    });
    y += 1.5;
  }
  y += 2;

  // ── shoots ────────────────────────────────────────────────────────
  const shoots = report.shoots ?? [];
  section(
    "Shoots in this period",
    summary?.shoots
      ? `${summary.shoots.count} shoot(s) · ${summary.shoots.fullDays} full day · ${summary.shoots.halfDays} half day · ${summary.shoots.crewCount} crew · ${summary.shoots.equipmentCount} equipment`
      : `${shoots.length} shoot(s)`
  );
  if (!shoots.length) empty("No production days in this period.");
  shoots.forEach((shoot) => {
    const crewLines = (shoot.crew ?? []).map(
      (c) => `${c.role.replace(/_/g, " ").toLowerCase()}: ${c.name}${c.isConfirmed ? " ✓" : ""}`
    );
    const equipment = (shoot.equipment ?? []).join(", ");
    const notes = [crewLines.join("   •   "), equipment ? `Gear: ${equipment}` : null]
      .filter(Boolean)
      .join("\n");
    const noteLines = notes ? doc.splitTextToSize(notes, W - 6) : [];
    const boxH = 10 + noteLines.length * 3.4;
    if (y + boxH > PAGE_H - 18) {
      doc.addPage();
      y = M;
    }
    doc.setFillColor(...CARD_BG);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(M, y - 1, W, boxH, 1.6, 1.6, "FD");
    doc.setFont(font, "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(String(shoot.title ?? "Shoot"), M + 3, y + 3.5);
    doc.setFont(font, "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...FAINT);
    doc.text(
      `${day(shoot.date)}${shoot.endDate ? ` → ${day(shoot.endDate)}` : ""}  •  ${
        shoot.duration === "FULL_DAY" ? "full day" : "half day"
      }${shoot.callTime ? `  •  ${shoot.callTime}${shoot.wrapTime ? `–${shoot.wrapTime}` : ""}` : ""}  •  ${
        shoot.location ?? "location TBC"
      }`,
      M + 3,
      y + 7.2
    );
    if (noteLines.length) {
      doc.setTextColor(...SLATE);
      noteLines.forEach((line: string, i: number) => {
        doc.text(line, M + 3, y + 10.6 + i * 3.4);
      });
    }
    y += boxH + 3;
  });
  y += 1;

  // ── billing ───────────────────────────────────────────────────────
  if (report.billing) {
    section("Billing snapshot", `Period · ${currency}`);
    const rows: [string, string][] = [
      ["Invoiced this period", money(currency, report.billing.invoiced)],
      ["Collected", money(currency, report.billing.collected)],
      ["Outstanding", money(currency, report.billing.outstanding)],
    ];
    rows.forEach(([k, v]) => {
      if (y > PAGE_H - 18) {
        doc.addPage();
        y = M;
      }
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...SLATE);
      doc.text(k, M + 1, y);
      doc.setFont(font, "bold");
      doc.setTextColor(...INK);
      doc.text(v, RM - 1, y, { align: "right" });
      doc.setDrawColor(...LINE);
      doc.line(M, y + 2, RM, y + 2);
      y += 6;
    });
    y += 2;
  }

  // ── notes ─────────────────────────────────────────────────────────
  if (report.pmNotes?.trim()) {
    section("Notes from the project lead");
    const lines = doc.splitTextToSize(report.pmNotes.trim(), W - 4);
    for (const line of lines) {
      if (y > PAGE_H - 20) {
        doc.addPage();
        y = M;
      }
      doc.setFont(font, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...SLATE);
      doc.text(line, M + 1, y);
      y += 3.9;
    }
  }

  // ── footers ───────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont(font, "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...FAINT);
    doc.text(`${project.name} — ${report.title}`, M, PAGE_H - 8);
    doc.text(`Page ${p} of ${pages}`, RM, PAGE_H - 8, { align: "right" });
  }

  return doc;
}
