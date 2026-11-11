"use client";

import { jsPDF } from "jspdf";
import { ensurePdfFonts, registerPdfFonts, hexToRgb } from "./invoice-pdf";
import { dhakaDay } from "./calendar-date";

type Lang = "EN" | "BN";

const COPY = {
  EN: {
    plan: "Content plan",
    prepared: "Prepared",
    period: "Period",
    client: "Client",
    posts: "Posts",
    tasks: "Tasks",
    meetings: "Meetings",
    ads: "Ad flights",
    platformMix: "Platform mix",
    platform: "Platform",
    count: "Count",
    target: "Target",
    schedule: "Schedule",
    date: "Date",
    time: "Time",
    title: "Title",
    type: "Type",
    owner: "Owner",
    status: "Status",
    approval: "Approval",
    notes: "Notes",
    generated: "Generated",
    page: "Page",
    of: "of",
    none: "Nothing planned for this period.",
    signoff: "Client sign-off",
    name: "Name",
    signature: "Signature",
    dateLine: "Date",
    planned: "Planned",
    actual: "Actual",
    variance: "Plan vs actual",
    metric: "Metric",
    delta: "Delta",
    slipped: "Slipped items",
    reason: "Reason",
    onTime: "Published on time",
    approved: "Approved",
    inReview: "In review",
    draft: "Draft",
  },
  BN: {
    plan: "কনটেন্ট প্ল্যান",
    prepared: "প্রস্তুতকারী",
    period: "সময়কাল",
    client: "ক্লায়েন্ট",
    posts: "পোস্ট",
    tasks: "টাস্ক",
    meetings: "মিটিং",
    ads: "অ্যাড ফ্লাইট",
    platformMix: "প্ল্যাটফর্ম মিক্স",
    platform: "প্ল্যাটফর্ম",
    count: "সংখ্যা",
    target: "লক্ষ্য",
    schedule: "সময়সূচি",
    date: "তারিখ",
    time: "সময়",
    title: "শিরোনাম",
    type: "ধরন",
    owner: "দায়িত্বে",
    status: "অবস্থা",
    approval: "অনুমোদন",
    notes: "নোট",
    generated: "তৈরি",
    page: "পৃষ্ঠা",
    of: "/",
    none: "এই সময়ের জন্য কিছু পরিকল্পনা করা হয়নি।",
    signoff: "ক্লায়েন্ট স্বাক্ষর",
    name: "নাম",
    signature: "স্বাক্ষর",
    dateLine: "তারিখ",
    planned: "পরিকল্পিত",
    actual: "বাস্তব",
    variance: "প্ল্যান বনাম বাস্তব",
    metric: "মেট্রিক",
    delta: "পার্থক্য",
    slipped: "পিছিয়ে যাওয়া আইটেম",
    reason: "কারণ",
    onTime: "সময়মতো পাবলিশ",
    approved: "অনুমোদিত",
    inReview: "রিভিউতে",
    draft: "খসড়া",
  },
};

const PRETTY: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  TIKTOK: "TikTok",
  X: "X",
  YOUTUBE: "YouTube",
  GOOGLE_BUSINESS: "Google Business",
  PINTEREST: "Pinterest",
  THREADS: "Threads",
  CONTENT_POST: "Post",
  EVENT: "Event",
  TASK: "Task",
  AD_FLIGHT: "Ad flight",
  MILESTONE: "Milestone",
  DELIVERABLE: "Deliverable",
  PUBLISHED: "Published",
  SCHEDULED: "Scheduled",
  DRAFT: "Draft",
  MISSED: "Missed",
  FAILED: "Failed",
  APPROVED: "Approved",
  INTERNAL_REVIEW: "In review",
  REJECTED: "Rejected",
  PENDING: "Pending",
  DONE: "Done",
  NO_SHOW: "No show",
  CANCELLED: "Cancelled",
  RESCHEDULED: "Rescheduled",
  DELIVERED: "Delivered",
};

