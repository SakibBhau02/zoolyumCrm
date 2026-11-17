import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { invoiceTotals, toBdt } from "./finance-kernel";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * VAT compliance data: the sales register (Mushak 6.3), the purchase register
 * and the periodic return (Mushak 9.1).
 *
 * Output VAT comes from issued invoices; input VAT comes from expenses flagged
 * recoverable. Both are reconciled against the GL control accounts (2100 output,
 * 1300 input) so a filing can never drift from the books.
 */
@Injectable()
export class VatService {
  constructor(private readonly prisma: PrismaService) {}

  private range(fromStr?: string, toStr?: string) {
    const parse = (v: string, end: boolean) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${v}`);
      return end
        ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
        : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    };
    const now = new Date();
    const to = toStr ? parse(toStr, true) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const from = fromStr ? parse(fromStr, false) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    if (from > to) throw new BadRequestException("`from` must be before `to`");
    return { from, to };
  }

  /** Mushak 6.3 — sales register for the period. */
  async salesRegister(fromStr?: string, toStr?: string) {
    const { from, to } = this.range(fromStr, toStr);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        issueDate: { gte: from, lte: to },
        status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"] },
      },
      include: { lineItems: true, client: { select: { id: true, companyName: true } } },
      orderBy: { issueDate: "asc" },
    });
    const rows = invoices.map((inv) => {
      const t = invoiceTotals(inv);
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate,
        clientId: inv.clientId,
        clientName: inv.client.companyName,
        taxableValue: r2(t.subtotal - t.discount + t.shipping),
        vatRate: Number(inv.taxRate ?? 0),
        vatAmount: r2(t.tax),
        total: r2(t.grand),
        currency: inv.currency,
        brl: null,
      };
    });
    const totals = {
      count: rows.length,
      taxableValue: r2(rows.reduce((s, r) => s + r.taxableValue, 0)),
      vatAmount: r2(rows.reduce((s, r) => s + r.vatAmount, 0)),
      total: r2(rows.reduce((s, r) => s + r.total, 0)),
    };
    return { from, to, rows, totals };
  }

  /** Purchase register — VAT paid to vendors that can be credited. */
  async purchaseRegister(fromStr?: string, toStr?: string) {
    const { from, to } = this.range(fromStr, toStr);
    const expenses = await this.prisma.expense.findMany({
      where: { date: { gte: from, lte: to }, approvalStatus: "APPROVED", vatRecoverable: true },
      include: { vendor: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
      orderBy: { date: "asc" },
    });
    const rows = expenses.map((e) => {
      const rate = Number(e.vatRate ?? 0);
      // Stored VAT is authoritative; fall back to extracting it from a VAT-inclusive total.
      const vat = Number(e.inputVatAmount ?? 0) > 0
        ? Number(e.inputVatAmount)
        : rate > 0
          ? (Number(e.amount) * rate) / (100 + rate)
          : 0;
      return {
        id: e.id,
        date: e.date,
        description: e.description,
        vendorName: e.vendor?.name ?? null,
        billNumber: e.vendorBillNumber ?? null,
        total: r2(Number(e.amount)),
        vatRate: rate,
        vatAmount: r2(vat),
        taxableValue: r2(Number(e.amount) - vat),
      };
    });
    return {
      from,
      to,
      rows,
      totals: {
        count: rows.length,
        taxableValue: r2(rows.reduce((s, r) => s + r.taxableValue, 0)),
        vatAmount: r2(rows.reduce((s, r) => s + r.vatAmount, 0)),
        total: r2(rows.reduce((s, r) => s + r.total, 0)),
      },
    };
  }

  /** Mushak 9.1 — output VAT − input VAT = payable for the period. */
  async returnSummary(fromStr?: string, toStr?: string) {
    const [{ from, to }, sales, purchases, gl] = await Promise.all([
      Promise.resolve(this.range(fromStr, toStr)),
      this.salesRegister(fromStr, toStr),
      this.purchaseRegister(fromStr, toStr),
      Promise.all([
        this.prisma.journalEntryLine.aggregate({ where: { account: { code: "2100" } }, _sum: { debit: true, credit: true } }),
        this.prisma.journalEntryLine.aggregate({ where: { account: { code: "1300" } }, _sum: { debit: true, credit: true } }),
      ]),
    ]);
    const outputVat = sales.totals.vatAmount;
    const inputVat = purchases.totals.vatAmount;
    const netPayable = r2(outputVat - inputVat);
    return {
      from,
      to,
      period: `${from.toISOString().slice(0, 7)}`,
      outputVat,
      inputVat,
      netPayable,
      // Control-account balances (lifetime) so a filing can be tied back to the GL.
      gl: {
        outputVatPayable: r2(Number(gl[0]._sum.credit ?? 0) - Number(gl[0]._sum.debit ?? 0)),
        inputVatReceivable: r2(Number(gl[1]._sum.debit ?? 0) - Number(gl[1]._sum.credit ?? 0)),
      },
      salesCount: sales.totals.count,
      purchaseCount: purchases.totals.count,
    };
  }

  /** Withholding (TDS/VDS) deposited vs accrued, per payee. */
  async withholdingRegister(fromStr?: string, toStr?: string) {
    const { from, to } = this.range(fromStr, toStr);
    const [payments, vendorPayments, incomes] = await Promise.all([
      this.prisma.payment.findMany({
        where: { paymentDate: { gte: from, lte: to }, taxWithheld: { gt: 0 } },
        include: { invoice: { select: { invoiceNumber: true, client: { select: { companyName: true } } } } },
      }),
      this.prisma.vendorPayment.findMany({
        where: { paymentDate: { gte: from, lte: to }, taxWithheld: { gt: 0 } },
        include: { engagement: { select: { reference: true, vendor: { select: { name: true } } } } },
      }),
      this.prisma.manualIncome.findMany({ where: { date: { gte: from, lte: to }, taxWithheld: { gt: 0 } } }),
    ]);
    const rows = [
      ...payments.map((p) => ({
        date: p.paymentDate,
        kind: "CLIENT" as const,
        party: p.invoice?.client?.companyName ?? "—",
        reference: p.invoice?.invoiceNumber ?? p.referenceId ?? "",
        gross: r2(Number(p.amount)),
        withheld: r2(Number(p.taxWithheld ?? 0)),
      })),
      ...vendorPayments.map((p) => ({
        date: p.paymentDate,
        kind: "VENDOR" as const,
        party: p.engagement?.vendor?.name ?? "—",
        reference: p.engagement?.reference ?? p.referenceId ?? "",
        gross: r2(Number(p.amount)),
        withheld: r2(Number(p.taxWithheld ?? 0)),
      })),
      ...incomes.map((i) => ({
        date: i.date,
        kind: "INCOME" as const,
        party: "—",
        reference: i.description,
        gross: r2(Number(i.amount)),
        withheld: r2(Number(i.taxWithheld ?? 0)),
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const gl = await this.prisma.journalEntryLine.aggregate({
      where: { account: { code: "2200" } },
      _sum: { debit: true, credit: true },
    });
    return {
      from,
      to,
      rows,
      totalWithheld: r2(rows.reduce((s, r) => s + r.withheld, 0)),
      glPayable: r2(Number(gl._sum.credit ?? 0) - Number(gl._sum.debit ?? 0)),
    };
  }
}
