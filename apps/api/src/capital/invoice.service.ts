import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InvoiceStatus, RevenueTag } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LedgerService, CapitalDb } from "./ledger.service";
import { ReportingService } from "./reporting.service";
import { WhatsappTriggersService } from "../whatsapp/whatsapp-triggers.service";
import { ACTIVE_STATUSES, POSTABLE_STATUSES, invalidateFinance, invoiceTotals, logAudit, notifyRole } from "./finance-kernel";

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly reporting: ReportingService,
    private readonly wa: WhatsappTriggersService
  ) {}


  private async recomputeInvoiceStatus(invoiceId: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true, payments: true } });
    if (!inv) return;
    const t = invoiceTotals(inv);
    if (inv.status === "DRAFT" || inv.status === "CANCELLED" || inv.status === "VOID") return;
    // Zero-paid PAID/PARTIALLY_PAID rows are corrupt (e.g. payments removed) —
    // demote to SENT so the invoice re-enters the collection flow.
    const status =
      t.paidIn >= t.grand && t.grand > 0 ? "PAID"
      : t.paidIn > 0 ? "PARTIALLY_PAID"
      : (inv.status === "PAID" || inv.status === "PARTIALLY_PAID" ? "SENT" : inv.status);
    if (status !== inv.status) await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
    return { total: t.grand, paid: t.paidIn };
  }


  private async applyOverpayment(invoice: any, db: CapitalDb = this.prisma) {
    if (!invoice) return;
    const t = invoiceTotals(invoice);
    const excess = Math.round((t.paidIn - t.grand) * 100) / 100;
    if (excess > 0) {
      await db.creditBalance.create({ data: { clientId: invoice.clientId, amount: excess, currency: invoice.currency, source: `Overpayment on ${invoice.invoiceNumber}` } });
    }
  }

  // ── Project billing sync ─────────────────────────────────────────────


  async syncProjectBilling(projectId: string | null | undefined) {
    if (!projectId) return;
    const invoices = await this.prisma.invoice.findMany({
      where: { projectId, status: { in: ACTIVE_STATUSES as InvoiceStatus[] } },
      include: { lineItems: true, payments: true },
    });
    const totalBilled = invoices.reduce((s, i) => s + i.lineItems.reduce((x, l) => x + Number(l.amount), 0), 0);
    const outstanding = invoices.reduce(
      (s, i) => s + Math.max(invoiceTotals(i).grand - i.payments.reduce((x, p) => x + Number(p.amount), 0), 0),
      0
    );
    const paymentStatus = totalBilled === 0 ? "PENDING" : outstanding <= 0 ? "PAID" : "PARTIAL";
    await this.prisma.project
      .update({ where: { id: projectId }, data: { totalBilled: Math.round(totalBilled * 100) / 100, paymentStatus } })
      .catch(() => {});
  }

  // ── Bank account ledger ──────────────────────────────────────────────


  async invoices(query: { status?: string; clientId?: string; q?: string }) {
    return this.prisma.invoice.findMany({
      where: {
        ...(query.status ? { status: query.status as InvoiceStatus } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.q ? { OR: [{ invoiceNumber: { contains: query.q, mode: "insensitive" } }, { client: { companyName: { contains: query.q, mode: "insensitive" } } }] } : {}),
      },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
        lineItems: true,
        payments: { select: { id: true, amount: true, paymentMethod: true, paymentDate: true } },
      },
      orderBy: { issueDate: "desc" },
    });
  }


  async invoiceDetail(id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true, contacts: { select: { id: true, name: true, email: true, phone: true } } } },
        project: { select: { id: true, name: true } },
        lineItems: true,
        installments: { orderBy: { sequence: "asc" } },
        payments: { include: { recordedBy: { select: { name: true } }, installment: { select: { sequence: true } } }, orderBy: { paymentDate: "desc" } },
        creditNotes: { orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } } } },
        reminders: { orderBy: { sentAt: "desc" } },
      },
    });
    if (!inv) throw new NotFoundException("Invoice not found");
    // Self-heal: payment status must always agree with actual payments.
    const t = invoiceTotals(inv);
    let healed = inv.status;
    if (["PAID", "PARTIALLY_PAID"].includes(inv.status)) {
      healed = t.paidIn >= t.grand && t.grand > 0 ? "PAID" : t.paidIn > 0 ? "PARTIALLY_PAID" : "SENT";
    } else if (["SENT", "VIEWED", "OVERDUE"].includes(inv.status) && t.grand > 0 && t.paidIn >= t.grand) {
      healed = "PAID";
    }
    if (healed !== inv.status) {
      await this.prisma.invoice.update({ where: { id }, data: { status: healed } });
      (inv as any).status = healed;
    }
    // Chronological receipt serials (earliest payment = 1, stable ties) —
    // every consumer (detail modal, portal, PDFs) numbers from this.
    const chrono = [...(inv.payments ?? [])].sort((a: any, b: any) =>
      +new Date(a.paymentDate) - +new Date(b.paymentDate) ||
      +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0) ||
      String(a.id).localeCompare(String(b.id)));
    (inv as any).payments = (inv.payments ?? []).map((p: any) => ({
      ...p,
      serial: chrono.findIndex((x: any) => x.id === p.id) + 1,
    }));
    return inv;
  }

  /**
   * Running project balance for an invoice (one-time projects only).
   * Answers: project value? paid so far? due now? plus per-invoice
   * breakdown and payment history for the client-facing statement.
   */
  async projectBalance(invoiceId: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, projectId: true } });
    if (!inv) throw new NotFoundException("Invoice not found");
    if (!inv.projectId) return { project: null, reason: "NO_PROJECT" };
    const fin = await this.reporting.projectFinance(inv.projectId);
    if (fin.project.billingType !== "ONE_TIME") return { project: fin.project, reason: "RECURRING" };
    const value = Math.round(Number(fin.project.budgetAmount ?? fin.totalInvoiced) * 100) / 100;
    const paid = Math.round(fin.collected * 100) / 100;
    return {
      project: fin.project,
      value,
      totalInvoiced: Math.round(fin.totalInvoiced * 100) / 100,
      paid,
      due: Math.round(Math.max(value - paid, 0) * 100) / 100,
      advance: Math.round(Math.max(paid - value, 0) * 100) / 100,
      invoices: fin.invoices,
      payments: fin.payments,
    };
  }

  // ── Invoice reminders (log-first; delivery via notification center) ────


  async listReminders(invoiceId: string) {
    return this.prisma.invoiceReminder.findMany({ where: { invoiceId }, orderBy: { sentAt: "desc" } });
  }


  async logReminder(invoiceId: string, body: { type: string; channel?: string; recipientEmail?: string; recipientName?: string; subject?: string; notes?: string }, actorId?: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: { select: { companyName: true, contacts: { select: { name: true, email: true } } } }, lineItems: true, payments: true },
    });
    if (!inv) throw new NotFoundException("Invoice not found");
    const t = invoiceTotals(inv);
    const primary = inv.client.contacts[0];
    const reminder = await this.prisma.invoiceReminder.create({
      data: {
        invoiceId,
        type: body.type,
        channel: body.channel ?? "system",
        recipientEmail: body.recipientEmail ?? primary?.email ?? undefined,
        recipientName: body.recipientName ?? primary?.name ?? inv.client.companyName,
        subject: body.subject ?? `Payment reminder — ${inv.invoiceNumber} (${t.balance.toLocaleString()} due)`,
        notes: body.notes,
        sentById: actorId,
      },
    });
    try {
      await this.notifications.notifyRole(
        "Finance",
        "INVOICE_REMINDER",
        `Reminder sent — ${inv.invoiceNumber}`,
        `${body.type} reminder logged for ${inv.client.companyName} (${inv.invoiceNumber}). Balance ৳${t.balance.toLocaleString()}.`,
        `/capital/invoices?inv=${invoiceId}`,
        actorId
      );
    } catch {}
    await logAudit(this.prisma, "Invoice", invoiceId, "reminder_logged", { type: body.type, channel: reminder.channel }, actorId);
    return reminder;
  }


  async nextInvoiceNumberPreview() {
    return { invoiceNumber: await this.ledger.nextInvoiceNumber() };
  }


  async createInvoice(body: any, createdById?: string) {
    if (!body.clientId) {
      throw new BadRequestException("clientId is required");
    }
    const client = await this.prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true } }).catch(() => null);
    if (!client) throw new NotFoundException("Client not found");
    let invoiceNumber: string = (body.invoiceNumber ?? "").trim() || (await this.ledger.nextInvoiceNumber());
    const clash = await this.prisma.invoice.findUnique({ where: { invoiceNumber } }).catch(() => null);
    if (clash) invoiceNumber = await this.ledger.nextInvoiceNumber();
    const discountRate = body.discountRate != null && body.discountRate !== "" ? Number(body.discountRate) : null;
    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          clientId: body.clientId,
          projectId: body.projectId,
          invoiceType: body.invoiceType ?? "ONE_TIME",
          currency: body.currency ?? "BDT",
          exchangeRate: body.exchangeRate ?? 1,
          issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          status: body.status ?? "DRAFT",
          taxApplicable: body.taxApplicable ?? false,
          taxRate: body.taxRate ?? null,
          discountRate,
          discountAmount: 0,
          shippingFee: body.shippingFee ?? 0,
          templateStyle: body.templateStyle ?? "modern-orange",
          terms: body.terms,
          paymentDetails: body.paymentDetails ?? undefined,
          notes: body.notes,
          createdById,
          lineItems: {
            create: (body.lines ?? body.lineItems ?? []).map((l: any) => {
              const quantity = l.quantity ?? 1;
              const unitPrice = l.unitPrice ?? (l.amount ? l.amount / quantity : 0);
              return {
                description: l.description,
                quantity,
                unitPrice,
                amount: (l.amount ?? unitPrice) * quantity,
                revenueTag: (l.revenueTag as RevenueTag) ?? "AGENCY_REVENUE",
              };
            }),
          },
        },
        include: { client: { select: { id: true, companyName: true } }, lineItems: true },
      });
      const createdTotals = invoiceTotals(created);
      if (createdTotals.discount !== Number(created.discountAmount ?? 0)) {
        await tx.invoice.update({ where: { id: created.id }, data: { discountAmount: createdTotals.discount } });
        (created as any).discountAmount = createdTotals.discount;
      }
      if (body.installments?.length) {
        await tx.installment.createMany({
          data: body.installments.map((s: any, i: number) => ({
            invoiceId: created.id,
            sequence: i + 1,
            amount: s.amount,
            dueDate: new Date(s.dueDate),
          })),
        });
      }
      if (POSTABLE_STATUSES.includes(created.status)) await this.ledger.postInvoiceGL(created, createdById, tx);
      await logAudit(tx, "Invoice", created.id, "created", { invoiceNumber });
      return created;
    }, { timeout: 15000 });
    try {
      await this.notifications.notifyRole(
        "Finance",
        "INVOICE_CREATED",
        "New Invoice Created",
        `Invoice ${invoice.invoiceNumber} for ${invoice.client.companyName} has been created.`,
        "/capital",
        createdById
      );
    } catch {}
    await this.syncProjectBilling(body.projectId ?? null);
    await invalidateFinance(this.cache);
    // WhatsApp automation (never blocks the request)
    if (ACTIVE_STATUSES.includes(invoice.status)) void this.wa.notifyInvoiceSent(invoice.id).catch(() => {});
    return invoice;
  }


  async updateInvoice(id: string, body: any, actorId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } });
    if (!existing) throw new NotFoundException("Invoice not found");
    const data: any = {};
    for (const f of ["status", "invoiceType", "issueDate", "dueDate", "taxApplicable", "taxRate", "discountRate", "shippingFee", "templateStyle", "terms", "paymentDetails", "notes", "projectId", "clientId", "currency", "exchangeRate"]) {
      if (body[f] === undefined || body[f] === "") continue;
      data[f] = f.includes("Date") && body[f] ? new Date(body[f]) : body[f];
    }
    if (body.dueDate === null) data.dueDate = null;
    const wasPosted = POSTABLE_STATUSES.includes(existing.status);
    const willPost = body.status !== undefined ? POSTABLE_STATUSES.includes(body.status) : wasPosted;
    const postedBefore = wasPosted || willPost;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (body.lines) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        data.lineItems = {
          create: body.lines.map((l: any) => ({
            description: l.description,
            quantity: l.quantity ?? 1,
            unitPrice: l.unitPrice,
            amount: (l.quantity ?? 1) * l.unitPrice,
            revenueTag: (l.revenueTag as RevenueTag) ?? "AGENCY_REVENUE",
          })),
        };
      }
      if (body.installments) {
        await tx.installment.deleteMany({ where: { invoiceId: id } });
        data.installments = {
          create: body.installments.map((s: any, i: number) => ({
            sequence: i + 1,
            amount: s.amount,
            dueDate: new Date(s.dueDate),
          })),
        };
      }
      if (postedBefore && (body.lines || body.installments || body.status !== undefined || body.taxApplicable !== undefined || body.taxRate !== undefined || body.discountRate !== undefined || body.shippingFee !== undefined || body.issueDate !== undefined)) {
        await this.ledger.reverseGL(id, actorId, tx);
      }
      const next = await tx.invoice.update({
        where: { id },
        data,
        include: { client: { select: { id: true, companyName: true } }, lineItems: true, payments: true },
      });
      const updatedTotals = invoiceTotals(next);
      if (updatedTotals.discount !== Number((next as any).discountAmount ?? 0)) {
        await tx.invoice.update({ where: { id }, data: { discountAmount: updatedTotals.discount } });
        (next as any).discountAmount = updatedTotals.discount;
      }
      if (wasPosted || willPost) await this.ledger.postInvoiceGL(next, actorId, tx);
      await logAudit(tx, "Invoice", id, "updated", { from: existing.status, to: body.status ?? existing.status }, actorId);
      return next;
    }, { timeout: 15000 });
    if (body.projectId && body.projectId !== existing.projectId) {
      await this.syncProjectBilling(existing.projectId);
    }
    await this.syncProjectBilling(body.projectId ?? existing.projectId);
    await invalidateFinance(this.cache);
    // first activation (DRAFT → SENT etc.) triggers the invoice_issued WhatsApp
    if (body.status && !ACTIVE_STATUSES.includes(existing.status) && ACTIVE_STATUSES.includes(body.status)) {
      void this.wa.notifyInvoiceSent(id).catch(() => {});
    }
    return updated;
  }


  async duplicateInvoice(id: string) {
    const src = await this.prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } });
    if (!src) throw new NotFoundException("Invoice not found");
    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber: await this.ledger.nextInvoiceNumber(),
        clientId: src.clientId,
        projectId: src.projectId,
        invoiceType: src.invoiceType,
        issueDate: new Date(),
        dueDate: src.dueDate,
        status: "DRAFT",
        taxApplicable: src.taxApplicable,
        taxRate: src.taxRate,
        discountRate: src.discountRate,
        shippingFee: src.shippingFee,
        templateStyle: src.templateStyle,
        terms: src.terms,
        paymentDetails: src.paymentDetails ?? undefined,
        notes: src.notes,
        lineItems: {
          create: src.lineItems.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            revenueTag: l.revenueTag,
          })),
        },
      },
      include: { lineItems: true },
    });
    const dupTotals = invoiceTotals(invoice);
    if (dupTotals.discount > 0) {
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { discountAmount: dupTotals.discount } });
    }
    await this.syncProjectBilling(src.projectId);
    await invalidateFinance(this.cache);
    return invoice;
  }


  async deleteInvoice(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: { payments: true } }).catch(() => null);
    if (!inv) throw new NotFoundException("Invoice not found");
    await this.prisma.$transaction(async (tx) => {
      for (const p of inv.payments) {
        if (p.balanceCredited && p.bankAccountId && p.type === "IN") {
          await this.ledger.debitBankAccount(p.bankAccountId, Number(p.amount), tx);
        }
        if (p.balanceCredited && p.bankAccountId && p.type === "REFUND") {
          await this.ledger.creditBankAccount(p.bankAccountId, Number(p.amount), tx);
        }
      }
      await this.ledger.reverseGL(id, undefined, tx);
      await tx.invoice.delete({ where: { id } });
      await logAudit(tx, "Invoice", id, "deleted", {});
    }, { timeout: 15000 });
    await this.syncProjectBilling(inv.projectId);
    await invalidateFinance(this.cache);
    return { ok: true };
  }


  async recordPayment(invoiceId: string, body: { amount: number; paymentMethod: string; referenceId?: string; paymentDate?: string; notes?: string; bankAccountId?: string; installmentId?: string }, recordedById?: string) {
    if (body.amount === undefined || body.amount === null || Number.isNaN(Number(body.amount)) || Number(body.amount) <= 0) {
      throw new BadRequestException("Payment amount must be greater than zero");
    }
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, payments: true, installments: { orderBy: { sequence: "asc" } }, client: { select: { id: true, companyName: true } } },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    const t = invoiceTotals(invoice);
    const total = t.grand;
    const paidSoFar = t.paidIn;
    // All money movement is atomic: installment, payment, bank, GL, status
    // commit together or roll back together.
    const saved = await this.prisma.$transaction(async (tx) => {
      let installmentId = body.installmentId ?? null;
      if (invoice.installments.length) {
        const target = invoice.installments.find((s) => s.id === body.installmentId) ?? invoice.installments.find((s) => s.status !== "PAID");
        if (target) {
          installmentId = target.id;
          await tx.installment.update({
            where: { id: target.id },
            data: { paidAmount: { increment: body.amount }, status: Number(target.paidAmount) + body.amount >= Number(target.amount) ? "PAID" : "PARTIAL" },
          });
        }
      }
      const referenceId = body.referenceId ?? (installmentId ? `${invoice.invoiceNumber}/#${invoice.installments.find((s) => s.id === installmentId)?.sequence ?? 1}` : null);
      const payment = await tx.payment.create({
        data: {
          invoiceId,
          installmentId,
          amount: body.amount,
          paymentMethod: body.paymentMethod as any,
          referenceId,
          paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
          notes: body.notes,
          recordedById,
        },
      });
      const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount(tx));
      if (bankId) {
        await this.ledger.creditBankAccount(bankId, Number(body.amount), tx);
        await tx.payment.update({ where: { id: payment.id }, data: { bankAccountId: bankId, balanceCredited: true } });
      }
      const [acctBank, acctAR] = await Promise.all([this.ledger.accountByCode("1200", tx), this.ledger.accountByCode("1100", tx)]);
      await this.ledger.postGL(
        "PAYMENT",
        `${invoice.invoiceNumber} / ${referenceId ?? payment.id}`,
        body.paymentDate ? new Date(body.paymentDate) : new Date(),
        invoiceId,
        null,
        [
          { accountId: acctBank.id, debit: Number(body.amount), credit: 0 },
          { accountId: acctAR.id, debit: 0, credit: Number(body.amount) },
        ],
        recordedById,
        tx
      );
      const paid = paidSoFar + Number(body.amount);
      const status = paid >= total ? "PAID" : "PARTIALLY_PAID";
      await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
      await logAudit(tx, "Invoice", invoiceId, "payment_recorded", { amount: body.amount, status, installment: installmentId ?? null });
      const updatedInvoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true, payments: true, client: { select: { id: true } } } });
      if (updatedInvoice) await this.applyOverpayment(updatedInvoice, tx);
      return tx.payment.findUnique({ where: { id: payment.id } });
    }, { timeout: 15000 });
    try {
      const full = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { createdById: true } });
      const paid = paidSoFar + Number(body.amount);
      const status = paid >= total ? "PAID" : "PARTIALLY_PAID";
      const msg = `${invoice.client.companyName} paid ৳${Number(body.amount).toLocaleString()} on ${invoice.invoiceNumber}${status === "PAID" ? " — fully paid ✓" : ""}.`;
      await this.notifications.notifyRole("Finance", "INVOICE_PAID", status === "PAID" ? "Invoice fully paid" : "Payment recorded", msg, "/capital", recordedById);
      await this.notifications.notifyRole("Owner", "INVOICE_PAID", status === "PAID" ? "Invoice fully paid" : "Payment recorded", msg, "/capital", recordedById);
      if (full?.createdById && full.createdById !== recordedById) {
        await this.notifications.create(full.createdById, "INVOICE_PAID", status === "PAID" ? "Invoice fully paid" : "Payment recorded", msg, "/capital");
      }
    } catch {}
    await this.syncProjectBilling(invoice.projectId);
    await invalidateFinance(this.cache);
    void this.wa.notifyPaymentReceived(invoiceId, { amount: Number(body.amount), referenceId: (saved as any)?.referenceId ?? null }).catch(() => {});
    return saved;
  }

  // ── Public share links + WhatsApp manual hooks ─────────────────────

  async shareInfo(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, select: { id: true, shareToken: true, shareEnabled: true } });
    if (!inv) throw new NotFoundException("Invoice not found");
    return { hasToken: !!inv.shareToken, shareEnabled: inv.shareEnabled, token: inv.shareToken };
  }

  async rotateShareToken(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, select: { id: true } });
    if (!inv) throw new NotFoundException("Invoice not found");
    const { randomShareToken } = await import("../common/crypto");
    const updated = await this.prisma.invoice.update({ where: { id }, data: { shareToken: randomShareToken(), shareEnabled: true } });
    return { token: updated.shareToken };
  }

  async revokeShareToken(id: string) {
    await this.prisma.invoice.update({ where: { id }, data: { shareToken: null } }).catch(() => null);
    return { ok: true };
  }

  /** Return the existing share token, creating one only when missing (QR-safe). */
  async ensureShareToken(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, select: { id: true, shareToken: true, shareEnabled: true } });
    if (!inv) throw new NotFoundException("Invoice not found");
    if (inv.shareToken && inv.shareEnabled) return { token: inv.shareToken, created: false };
    const { randomShareToken } = await import("../common/crypto");
    const updated = await this.prisma.invoice.update({ where: { id }, data: { shareToken: randomShareToken(), shareEnabled: true } });
    return { token: updated.shareToken, created: true };
  }

  async whatsappLogs(id: string) {
    return this.prisma.whatsappMessageLog.findMany({ where: { relatedInvoiceId: id }, orderBy: { createdAt: "desc" }, take: 20 });
  }

  /** Staff-safe public payload for the no-login share page (same data as the PDF). */
  async publicInvoiceByToken(token: string) {
    const inv: any = await this.prisma.invoice.findFirst({
      where: { shareToken: token, shareEnabled: true },
      include: {
        lineItems: true,
        payments: { orderBy: { paymentDate: "desc" } },
        project: { select: { id: true, name: true } },
        client: { select: { companyName: true } },
      },
    });
    if (!inv || ["VOID", "CANCELLED"].includes(inv.status)) throw new NotFoundException("Invoice link is invalid or revoked");
    const t = invoiceTotals(inv);
    const branding = await this.prisma.brandingConfig.findFirst().catch(() => null);
    const statement = inv.projectId ? await this.projectBalance(inv.id).catch(() => null) : null;
    return {
      invoiceNumber: inv.invoiceNumber,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      invoiceType: inv.invoiceType,
      currency: inv.currency,
      taxApplicable: inv.taxApplicable,
      taxRate: Number(inv.taxRate ?? 0),
      discountRate: Number(inv.discountRate ?? 0),
      shippingFee: Number(inv.shippingFee ?? 0),
      templateStyle: inv.templateStyle,
      terms: inv.terms,
      notes: inv.notes,
      client: { companyName: inv.client.companyName },
      project: inv.project ? { id: inv.project.id, name: inv.project.name } : null,
      lineItems: (inv.lineItems ?? []).map((l: any) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), amount: Number(l.amount) })),
      payments: (inv.payments ?? []).map((p: any) => ({ id: p.id, amount: Number(p.amount), paymentMethod: p.paymentMethod, referenceId: p.referenceId, paymentDate: p.paymentDate })),
      totals: t,
      projectBalance: statement?.project && !(statement as any).reason ? statement : null,
      branding: branding
        ? {
            appName: branding.appName, tagline: branding.tagline, email: branding.email, phone: branding.phone,
            address: branding.address, city: branding.city, country: branding.country, website: branding.website,
            logoDarkUrl: branding.logoDarkUrl, primaryColor: branding.primaryColor,
            authorizedSignerName: branding.authorizedSignerName, authorizedSignerTitle: branding.authorizedSignerTitle,
            signatureImageUrl: branding.signatureImageUrl, defaultPaymentDetails: branding.defaultPaymentDetails,
            defaultTerms: branding.defaultTerms, defaultNotes: branding.defaultNotes,
          }
        : null,
    };
  }

  // ── Expenses ─────────────────────────────────────────────────────────


  async income(query: { q?: string }) {
    const [payments, manual] = await Promise.all([
      this.prisma.payment.findMany({
        where: query.q ? { invoice: { client: { companyName: { contains: query.q, mode: "insensitive" } } } } : undefined,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, invoiceType: true, client: { select: { companyName: true } }, project: { select: { name: true } } } },
          recordedBy: { select: { name: true } },
        },
        orderBy: { paymentDate: "desc" },
      }),
      this.prisma.manualIncome.findMany({
        where: query.q ? { description: { contains: query.q, mode: "insensitive" } } : undefined,
        include: { recordedBy: { select: { name: true } } },
        orderBy: { date: "desc" },
      }),
    ]);
    const fromPayments = payments.map((p) => ({
      id: p.id,
      source: "invoice",
      date: p.paymentDate,
      amount: Number(p.amount),
      currency: p.currency,
      method: p.paymentMethod,
      reference: p.referenceId,
      description: p.invoice?.invoiceNumber ?? "Payment",
      client: p.invoice?.client.companyName ?? null,
      project: p.invoice?.project?.name ?? null,
      category: p.invoice?.invoiceType ?? "PAYMENT",
      recordedBy: p.recordedBy?.name ?? null,
    }));
    const fromManual = manual.map((m) => ({
      id: m.id,
      source: "manual",
      date: m.date,
      amount: Number(m.amount),
      currency: m.currency,
      method: m.paymentMethod,
      reference: null,
      description: m.description,
      client: null,
      project: null,
      category: m.category,
      recordedBy: m.recordedBy?.name ?? null,
    }));
    return [...fromPayments, ...fromManual].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }


  async createIncome(body: any, actorId?: string) {
    const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount());
    const income = await this.prisma.manualIncome.create({
      data: {
        description: body.description,
        amount: body.amount,
        currency: body.currency ?? "BDT",
        exchangeRate: body.exchangeRate ?? 1,
        category: body.category ?? "OTHER_INCOME",
        date: body.date ? new Date(body.date) : new Date(),
        paymentMethod: body.paymentMethod ?? "CASH",
        bankAccountId: bankId ?? null,
        notes: body.notes ?? null,
        recordedById: actorId,
      },
    });
    if (bankId) await this.ledger.creditBankAccount(bankId, Number(body.amount));
    const [acctBank, acctOther] = await Promise.all([this.ledger.accountByCode("1200"), this.ledger.accountByCode("4200")]);
    await this.ledger.postGL(
      "MANUAL_INCOME",
      `Income — ${income.description}`,
      income.date,
      income.id,
      income.notes,
      [
        { accountId: acctBank.id, debit: Number(income.amount), credit: 0 },
        { accountId: acctOther.id, debit: 0, credit: Number(income.amount) },
      ],
      actorId
    );
    await logAudit(this.prisma, "ManualIncome", income.id, "created", { description: income.description, amount: Number(income.amount) }, actorId);
    await invalidateFinance(this.cache);
    return income;
  }


  async creditNotes() {
    return this.prisma.creditNote.findMany({
      include: { client: { select: { id: true, companyName: true } }, invoice: { select: { id: true, invoiceNumber: true } }, createdBy: { select: { name: true } } },
      orderBy: { date: "desc" },
    });
  }


  async createCreditNote(body: any, actorId?: string) {
    const referenceNumber = await this.ledger.nextCreditNoteNumber();
    const type = body.type ?? "CREDIT_NOTE";
    const creditNote = await this.prisma.creditNote.create({
      data: {
        referenceNumber,
        type,
        clientId: body.clientId,
        invoiceId: body.invoiceId ?? null,
        amount: body.amount,
        currency: body.currency ?? "BDT",
        exchangeRate: body.exchangeRate ?? 1,
        reason: body.reason,
        date: body.date ? new Date(body.date) : new Date(),
        status: "ISSUED",
        createdById: actorId,
      },
    });
    const [acctRevenue, acctAR, acctBank, acctBadDebt] = await Promise.all([this.ledger.accountByCode("4000"), this.ledger.accountByCode("1100"), this.ledger.accountByCode("1200"), this.ledger.accountByCode("6500")]);
    if (type === "CREDIT_NOTE") {
      await this.ledger.postGL("CREDIT_NOTE", referenceNumber, creditNote.date, creditNote.id, body.reason, [
        { accountId: acctRevenue.id, debit: Number(body.amount), credit: 0 },
        { accountId: acctAR.id, debit: 0, credit: Number(body.amount) },
      ], actorId);
      if (body.invoiceId) {
        await this.recomputeInvoiceStatus(body.invoiceId);
      } else {
        await this.prisma.creditBalance.create({ data: { clientId: body.clientId, amount: Number(body.amount), currency: body.currency ?? "BDT", source: `Credit note ${referenceNumber}` } });
      }
    } else if (type === "REFUND") {
      const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount());
      const payment = await this.prisma.payment.create({
        data: {
          invoiceId: body.invoiceId ?? null,
          type: "REFUND",
          amount: body.amount,
          paymentMethod: body.paymentMethod ?? "BANK_TRANSFER",
          referenceId: `RFN-${referenceNumber}`,
          paymentDate: creditNote.date,
          notes: body.reason,
          recordedById: actorId,
        },
      });
      if (bankId) {
        await this.ledger.debitBankAccount(bankId, Number(body.amount));
        await this.prisma.payment.update({ where: { id: payment.id }, data: { bankAccountId: bankId, balanceCredited: true } });
      }
      await this.prisma.creditNote.update({ where: { id: creditNote.id }, data: { refundPaymentId: payment.id } });
      await this.ledger.postGL("REFUND", referenceNumber, creditNote.date, creditNote.id, body.reason, [
        { accountId: acctAR.id, debit: Number(body.amount), credit: 0 },
        { accountId: acctBank.id, debit: 0, credit: Number(body.amount) },
      ], actorId);
      if (body.invoiceId) await this.recomputeInvoiceStatus(body.invoiceId);
    } else {
      // WRITE_OFF
      await this.ledger.postGL("WRITE_OFF", referenceNumber, creditNote.date, creditNote.id, body.reason, [
        { accountId: acctBadDebt.id, debit: Number(body.amount), credit: 0 },
        { accountId: acctAR.id, debit: 0, credit: Number(body.amount) },
      ], actorId);
      if (body.invoiceId) await this.recomputeInvoiceStatus(body.invoiceId);
    }
    await logAudit(this.prisma, "CreditNote", creditNote.id, "created", { type, amount: Number(body.amount), referenceNumber }, actorId);
    await invalidateFinance(this.cache);
    return this.prisma.creditNote.findUnique({ where: { id: creditNote.id }, include: { client: { select: { companyName: true } }, invoice: { select: { invoiceNumber: true } } } });
  }

  // ── Financial statements (GL-derived) ────────────────────────────────
}