const pretty = (v?: string | null) => (v ? PRETTY[v] ?? v.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

const PRETTY_BN: Record<string, string> = {
  CONTENT_POST: "পোস্ট",
  EVENT: "ইভেন্ট",
  TASK: "টাস্ক",
  AD_FLIGHT: "অ্যাড ফ্লাইট",
  MILESTONE: "মাইলস্টোন",
  DELIVERABLE: "ডেলিভারেবল",
  PUBLISHED: "প্রকাশিত",
  SCHEDULED: "নির্ধারিত",
  DRAFT: "খসড়া",
  MISSED: "মিস",
  FAILED: "ব্যর্থ",
  APPROVED: "অনুমোদিত",
  INTERNAL_REVIEW: "রিভিউতে",
  REJECTED: "বাতিল",
  PENDING: "অপেক্ষমাণ",
  DONE: "সম্পন্ন",
  NO_SHOW: "অনুপস্থিত",
  CANCELLED: "বাতিল",
  RESCHEDULED: "পুনঃনির্ধারিত",
  DELIVERED: "ডেলিভারড",
  LIVE: "লাইভ",
  PLANNED: "পরিকল্পিত",
};

function periodLabel(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${from} → ${to}`;
}

/**
 * Client-ready plan document. Deliberately deterministic: everything on the
 * page comes from the plan's immutable payload, so a PDF exported today and a
 * PDF exported in three weeks say the same thing.
 */
export async function buildCalendarPlanPdf(
  plan: any,
  opts?: { language?: Lang; primaryColor?: string; appName?: string; logoBase64?: string | null; clientName?: string }
): Promise<jsPDF> {
  const lang: Lang = opts?.language === "BN" ? "BN" : "EN";
  if (lang === "BN") await ensurePdfFonts().catch(() => false);
  const t = COPY[lang];

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerPdfFonts(doc);
  const font = lang === "BN" ? "hind-siliguri" : "helvetica";
  const setFont = (style: "normal" | "bold" = "normal") => doc.setFont(font, style);
  const pv = (v?: string | null) => (lang === "BN" ? PRETTY_BN[v ?? ""] ?? pretty(v) : pretty(v));

  const primary = hexToRgb(opts?.primaryColor ?? "") ?? [124, 58, 237];
  const [pr, pg, pb] = primary;
  const M = 14;
  const W = 210 - M * 2;
  const PAGE_H = 297;

  const payload = plan.payload ?? {};
  const items: any[] = Array.isArray(payload.items) ? payload.items : [];
  const meta = payload.meta ?? {};
  const totals = payload.totals ?? plan.totals ?? {};
  const clientName = opts?.clientName ?? meta.clientName ?? plan.client?.companyName ?? "—";
  const from = meta.from ?? dhakaDay(plan.periodStart);
  const to = meta.to ?? dhakaDay(plan.periodEnd);

  let page = 1;
  const footer = () => {
    setFont("normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 150);
    doc.text(`${opts?.appName ?? "Zoolyum OS"} · ${t.generated} ${new Date().toLocaleString("en-GB")}`, M, PAGE_H - 8);
    doc.text(`${t.page} ${page}`, 210 - M, PAGE_H - 8, { align: "right" });
    doc.setTextColor(30, 30, 40);
  };

  // ── Cover band ─────────────────────────────────────────────────────
  doc.setFillColor(pr, pg, pb);
  doc.rect(0, 0, 210, 34, "F");
  if (opts?.logoBase64) {
    try {
      doc.addImage(opts.logoBase64, "PNG", M, 8, 16, 16);
    } catch {
      /* logo format unsupported — text still carries the brand */
    }
  }
  setFont("bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  const coverTitle = clientName && clientName !== "—" ? `${clientName} — ${t.plan}` : t.plan;
  doc.text(coverTitle, M + (opts?.logoBase64 ? 20 : 0), 15);
  setFont("normal");
  doc.setFontSize(9.5);
  doc.text(`${t.period}: ${periodLabel(from, to)}`, M + (opts?.logoBase64 ? 20 : 0), 22);
  doc.setFontSize(8);
  doc.text(`${t.prepared}: ${plan.createdBy?.name ?? plan.createdByName ?? "Project team"} · v${plan.version ?? 1}`, M + (opts?.logoBase64 ? 20 : 0), 28);
  doc.text(`${from} → ${to}`, 210 - M, 22, { align: "right" });
  doc.setTextColor(30, 30, 40);

  let y = 44;

  // ── Totals ─────────────────────────────────────────────────────────
  const cards: [string, number | string][] = [
    [t.posts, totals.posts ?? 0],
    [t.tasks, totals.tasks ?? 0],
    [t.meetings, totals.meetings ?? 0],
    [t.ads, totals.ads ?? 0],
  ];
  const cw = (W - 3 * 4) / 4;
  cards.forEach(([label, value], i) => {
    const x = M + i * (cw + 4);
    doc.setFillColor(247, 247, 250);
    doc.roundedRect(x, y, cw, 18, 2, 2, "F");
    setFont("normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 132);
    doc.text(label.toUpperCase(), x + 3, y + 6);
    setFont("bold");
    doc.setFontSize(14);
    doc.setTextColor(30, 30, 40);
    doc.text(String(value), x + 3, y + 14);
  });
  y += 26;

  // ── Platform mix ───────────────────────────────────────────────────
  const targets: Record<string, number> = meta.postingTargets ?? {};
  const byPlatform: Record<string, number> = totals.byPlatform ?? {};
  if (Object.keys(byPlatform).length || Object.keys(targets).length) {
    setFont("bold");
    doc.setFontSize(10.5);
    doc.text(t.platformMix, M, y);
    y += 4;
    const rows = [...new Set([...Object.keys(byPlatform), ...Object.keys(targets)])];
    const colW = [70, 30, 30];
    doc.setFillColor(245, 245, 248);
    doc.rect(M, y, W, 7, "F");
    setFont("bold");
    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 122);
    doc.text(t.platform, M + 2, y + 4.6);
    doc.text(t.count, M + colW[0] + 2, y + 4.6);
    doc.text(t.target, M + colW[0] + colW[1] + 2, y + 4.6);
    y += 7;
    setFont("normal");
    doc.setTextColor(40, 40, 50);
    doc.setFontSize(8);
    for (const p of rows) {
      doc.text(pretty(p), M + 2, y + 4.2);
      doc.text(String(byPlatform[p] ?? 0), M + colW[0] + 2, y + 4.2);
      doc.text(targets[p] != null ? String(targets[p]) : "—", M + colW[0] + colW[1] + 2, y + 4.2);
      y += 6;
      doc.setDrawColor(232, 232, 238);
      doc.line(M, y - 1, M + W, y - 1);
    }
    y += 8;
  }

  // ── Schedule table ─────────────────────────────────────────────────
  const drawHead = () => {
    doc.setFillColor(245, 245, 248);
    doc.rect(M, y, W, 7, "F");
    setFont("bold");
    doc.setFontSize(7.2);
    doc.setTextColor(110, 110, 122);
    const cols = [
      [t.date, 2],
      [t.time, 22],
      [t.title, 36],
      [t.type, 96],
      [t.owner, 122],
      [t.status, 152],
      [t.approval, 176],
    ] as [string, number][];
    for (const [label, x] of cols) doc.text(label, M + x, y + 4.6);
    y += 7;
    doc.setTextColor(40, 40, 50);
  };

  const ensureSpace = (needed: number) => {
    if (y + needed < PAGE_H - 18) return;
    footer();
    doc.addPage();
    page += 1;
    y = 18;
  };

  setFont("bold");
  doc.setFontSize(10.5);
  doc.setTextColor(30, 30, 40);
  ensureSpace(14);
  doc.text(t.schedule, M, y);
  y += 5;
  ensureSpace(10);
  drawHead();

  const scheduled = items
    .filter((i) => i.source !== "TASK" || i.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time ?? "").localeCompare(String(b.time ?? "")));

  if (!scheduled.length) {
    setFont("normal");
    doc.setFontSize(8.5);
    doc.text(t.none, M + 2, y + 5);
    y += 10;
  }

  for (const it of scheduled) {
    ensureSpace(8);
    setFont("normal");
    doc.setFontSize(7.6);
    const titleLines = doc.splitTextToSize(it.title ?? "", 58) as string[];
    const hasPlatforms = Array.isArray(it.platforms) && it.platforms.length > 0;
    const rowH = Math.max(6, titleLines.length * 3.4 + 2.4 + (hasPlatforms ? 3.4 : 0));
    ensureSpace(rowH);
    doc.text(String(it.date ?? "").slice(5), M + 2, y + 4.2);
    doc.text(it.time ?? "All day", M + 22, y + 4.2);
    doc.text(titleLines, M + 36, y + 4.2);
    doc.text(pv(it.source), M + 96, y + 4.2);
    doc.text(doc.splitTextToSize(it.owner || "—", 28) as string[], M + 122, y + 4.2);
    doc.text(pv(it.status), M + 152, y + 4.2);
    doc.text(pv(it.approval), M + 176, y + 4.2);
    // Platforms sit under the title so the row stays readable.
    if (hasPlatforms) {
      doc.setFontSize(6.4);
      doc.setTextColor(120, 120, 132);
      doc.text(it.platforms.map((p: string) => pretty(p)).join(" · "), M + 36, y + 8.4);
      doc.setTextColor(40, 40, 50);
    }
    y += rowH;
    doc.setDrawColor(235, 235, 240);
    doc.line(M, y - 1.2, M + W, y - 1.2);
  }

  // ── Notes ──────────────────────────────────────────────────────────
  if (plan.notes) {
    ensureSpace(18);
    y += 4;
    setFont("bold");
    doc.setFontSize(9.5);
    doc.text(t.notes, M, y);
    y += 4;
    setFont("normal");
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(plan.notes, W) as string[];
    for (const line of lines) {
      ensureSpace(5);
      doc.text(line, M, y + 3);
      y += 4.4;
    }
  }

  // ── Sign-off ───────────────────────────────────────────────────────
  ensureSpace(30);
  y += 8;
  setFont("bold");
  doc.setFontSize(9);
  doc.text(t.signoff, M, y);
  y += 6;
  setFont("normal");
  doc.setFontSize(7.5);
  doc.setDrawColor(200, 200, 208);
  doc.line(M, y + 8, M + 60, y + 8);
  doc.text(t.name, M, y + 6);
  doc.line(M + 70, y + 8, M + 120, y + 8);
  doc.text(t.signature, M + 70, y + 6);
  doc.line(M + 130, y + 8, M + 170, y + 8);
  doc.text(t.dateLine, M + 130, y + 6);

  footer();
  return doc;
}

/** Plan vs actual sheet — the accountability half of the monthly report. */
export function buildVariancePdf(
  variance: any,
  plan: any,
  opts?: { language?: Lang; primaryColor?: string; clientName?: string }
): jsPDF {
  const lang: Lang = opts?.language === "BN" ? "BN" : "EN";
  const t = COPY[lang];
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerPdfFonts(doc);
  const font = lang === "BN" ? "hind-siliguri" : "helvetica";
  doc.setFont(font, "normal");
  const pv = (v?: string | null) => (lang === "BN" ? PRETTY_BN[v ?? ""] ?? pretty(v) : pretty(v));
  const primary = hexToRgb(opts?.primaryColor ?? "") ?? [124, 58, 237];
  const M = 14;
  const W = 210 - M * 2;

  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, 210, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont(font, "bold");
  doc.setFontSize(14);
  doc.text(`${opts?.clientName ?? ""} — ${t.variance}`.trim(), M, 14);
  doc.setFont(font, "normal");
  doc.setFontSize(9);
  doc.text(plan?.title ?? "", M, 21);
  doc.setTextColor(30, 30, 40);

  let y = 42;
  doc.setFont(font, "bold");
  doc.setFontSize(10);
  doc.text(plan?.title ?? "", M, y);
  y += 6;
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.text(`${t.period}: ${dhakaDay(variance?.plan?.periodStart)} → ${dhakaDay(variance?.plan?.periodEnd)}`, M, y);
  y += 8;

  const metrics: [string, any, any][] = [
    [t.posts, variance?.planned?.posts ?? 0, variance?.actual?.published ?? 0],
    [t.tasks, variance?.planned?.tasks ?? 0, `${variance?.planned?.tasks ?? 0} planned`],
    [t.meetings, variance?.planned?.meetings ?? 0, "—"],
    [t.ads, variance?.planned?.ads ?? 0, "—"],
    [t.onTime, "—", `${variance?.actual?.onTimePct ?? 100}%`],
  ];

  doc.setFillColor(245, 245, 248);
  doc.rect(M, y, W, 7, "F");
  doc.setFont(font, "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(110, 110, 122);
  doc.text(t.metric, M + 2, y + 4.6);
  doc.text(t.planned, M + 70, y + 4.6);
  doc.text(t.actual, M + 120, y + 4.6);
  y += 7;
  doc.setTextColor(40, 40, 50);
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  for (const [m, p, a] of metrics) {
    doc.text(String(m), M + 2, y + 4.2);
    doc.text(String(p), M + 70, y + 4.2);
    doc.text(String(a), M + 120, y + 4.2);
    y += 6;
    doc.setDrawColor(235, 235, 240);
    doc.line(M, y - 1, M + W, y - 1);
  }

  if (Array.isArray(variance?.slipped) && variance.slipped.length) {
    y += 8;
    doc.setFont(font, "bold");
    doc.setFontSize(9.5);
    doc.text(t.slipped, M, y);
    y += 6;
    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 122);
    doc.text(t.title, M + 2, y);
    doc.text(t.date, M + 96, y);
    doc.text(t.actual, M + 126, y);
    doc.text(t.reason, M + 158, y);
    y += 4;
    doc.setTextColor(40, 40, 50);
    doc.setFont(font, "normal");
    for (const s of variance.slipped.slice(0, 40)) {
      if (y > 275) {
        doc.addPage();
        y = 18;
      }
      doc.text(doc.splitTextToSize(s.title ?? "", 88) as string[], M + 2, y + 3);
      doc.text(pv(s.actual), M + 96, y + 3);
      doc.text(String(s.reason ?? ""), M + 126, y + 3);
      doc.text(String(s.actualDay ?? s.actual ?? ""), M + 158, y + 3);
      y += 6;
      doc.setDrawColor(238, 238, 242);
      doc.line(M, y - 1.5, M + W, y - 1.5);
    }
  }

  doc.setFontSize(7.5);
  doc.setTextColor(140, 140, 150);
  doc.text(`${t.generated} ${new Date().toLocaleString("en-GB")}`, M, 289);
  return doc;
}

export function downloadPdf(doc: jsPDF, filename: string) {
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
