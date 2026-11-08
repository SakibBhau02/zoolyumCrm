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
 * A4 report + financial-statement PDF builders.
 *
 * The Capital → Reports screen is a live, scrollable dashboard. These builders
 * turn the same numbers into a printable sheet so the reports can be archived,
 * emailed to a client or handed to an accountant. Everything is drawn with the
 * invoice PDF facilities (embedded Bengali font, branding, A4 page) so a report
 * and an invoice look like they came from the same company.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;
const W = PAGE_W - M * 2;
const RM = PAGE_W - M;
const FOOTER_Y = PAGE_H - 12;

const INK: [number, number, number] = [15, 23, 42];
const SLATE: [number, number, number] = [71, 85, 105];
const FAINT: [number, number, number] = [100, 116, 139];
const FAINTER: [number, number, number] = [148, 163, 184];
const LINE: [number, number, number] = [228, 228, 231];
const ZEBRA: [number, number, number] = [248, 250, 252];

export type ReportKind = "full" | "monthly" | "six-month";

export interface ReportMonthlyRow {
  label: string;
  invoiced: number;
  collected: number;
  expenses: number;
  profit: number;
}

export interface ReportSummary {
  invoiced: number;
  collected: number;
  expenses: number;
  profit: number;
  margin: number;
  collectionRate: number;
  outstanding?: number;
  invoiceCount?: number;
}

export interface ReportData {
  kind: ReportKind;
  title: string;
  periodLabel: string;
  generatedAt?: string | Date;
  summary: ReportSummary;
  monthly?: ReportMonthlyRow[];
  byCategory?: { name: string; amount: number }[];
  byMethod?: { method: string; amount: number }[];
  byStatus?: { status: string; count: number; invoiced: number; paid: number; balance: number }[];
  expensesByCategory?: { name: string; amount: number }[];
  topClients?: { clientName: string; invoiced: number; paid: number; balance: number; invoices: number }[];
  invoices?: {
    invoiceNumber: string;
    clientName?: string;
    issueDate?: string | Date | null;
    dueDate?: string | Date | null;
    status?: string;
    amount: number;
    paid?: number;
    balance?: number;
  }[];
  expenses?: {
    date?: string | Date | null;
    description: string;
    category?: string;
    amount: number;
  }[];
  statements?: StatementBundle | null;
}

export type StatementType = "trial-balance" | "profit-loss" | "balance-sheet" | "cash-flow";

export interface StatementBundle {
  trialBalance?: any;
  profitLoss?: any;
  balanceSheet?: any;
  cashFlow?: any;
}

interface Ctx {
  doc: jsPDF;
  font: string;
  accent: [number, number, number];
  y: number;
  branding: InvoiceBranding | null;
  appName: string;
  footerLine: string;
  website: string;
  title: string;
  periodLabel: string;
  generatedAtLabel?: string;
}

// ── small helpers ──────────────────────────────────────────────────────────

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v: any) =>
  num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: any) => `${Math.round(num(v) * 100) / 100}%`;
const dash = (v: any) => (num(v) === 0 ? "—" : money(v));

