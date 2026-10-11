import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { randomShareToken } from "../common/crypto";
import { invoiceTotals, ACTIVE_STATUSES } from "../capital/finance-kernel";
import { WhatsappConfigService } from "./whatsapp-config.service";
import { WhatsappSenderService } from "./whatsapp-sender.service";

const money = (v: any) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const dayOnly = (d: any) => String(d ?? "").slice(0, 10);

/**
 * Billing + task WhatsApp automation. Every send is:
 *  - toggle-gated (Control panel),
 *  - deduped (one live log per invoice+template),
 *  - audit-logged (WhatsappMessageLog + InvoiceReminder for invoices).
 */
@Injectable()
export class WhatsappTriggersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WhatsappConfigService,
    private readonly sender: WhatsappSenderService
  ) {}

  webBase(): string {
    return (process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  async ensureShareToken(invoiceId: string): Promise<string | null> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, shareToken: true, shareEnabled: true } });
    if (!inv || !inv.shareEnabled) return null;
    if (inv.shareToken) return inv.shareToken;
    const token = randomShareToken();
    await this.prisma.invoice.update({ where: { id: invoiceId }, data: { shareToken: token } }).catch(() => null);
    return token;
  }

  shareUrl(token: string): string {
    return `${this.webBase()}/p/inv/${token}`;
  }

  private async fullInvoice(id: string) {
    return this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: true,
        payments: true,
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  private async logReminder(invoiceId: string, type: string, subject: string, notes: string) {
    await this.prisma.invoiceReminder.create({ data: { invoiceId, type, channel: "whatsapp", subject, notes } }).catch(() => null);
  }

  // ── Invoice issued ────────────────────────────────────────────────
  async notifyInvoiceSent(invoiceId: string, opts: { force?: boolean } = {}) {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled || (!cfg.auto.invoiceSent && !opts.force)) return { ok: false as const, skipped: "disabled" };
    const inv: any = await this.fullInvoice(invoiceId);
    if (!inv || !ACTIVE_STATUSES.includes(inv.status)) return { ok: false as const, skipped: "not-active" };
    const rcpt = await this.sender.resolveClientRecipient(inv.clientId);
    if ("error" in rcpt) return { ok: false as const, skipped: rcpt.error };
    const token = await this.ensureShareToken(invoiceId);
    const t = invoiceTotals(inv);
    const link = token ? this.shareUrl(token) : "";
    const params = [rcpt.name, inv.invoiceNumber, inv.project?.name ?? inv.client.companyName, money(t.grand), dayOnly(inv.dueDate), link];
    const r = await this.sender.send({
      to: rcpt.to, templateName: "invoice_ready", params, buttonUrl: link || undefined,
      relatedInvoiceId: invoiceId, dedupe: true, force: opts.force,
    });
    if (r.ok && !r.skipped) await this.logReminder(invoiceId, "invoice_sent", `Invoice ${inv.invoiceNumber} sent via WhatsApp`, params.join(" | "));
    return r;
  }

  // ── Payment recorded ──────────────────────────────────────────────
  async notifyPaymentReceived(invoiceId: string, payment: { amount: number; referenceId?: string | null }, opts: { force?: boolean } = {}) {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled || (!cfg.auto.paymentReceived && !opts.force)) return { ok: false as const, skipped: "disabled" };
    const inv: any = await this.fullInvoice(invoiceId);
    if (!inv) return { ok: false as const, skipped: "not-found" };
    const rcpt = await this.sender.resolveClientRecipient(inv.clientId);
    if ("error" in rcpt) return { ok: false as const, skipped: rcpt.error };
    const t = invoiceTotals(inv);
    const receiptNo = payment.referenceId ?? `${inv.invoiceNumber}-P${(inv.payments ?? []).length}`;
    const params = [rcpt.name, money(payment.amount), inv.invoiceNumber, receiptNo, money(t.balance)];
    const r = await this.sender.send({
      to: rcpt.to, templateName: "payment_received", params,
      relatedInvoiceId: invoiceId, relatedEntityType: "Payment", relatedEntityId: receiptNo,
    });
    if (r.ok) await this.logReminder(invoiceId, "paid_receipt", `Receipt ${receiptNo} via WhatsApp`, params.join(" | "));
    return r;
  }

  // ── Manual send (staff button / Control test) ────────────────────────
  async sendInvoiceTemplate(invoiceId: string, templateName: string, opts: { force?: boolean } = {}) {
    const allowed = ["invoice_ready", "payment_due_today", "payment_overdue", "payment_received"];
    if (!allowed.includes(templateName)) return { ok: false as const, skipped: "unknown-template" };
    const inv: any = await this.fullInvoice(invoiceId);
    if (!inv) return { ok: false as const, skipped: "not-found" };
    const rcpt = await this.sender.resolveClientRecipient(inv.clientId);
    if ("error" in rcpt) return { ok: false as const, skipped: rcpt.error };
    const token = await this.ensureShareToken(invoiceId);
    const link = token ? this.shareUrl(token) : "";
    const t = invoiceTotals(inv);
    let params: (string | number)[];
    if (templateName === "payment_received") {
      const latest = (inv.payments ?? []).slice().sort((a: any, b: any) => +new Date(b.paymentDate) - +new Date(a.paymentDate))[0];
      if (!latest) return { ok: false as const, skipped: "no-payment" };
      const receiptNo = latest.referenceId ?? `${inv.invoiceNumber}-P${(inv.payments ?? []).length}`;
      params = [rcpt.name, money(latest.amount), inv.invoiceNumber, receiptNo, money(t.balance)];
    } else if (templateName === "payment_overdue") {
      const due = new Date(inv.dueDate ?? Date.now());
      const days = Math.max(Math.round((Date.now() - due.getTime()) / 86400000), 0);
      params = [rcpt.name, inv.invoiceNumber, money(t.balance), String(days), link];
    } else if (templateName === "payment_due_today") {
      params = [rcpt.name, inv.invoiceNumber, money(t.balance), link];
    } else {
      params = [rcpt.name, inv.invoiceNumber, inv.project?.name ?? inv.client.companyName, money(t.grand), dayOnly(inv.dueDate), link];
    }
    const r = await this.sender.send({
      to: rcpt.to, templateName, params, buttonUrl: link || undefined,
      relatedInvoiceId: invoiceId, dedupe: true, force: opts.force,
    });
    if (r.ok && !r.skipped) await this.logReminder(invoiceId, templateName, `${templateName} via WhatsApp (manual)`, params.join(" | "));
    return r;
  }

  // ── Daily due / overdue sweep (9:00 AM) ────────────────────────────
  @Cron("0 9 * * *")
  async dailyReminderSweep() {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled || (!cfg.auto.dueToday && !cfg.auto.overdue)) return { ran: false };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const invoices: any[] = await this.prisma.invoice.findMany({
      where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] }, dueDate: { not: null } },
      include: { lineItems: true, payments: true, client: { select: { id: true, companyName: true } }, project: { select: { id: true, name: true } } },
    });
    let sent = 0;
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      if (t.balance <= 0) continue;
      const due = new Date(inv.dueDate!);
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.round((today.getTime() - due.getTime()) / 86400000);
      let template: string | null = null;
      let reminderType = "";
      if (diffDays === 0 && cfg.auto.dueToday) { template = "payment_due_today"; reminderType = "due_today"; }
      else if (diffDays > 0 && cfg.auto.overdue) {
        template = "payment_overdue"; reminderType = diffDays <= 7 ? "overdue_1" : diffDays <= 30 ? "overdue_2" : "final_notice";
      }
      if (!template) continue;
      const already = await this.prisma.invoiceReminder.findFirst({ where: { invoiceId: inv.id, type: reminderType, channel: "whatsapp" } });
      if (already) continue;
      const rcpt = await this.sender.resolveClientRecipient(inv.clientId);
      if ("error" in rcpt) continue;
      const token = await this.ensureShareToken(inv.id);
      const link = token ? this.shareUrl(token) : "";
      const params =
        template === "payment_overdue"
          ? [rcpt.name, inv.invoiceNumber, money(t.balance), String(diffDays), link]
          : [rcpt.name, inv.invoiceNumber, money(t.balance), link];
      const r = await this.sender.send({ to: rcpt.to, templateName: template, params, buttonUrl: link || undefined, relatedInvoiceId: inv.id, dedupe: true });
      if (r.ok && !r.skipped) {
        await this.logReminder(inv.id, reminderType, `${reminderType} via WhatsApp`, params.join(" | "));
        sent++;
      }
    }
    return { ran: true, sent };
  }

  // ── Task events ───────────────────────────────────────────────────
  async notifyTaskAssigned(taskId: string) {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled || !cfg.auto.taskAssigned) return { ok: false as const, skipped: "disabled" };
    const task: any = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!task?.assignedToId) return { ok: false as const, skipped: "unassigned" };
    const rcpt = await this.sender.resolveEmployeeRecipient(task.assignedToId);
    if ("error" in rcpt) return { ok: false as const, skipped: rcpt.error };
    return this.sender.send({
      to: rcpt.to, templateName: "task_assigned",
      params: [rcpt.name, task.title, task.project?.name ?? "—", task.dueDate ? dayOnly(task.dueDate) : "—"],
      relatedEntityType: "Task", relatedEntityId: taskId,
    });
  }

  async notifyTaskClientUpdate(taskId: string) {
    const cfg = await this.config.getConfig();
    if (!cfg.enabled || !cfg.auto.taskClientUpdate) return { ok: false as const, skipped: "disabled" };
    const task: any = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { select: { id: true, name: true, clientId: true } } },
    });
    if (!task?.isClientVisible || task.status !== "DONE" || !task.project?.clientId) return { ok: false as const, skipped: "not-visible" };
    const rcpt = await this.sender.resolveClientRecipient(task.project.clientId);
    if ("error" in rcpt) return { ok: false as const, skipped: rcpt.error };
    return this.sender.send({
      to: rcpt.to, templateName: "task_update_client",
      params: [rcpt.name, task.title, task.project.name],
      relatedEntityType: "Task", relatedEntityId: taskId, dedupe: true,
    });
  }

  /** Manual / test hook: run the sweep on demand (mock-friendly). */
  async runSweepNow() {
    return this.dailyReminderSweep();
  }
}