function dateOf(d: any): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function titleCase(s: any): string {
  return String(s ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveAccent(branding: InvoiceBranding | null | undefined): [number, number, number] {
  if (branding?.primaryColor) {
    const rgb = hexToRgb(branding.primaryColor);
    if (rgb) return rgb;
  }
  return [124, 58, 237];
}

// ── context / page plumbing ────────────────────────────────────────────────

async function createCtx(
  title: string,
  periodLabel: string,
  branding?: InvoiceBranding | null
): Promise<Ctx> {
  const fontsLoaded = await ensurePdfFonts();
  const withImages = await resolveBrandingImages(branding ?? null);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerPdfFonts(doc);
  const font = fontsLoaded ? "hind-siliguri" : "helvetica";
  doc.setFont(font, "normal");

  return {
    doc,
    font,
    accent: resolveAccent(withImages),
    y: M,
    branding: withImages ?? null,
    appName: withImages?.appName?.trim() || "ZOOLYUM",
    footerLine: [withImages?.address, withImages?.city, withImages?.country]
      .filter(Boolean)
      .join(", ") || "Dhaka, Bangladesh",
    website: withImages?.website || "www.zoolyum.com",
    title,
    periodLabel,
  };
}

function newPage(ctx: Ctx) {
  ctx.doc.addPage();
  ctx.y = M;
}

function ensureSpace(ctx: Ctx, needed: number, reserve = 20) {
  if (ctx.y + needed > PAGE_H - reserve) newPage(ctx);
}

function hr(ctx: Ctx, color: [number, number, number] = LINE) {
  ctx.doc.setDrawColor(...color);
  ctx.doc.setLineWidth(0.25);
  ctx.doc.line(M, ctx.y, RM, ctx.y);
}

function drawLogo(ctx: Ctx, x: number, y: number): number {
  const { doc, branding, accent, appName } = ctx;
  const logo =
    branding?.logoBase64 ??
    (branding?.logoDarkUrl?.startsWith("data:") ? branding.logoDarkUrl : null);
  if (logo) {
    try {
      let w = 38;
      let h = 13;
      try {
        const props = doc.getImageProperties(logo);
        const fit = fitImageBox(props.width, props.height, 38, 13);
        w = fit.w;
        h = fit.h;
      } catch {
        /* fixed box */
      }
      doc.addImage(logo, detectImageFormat(logo), x, y + (13 - h) / 2, w, h);
      return y + 15;
    } catch {
      /* fall through to emblem */
    }
  }
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 8.5, 8.5, 2, 2, "F");
  doc.setFont(ctx.font, "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  const initials =
    appName
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ZL";
  doc.text(initials, x + 4.25, y + 5.8, { align: "center" });
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(appName, x + 11.5, y + 6.5);
  return y + 10;
}

function drawHeader(ctx: Ctx) {
  const { doc, accent } = ctx;
  let y = M;

  doc.setFillColor(...accent);
  doc.roundedRect(M, y, W, 1.8, 0.9, 0.9, "F");
  y += 6;

  const headerTop = y;
  const leftBottom = drawLogo(ctx, M, y);

  doc.setFont(ctx.font, "bold");
  doc.setFontSize(16);
  doc.setTextColor(...accent);
  doc.text(ctx.title.toUpperCase(), RM, headerTop + 6, { align: "right" });
  doc.setFont(ctx.font, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  doc.text(ctx.periodLabel, RM, headerTop + 12, { align: "right" });
  const generated =
    ctx.generatedAtLabel ??
    new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  doc.setFontSize(8);
  doc.setTextColor(...FAINT);
  doc.text(`Generated ${generated}`, RM, headerTop + 16.5, { align: "right" });

  // company block under the logo
  let ty = Math.max(leftBottom, headerTop + 11);
  const addr = [ctx.branding?.address, ctx.branding?.city, ctx.branding?.country]
    .filter(Boolean)
    .join(", ");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  if (ctx.branding?.tagline) {
    doc.setFont(ctx.font, "italic");
    doc.text(ctx.branding.tagline, M, ty);
    doc.setFont(ctx.font, "normal");
    ty += 3.8;
  }
  if (addr) {
    doc.text(addr, M, ty);
    ty += 3.8;
  }
  const contact = [ctx.branding?.phone, ctx.branding?.email].filter(Boolean).join("  •  ");
  if (contact) {
    doc.text(contact, M, ty);
    ty += 3.8;
  }
  if (ctx.branding?.taxId) {
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text(`Tax ID: ${ctx.branding.taxId}`, M, ty);
    ty += 3.8;
  }

  ctx.y = Math.max(ty, headerTop + 20) + 4;
  hr(ctx);
  ctx.y += 5;
}

function stampFooters(ctx: Ctx) {
  const { doc } = ctx;
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(M, FOOTER_Y, RM, FOOTER_Y);
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text([ctx.appName, ctx.footerLine].filter(Boolean).join(" • ").slice(0, 95), M, FOOTER_Y + 4);
    doc.text(`Page ${i} of ${total}`, RM, FOOTER_Y + 4, { align: "right" });
    doc.setFontSize(6.5);
    doc.setTextColor(...FAINTER);
    doc.text(
      `Generated by Zoolyum OS${ctx.website ? ` • ${ctx.website}` : ""}`,
      PAGE_W / 2,
      PAGE_H - 4.6,
      { align: "center" }
    );
  }
}

function sectionTitle(ctx: Ctx, title: string, subtitle?: string) {
  // Reserve enough room for the heading *and* the first table rows, otherwise
  // a heading can be stranded at the bottom of a page while its table starts
  // on the next one.
  ensureSpace(ctx, 26);
  const { doc, accent } = ctx;
  doc.setFont(ctx.font, "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...accent);
  doc.text(title.toUpperCase(), M, ctx.y);
  if (subtitle) {
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text(subtitle, M, ctx.y + 4);
    ctx.y += 6;
  } else {
    ctx.y += 5;
  }
}

/** KPI cards — three per row, two rows max. */
function kpiCards(ctx: Ctx, items: { label: string; value: string; tone?: [number, number, number] }[]) {
  const { doc } = ctx;
  const gap = 3;
  const cardW = (W - gap * 2) / 3;
  const cardH = 16;
  const rows = Math.ceil(items.length / 3);
  ensureSpace(ctx, rows * (cardH + gap) + 2);

  items.forEach((item, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = M + col * (cardW + gap);
    const y = ctx.y + row * (cardH + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cardW, cardH, 1.8, 1.8, "FD");
    doc.setFont(ctx.font, "normal");
    doc.setFontSize(6.6);
    doc.setTextColor(...FAINT);
    doc.text(item.label.toUpperCase(), x + 3, y + 5);
    doc.setFont(ctx.font, "bold");
    doc.setFontSize(11);
    doc.setTextColor(...(item.tone ?? INK));
    doc.text(item.value, x + 3, y + 12);
  });
  ctx.y += rows * (cardH + gap) + 3;
}

interface Col {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
  bold?: boolean;
}

/** Generic table with zebra rows and repeated header on page breaks. */
function table(ctx: Ctx, cols: Col[], rows: (string | number)[][], emptyLabel = "No data") {
  const { doc, accent } = ctx;
  const rowH = 6.2;
  const headerH = 7;
  const drawHeader = () => {
    doc.setFillColor(248, 250, 252);
    doc.rect(M, ctx.y, W, headerH, "F");
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.line(M, ctx.y + headerH, RM, ctx.y + headerH);
    doc.setFont(ctx.font, "bold");
    doc.setFontSize(7);
    doc.setTextColor(...SLATE);
    let x = M;
    for (const c of cols) {
      const tx =
        c.align === "right" ? x + c.width - 2 : c.align === "center" ? x + c.width / 2 : x + 2;
      doc.text(c.header, tx, ctx.y + 4.6, { align: c.align === "center" ? "center" : c.align });
      x += c.width;
    }
    ctx.y += headerH;
  };

  ensureSpace(ctx, headerH + rowH * Math.min(rows.length || 1, 3));
  drawHeader();

  if (!rows.length) {
    doc.setFont(ctx.font, "italic");
    doc.setFontSize(8);
    doc.setTextColor(...FAINTER);
    doc.text(emptyLabel, M + 2, ctx.y + 4.5);
    ctx.y += rowH + 2;
    return;
  }

  rows.forEach((row, ri) => {
    if (ctx.y + rowH > PAGE_H - 16) {
      newPage(ctx);
      drawHeader();
    }
    if (ri % 2 === 1) {
      doc.setFillColor(...ZEBRA);
      doc.rect(M, ctx.y, W, rowH, "F");
    }
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.15);
    doc.line(M, ctx.y + rowH, RM, ctx.y + rowH);

    let x = M;
    row.forEach((cell, ci) => {
      const c = cols[ci];
      if (!c) return;
      doc.setFont(ctx.font, c.bold ? "bold" : "normal");
      doc.setFontSize(7.6);
      doc.setTextColor(...(c.bold ? INK : SLATE));
      const text = String(cell ?? "");
      const maxChars = Math.max(6, Math.floor(c.width / 1.55));
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
      const tx =
        c.align === "right" ? x + c.width - 2 : c.align === "center" ? x + c.width / 2 : x + 2;
      doc.text(clipped, tx, ctx.y + 4.2, {
        align: c.align === "center" ? "center" : c.align,
      });
      x += c.width;
    });
    ctx.y += rowH;
  });
  ctx.y += 4;
}

/** A compact three-column footer band used for cross-checks (balanced, totals). */
function noteBand(ctx: Ctx, text: string, tone: [number, number, number] = SLATE) {
  ensureSpace(ctx, 12);
  const { doc } = ctx;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.roundedRect(M, ctx.y, W, 9, 1.5, 1.5, "FD");
  doc.setFont(ctx.font, "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(...tone);
  doc.text(text, M + 3, ctx.y + 5.6);
  ctx.y += 12;
}

function detectImageFormat(urlOrMime: string): string {
  const s = urlOrMime.toLowerCase();
  if (s.includes("jpeg") || s.includes("jpg")) return "JPEG";
  if (s.includes("svg")) return "SVG";
  if (s.includes("webp")) return "WEBP";
  return "PNG";
}

// ── business report ────────────────────────────────────────────────────────

export async function buildBusinessReportPdf(
  input: ReportData,
  branding?: InvoiceBranding | null
): Promise<jsPDF> {
  const ctx = await createCtx(input.title, input.periodLabel, branding);
  ctx.generatedAtLabel = input.generatedAt ? dateOf(input.generatedAt) : undefined;

  drawHeader(ctx);

  const s = input.summary;
  kpiCards(ctx, [
    { label: "Invoiced", value: money(s.invoiced) },
    { label: "Collected", value: money(s.collected), tone: [5, 150, 105] },
    { label: "Expenses", value: money(s.expenses), tone: [225, 29, 72] },
    { label: "Net Profit", value: money(s.profit), tone: s.profit >= 0 ? [5, 150, 105] : [225, 29, 72] },
    { label: "Profit Margin", value: pct(s.margin) },
    { label: "Collection Rate", value: pct(s.collectionRate) },
  ]);

  if (input.monthly && input.monthly.length > 0) {
    sectionTitle(
      ctx,
      input.monthly.length === 1 ? "Monthly Summary" : "Month-by-Month",
      input.monthly.length === 1 ? input.monthly[0].label : `${input.monthly.length} months in range`
    );
    table(
      ctx,
      [
        { header: "Month", width: 58 },
        { header: "Invoiced", width: 31, align: "right" },
        { header: "Collected", width: 31, align: "right" },
        { header: "Expenses", width: 31, align: "right" },
        { header: "Profit", width: 31, align: "right", bold: true },
      ],
      input.monthly.map((m) => [
        m.label,
        money(m.invoiced),
        money(m.collected),
        money(m.expenses),
        money(m.profit),
      ])
    );
  }

  if (input.byCategory?.length) {
    sectionTitle(ctx, "Invoiced by Type");
    table(
      ctx,
      [
        { header: "Type", width: 122 },
        { header: "Amount", width: 60, align: "right", bold: true },
      ],
      input.byCategory.map((c) => [titleCase(c.name), money(c.amount)])
    );
  }

  if (input.byMethod?.length) {
    sectionTitle(ctx, "Collections by Payment Method");
    table(
      ctx,
      [
        { header: "Method", width: 122 },
        { header: "Amount", width: 60, align: "right", bold: true },
      ],
      input.byMethod.map((c) => [titleCase(c.method), money(c.amount)])
    );
  }

  if (input.expensesByCategory?.length) {
    sectionTitle(ctx, "Expenses by Category");
    table(
      ctx,
      [
        { header: "Category", width: 122 },
        { header: "Amount", width: 60, align: "right", bold: true },
      ],
      input.expensesByCategory.map((c) => [titleCase(c.name), money(c.amount)])
    );
  }

  if (input.byStatus?.length) {
    sectionTitle(ctx, "Invoice Status Breakdown");
    table(
      ctx,
      [
        { header: "Status", width: 52 },
        { header: "Count", width: 26, align: "right" },
        { header: "Invoiced", width: 36, align: "right" },
        { header: "Paid", width: 36, align: "right" },
        { header: "Balance", width: 32, align: "right", bold: true },
      ],
      input.byStatus.map((r) => [
        titleCase(r.status),
        String(r.count),
        money(r.invoiced),
        money(r.paid),
        money(r.balance),
      ])
    );
  }

  if (input.topClients?.length) {
    sectionTitle(ctx, "Top Clients", "ranked by invoiced value");
    table(
      ctx,
      [
        { header: "Client", width: 84 },
        { header: "Invoices", width: 22, align: "center" },
        { header: "Invoiced", width: 30, align: "right" },
        { header: "Paid", width: 28, align: "right" },
        { header: "Balance", width: 18, align: "right", bold: true },
      ],
      input.topClients.map((c) => [
        c.clientName,
        String(c.invoices),
        money(c.invoiced),
        money(c.paid),
        money(c.balance),
      ])
    );
  }

  if (input.statements) {
    const pl = input.statements.profitLoss;
    const bs = input.statements.balanceSheet;
    const cf = input.statements.cashFlow;
    if (pl || bs || cf) {
      sectionTitle(ctx, "Statement Highlights", "trial balance · P&L · balance sheet · cash flow");
      const rows: (string | number)[][] = [];
      if (pl) rows.push(["Total revenue", money(pl.totalRevenue ?? 0)]);
      if (pl) rows.push(["Total expenses", money(pl.totalExpenses ?? 0)]);
      if (pl) rows.push(["Net profit", money(pl.netIncome ?? 0)]);
      if (bs) rows.push(["Total assets", money(bs.totalAssets ?? 0)]);
      if (bs) rows.push(["Total liabilities", money(bs.totalLiabilities ?? 0)]);
      if (bs) rows.push(["Equity", money(bs.equity ?? 0)]);
      if (cf) rows.push(["Net operating cash flow", money(cf.netOperating ?? 0)]);
      if (cf) rows.push(["Closing cash balance", money(cf.closingBalance ?? 0)]);
      table(
        ctx,
        [
          { header: "Metric", width: 122 },
          { header: "Amount", width: 60, align: "right", bold: true },
        ],
        rows
      );
      if (input.statements.trialBalance) {
        noteBand(
          ctx,
          `Trial balance ${Math.abs(num(input.statements.trialBalance.totalDebit) - num(input.statements.trialBalance.totalCredit)) < 0.01 ? "is balanced" : "is NOT balanced"} · Debits ${money(input.statements.trialBalance.totalDebit)} = Credits ${money(input.statements.trialBalance.totalCredit)}`,
          Math.abs(num(input.statements.trialBalance.totalDebit) - num(input.statements.trialBalance.totalCredit)) < 0.01
            ? [5, 150, 105]
            : [185, 28, 28]
        );
      }
    }
  }

  if (input.invoices?.length) {
    sectionTitle(ctx, "Invoices in Period", `${input.invoices.length} invoice(s)`);
    table(
      ctx,
      [
        { header: "Invoice", width: 34 },
        { header: "Client", width: 62 },
        { header: "Date", width: 28 },
        { header: "Status", width: 26 },
        { header: "Amount", width: 32, align: "right", bold: true },
      ],
      input.invoices.slice(0, 40).map((i) => [
        i.invoiceNumber,
        i.clientName ?? "—",
        dateOf(i.issueDate),
        titleCase(i.status),
        money(i.amount),
      ])
    );
  }

  if (input.expenses?.length) {
    sectionTitle(ctx, "Expenses in Period", `${input.expenses.length} entry(ies)`);
    table(
      ctx,
      [
        { header: "Date", width: 28 },
        { header: "Description", width: 96 },
        { header: "Category", width: 30 },
        { header: "Amount", width: 28, align: "right", bold: true },
      ],
      input.expenses.slice(0, 40).map((e) => [
        dateOf(e.date),
        e.description,
        titleCase(e.category),
        money(e.amount),
      ])
    );
  }

  stampFooters(ctx);
  return ctx.doc;
}

// ── financial statements ───────────────────────────────────────────────────

const STATEMENT_TITLES: Record<StatementType, string> = {
  "trial-balance": "Trial Balance",
  "profit-loss": "Profit & Loss Statement",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow Statement",
};

export async function buildStatementPdf(
  type: StatementType,
  data: any,
  branding?: InvoiceBranding | null,
  periodLabel = "As of today"
): Promise<jsPDF> {
  const ctx = await createCtx(STATEMENT_TITLES[type], periodLabel, branding);
  drawHeader(ctx);

  if (type === "trial-balance") {
    const rows = data?.rows ?? [];
    const balanced = Math.abs(num(data?.totalDebit) - num(data?.totalCredit)) < 0.01;
    sectionTitle(ctx, "Ledger Accounts", `${rows.length} account(s)`);
    table(
      ctx,
      [
        { header: "Account", width: 78 },
        { header: "Code", width: 22 },
        { header: "Debit", width: 28, align: "right" },
        { header: "Credit", width: 28, align: "right" },
        { header: "Balance", width: 26, align: "right", bold: true },
      ],
      rows.map((r: any) => [
        r.name,
        r.code ?? "—",
        dash(r.debit),
        dash(r.credit),
        money(r.balance),
      ])
    );
    table(
      ctx,
      [
        { header: "Totals", width: 100, bold: true },
        { header: "Debit", width: 28, align: "right", bold: true },
        { header: "Credit", width: 28, align: "right", bold: true },
        { header: "Difference", width: 26, align: "right", bold: true },
      ],
      [
        [
          "",
          money(data?.totalDebit),
          money(data?.totalCredit),
          money(num(data?.totalDebit) - num(data?.totalCredit)),
        ],
      ]
    );
    noteBand(
      ctx,
      balanced
        ? `Balanced — debits equal credits at ${money(data?.totalDebit)}.`
        : `Out of balance by ${money(num(data?.totalDebit) - num(data?.totalCredit))}.`,
      balanced ? [5, 150, 105] : [185, 28, 28]
    );
  }

  if (type === "profit-loss") {
    sectionTitle(ctx, "Revenue");
    table(
      ctx,
      [
        { header: "Account", width: 100 },
        { header: "Code", width: 30 },
        { header: "Amount", width: 52, align: "right", bold: true },
      ],
      (data?.revenue ?? []).map((r: any) => [r.name, r.code ?? "—", money(r.amount)])
    );
    sectionTitle(ctx, "Expenses");
    table(
      ctx,
      [
        { header: "Account", width: 100 },
        { header: "Code", width: 30 },
        { header: "Amount", width: 52, align: "right", bold: true },
      ],
      (data?.expenses ?? []).map((r: any) => [r.name, r.code ?? "—", money(r.amount)])
    );
    sectionTitle(ctx, "Result");
    table(
      ctx,
      [
        { header: "Metric", width: 122 },
        { header: "Amount", width: 60, align: "right", bold: true },
      ],
      [
        ["Total revenue", money(data?.totalRevenue)],
        ["Direct cost", money(data?.totalDirectCost)],
        ["Gross profit", money(data?.grossProfit)],
        ["Total expenses", money(data?.totalExpenses)],
        ["Net profit", money(data?.netIncome)],
        ["Profit margin", pct(data?.margin)],
      ]
    );
  }

  if (type === "balance-sheet") {
    sectionTitle(ctx, "Assets");
    table(
      ctx,
      [
        { header: "Account", width: 100 },
        { header: "Code", width: 30 },
        { header: "Amount", width: 52, align: "right", bold: true },
      ],
      (data?.assets ?? []).map((r: any) => [r.name, r.code ?? "—", money(r.amount)])
    );
    sectionTitle(ctx, "Liabilities");
    table(
      ctx,
      [
        { header: "Account", width: 100 },
        { header: "Code", width: 30 },
        { header: "Amount", width: 52, align: "right", bold: true },
      ],
      (data?.liabilities ?? []).map((r: any) => [r.name, r.code ?? "—", money(r.amount)])
    );
    sectionTitle(ctx, "Equity & Totals");
    table(
      ctx,
      [
        { header: "Metric", width: 122 },
        { header: "Amount", width: 60, align: "right", bold: true },
      ],
      [
        ["Total assets", money(data?.totalAssets)],
        ["Total liabilities", money(data?.totalLiabilities)],
        ["Equity", money(data?.equity)],
      ]
    );
    noteBand(
      ctx,
      data?.balanced
        ? "Balance sheet is balanced — assets equal liabilities plus equity."
        : "Balance sheet does not balance — review the ledger.",
      data?.balanced ? [5, 150, 105] : [185, 28, 28]
    );
  }

  if (type === "cash-flow") {
    sectionTitle(
      ctx,
      "Cash Movement",
      `opening ${money(data?.openingBalance)} · closing ${money(data?.closingBalance)}`
    );
    table(
      ctx,
      [
        { header: "Reference", width: 64 },
        { header: "Date", width: 28 },
        { header: "In", width: 28, align: "right" },
        { header: "Out", width: 28, align: "right" },
        { header: "Net", width: 34, align: "right", bold: true },
      ],
      (data?.detail ?? []).map((d: any) => [
        d.label,
        dateOf(d.date),
        dash(d.in),
        dash(d.out),
        money(d.net),
      ])
    );
    sectionTitle(ctx, "Summary");
    table(
      ctx,
      [
        { header: "Metric", width: 122 },
        { header: "Amount", width: 60, align: "right", bold: true },
      ],
      [
        ["Net operating cash flow", money(data?.netOperating)],
        ["Opening balance", money(data?.openingBalance)],
        ["Closing balance", money(data?.closingBalance)],
        ["Net change", money(data?.netChange)],
      ]
    );
  }

  stampFooters(ctx);
  return ctx.doc;
}

export function statementLabel(type: StatementType): string {
  return STATEMENT_TITLES[type];
}

/** Convenience: month bounds as `YYYY-MM-DD` for `<input type="month">` values. */
export function monthBounds(monthValue: string): { from: string; to: string; label: string } {
  const [y, m] = monthValue.split("-").map((v) => Number(v));
  const year = Number.isFinite(y) ? y : new Date().getFullYear();
  const month = Number.isFinite(m) ? m - 1 : new Date().getMonth();
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    from: iso(from),
    to: iso(to),
    label: from.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
  };
}

/** Six-month window ending with the month that contains `monthValue`. */
export function sixMonthBounds(monthValue: string): { from: string; to: string; label: string } {
  const { to } = monthBounds(monthValue);
  const [y, m] = monthValue.split("-").map((v) => Number(v));
  const year = Number.isFinite(y) ? y : new Date().getFullYear();
  const month = Number.isFinite(m) ? m - 1 : new Date().getMonth();
  const start = new Date(year, month - 5, 1);
  const end = new Date(year, month + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    from: iso(start),
    to: iso(end) || to,
    label: `${start.toLocaleDateString("en-GB", { month: "short", year: "numeric" })} — ${end.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`,
  };
}
