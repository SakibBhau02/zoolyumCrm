import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import { LedgerService, CapitalDb } from "./ledger.service";
import { invalidateFinance, logAudit } from "./finance-kernel";

/**
 * Dollar Desk — selling USD to clients at a spread.
 *
 *   cost      = USD × configured cost rate (e.g. 30 × 130 = 3,900)
 *   received  = BDT the client actually pays (e.g. 4,500)
 *   profit    = received − cost (600)   margin = profit ÷ received
 *
 * Two rules keep this trustworthy:
 *  1. The cost rate is snapshotted on every sale. Changing the rate in Control
 *     never rewrites history or last month's profit.
 *  2. Sales are client-level, not project-level — a client can simply buy dollars.
 *
 * Accounting: bank increases by the BDT received, the USD pool (1250) is reduced
 * at cost, and the difference lands in FX gain (4400) or FX loss (6600). That
 * keeps the balance sheet and P&L consistent without inflating service revenue.
 */
@Injectable()
export class DollarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly ledger: LedgerService
  ) {}

  // ── Rate (set from Control → Finance) ────────────────────────────────

  async getRate() {
    const settings = await this.prisma.settings
      .findUnique({ where: { id: "default" }, select: { financeConfig: true } })
      .catch(() => null);
    const cfg: any = settings?.financeConfig ?? {};
    const raw = Number(cfg.dollarCostRate);
    const costRate = Number.isFinite(raw) && raw > 0 ? raw : 130;
    return {
      costRate,
      configured: Number.isFinite(raw) && raw > 0,
      updatedAt: (settings as any)?.updatedAt ?? null,
      currency: "USD",
      quoteCurrency: "BDT",
    };
  }

  // ── Sales ────────────────────────────────────────────────────────────

  async list(query: { clientId?: string; from?: string; to?: string; q?: string } = {}) {
    const rate = await this.getRate();
    const rows = await this.prisma.dollarSale.findMany({
      where: {
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.from || query.to
          ? {
              date: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: { client: { select: { id: true, companyName: true, healthLevel: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    let mapped = rows.map((r) => this.map(r));
    if (query.q) {
      const q = query.q.toLowerCase();
      mapped = mapped.filter(
        (r) =>
          r.reference.toLowerCase().includes(q) ||
          (r.client?.companyName ?? "").toLowerCase().includes(q) ||
          (r.notes ?? "").toLowerCase().includes(q)
      );
    }

    return {
      rate,
      rows: mapped,
      summary: this.summarise(mapped, rate.costRate),
      byClient: this.byClient(mapped),
      monthly: this.monthly(mapped),
      generatedAt: new Date().toISOString(),
    };
  }

  async summary() {
    const rows = await this.prisma.dollarSale.findMany({
      select: { usdAmount: true, bdtAmount: true, costBdt: true, profit: true, marginPct: true, date: true, clientId: true },
    });
    const rate = await this.getRate();
    return {
      ...this.summarise(rows.map((r) => this.map(r)), rate.costRate),
      monthly: this.monthly(rows.map((r) => this.map(r))),
    };
  }

  async create(body: any, actorId?: string) {
    const usd = Number(body.usdAmount);
    const bdt = Number(body.bdtAmount);
    if (!Number.isFinite(usd) || usd <= 0) throw new BadRequestException("USD amount must be greater than zero");
    if (!Number.isFinite(bdt) || bdt <= 0) throw new BadRequestException("BDT received must be greater than zero");
    if (!body.clientId) throw new BadRequestException("Choose the client buying the dollars");

    const client = await this.prisma.client
      .findUnique({ where: { id: body.clientId }, select: { id: true, companyName: true } })
      .catch(() => null);
    if (!client) throw new BadRequestException("Client not found");

    const rate = await this.getRate();
    const costRate = rate.costRate;
    const costBdt = this.r2(usd * costRate);
    const profit = this.r2(bdt - costBdt);
    const effectiveRate = this.r4(bdt / usd);
    const marginPct = this.r2((profit / bdt) * 100);
    const date = body.date ? new Date(body.date) : new Date();
    const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount());

    const sale = await this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx);
      const created = await tx.dollarSale.create({
        data: {
          reference,
          clientId: body.clientId,
          usdAmount: usd,
          bdtAmount: bdt,
          costRate,
          effectiveRate,
          costBdt,
          profit,
          marginPct,
          date,
          paymentMethod: (body.paymentMethod ?? "BANK_TRANSFER") as any,
          bankAccountId: bankId ?? null,
          notes: body.notes ?? null,
          recordedById: actorId ?? null,
        },
        include: { client: { select: { id: true, companyName: true, healthLevel: true } } },
      });

      const acctBank = await this.ledger.accountByCode("1200", tx);
      const acctUsd = await this.ledger.ensureAccount("1250", "USD / FX Inventory", "ASSET", tx);
      const acctGain = await this.ledger.ensureAccount("4400", "FX Gain on Dollar Sales", "REVENUE", tx);
      const acctLoss = await this.ledger.ensureAccount("6600", "FX Loss on Dollar Sales", "OPEX", tx);
      const lines: { accountId: string; debit: number; credit: number; memo?: string }[] = [
        { accountId: acctBank.id, debit: bdt, credit: 0, memo: `${usd} USD sold @ ${effectiveRate}` },
        { accountId: acctUsd.id, debit: 0, credit: costBdt, memo: `${usd} USD @ cost ${costRate}` },
      ];
      if (profit >= 0) {
        lines.push({ accountId: acctGain.id, debit: 0, credit: profit, memo: created.reference });
      } else {
        lines.push({ accountId: acctLoss.id, debit: Math.abs(profit), credit: 0, memo: created.reference });
      }

      await this.ledger.postGL(
        "DOLLAR_SALE",
        created.reference,
        date,
        created.id,
        `${usd} USD sold to ${client.companyName}`,
        lines,
        actorId,
        tx
      );

      if (bankId) await this.ledger.creditBankAccount(bankId, bdt, tx);
      await logAudit(tx, "DollarSale", created.id, "created", { usd, bdt, costRate, profit }, actorId);
      return created;
    }, { timeout: 15000 });

    await this.invalidate();
    return this.map(sale);
  }

  async remove(id: string, actorId?: string) {
    const sale = await this.prisma.dollarSale.findUnique({ where: { id } });
    if (!sale) throw new NotFoundException("Dollar sale not found");

    await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseGL(id, actorId, tx);
      if (sale.bankAccountId) await this.ledger.debitBankAccount(sale.bankAccountId, Number(sale.bdtAmount), tx);
      await tx.dollarSale.delete({ where: { id } });
      await logAudit(tx, "DollarSale", id, "deleted", { reference: sale.reference, bdt: Number(sale.bdtAmount) }, actorId);
    }, { timeout: 15000 });

    await this.invalidate();
    return { ok: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private map(r: any) {
    return {
      ...r,
      usdAmount: Number(r.usdAmount),
      bdtAmount: Number(r.bdtAmount),
      costRate: Number(r.costRate),
      effectiveRate: Number(r.effectiveRate),
      costBdt: Number(r.costBdt),
      profit: Number(r.profit),
      marginPct: Number(r.marginPct),
    };
  }

  private summarise(rows: any[], costRate: number) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const month = rows.filter((r) => new Date(r.date) >= monthStart);
    const sum = (list: any[], key: string) => list.reduce((s, r) => s + Number((r as any)[key] ?? 0), 0);
    const pack = (list: any[]) => {
      const usd = sum(list, "usdAmount");
      const bdt = sum(list, "bdtAmount");
      const cost = sum(list, "costBdt");
      const profit = sum(list, "profit");
      return {
        usd: this.r2(usd),
        bdt: this.r2(bdt),
        cost: this.r2(cost),
        profit: this.r2(profit),
        marginPct: bdt ? this.r2((profit / bdt) * 100) : 0,
        avgSellRate: usd ? this.r4(bdt / usd) : null,
        count: list.length,
      };
    };
    const losses = rows.filter((r) => Number(r.profit) < 0);

    return {
      costRate,
      month: pack(month),
      allTime: pack(rows),
      lossCount: losses.length,
      lossAmount: this.r2(losses.reduce((s, r) => s + Math.abs(Number(r.profit)), 0)),
      clientCount: new Set(rows.map((r) => r.clientId)).size,
    };
  }

  private byClient(rows: any[]) {
    const map = new Map<string, { id: string; name: string; usd: number; bdt: number; profit: number; count: number }>();
    for (const r of rows) {
      const id = r.clientId;
      const cur = map.get(id) ?? {
        id,
        name: r.client?.companyName ?? "Unknown client",
        usd: 0,
        bdt: 0,
        profit: 0,
        count: 0,
      };
      cur.usd += Number(r.usdAmount);
      cur.bdt += Number(r.bdtAmount);
      cur.profit += Number(r.profit);
      cur.count += 1;
      map.set(id, cur);
    }
    return Array.from(map.values())
      .map((c) => ({ ...c, usd: this.r2(c.usd), bdt: this.r2(c.bdt), profit: this.r2(c.profit) }))
      .sort((a, b) => b.profit - a.profit);
  }

  private monthly(rows: any[]) {
    const out: { label: string; usd: number; bdt: number; profit: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const list = rows.filter((r) => {
        const t = new Date(r.date).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      out.push({
        label: d.toLocaleDateString("en-US", { month: "short" }),
        usd: this.r2(list.reduce((s, r) => s + Number(r.usdAmount), 0)),
        bdt: this.r2(list.reduce((s, r) => s + Number(r.bdtAmount), 0)),
        profit: this.r2(list.reduce((s, r) => s + Number(r.profit), 0)),
      });
    }
    return out;
  }

  private async nextReference(db: CapitalDb) {
    const year = new Date().getFullYear();
    const rows = await db.dollarSale.findMany({
      where: { reference: { startsWith: `FXS-${year}-` } },
      select: { reference: true },
    });
    const max = rows.reduce((m, r) => {
      const seq = parseInt(r.reference.split("-").pop() ?? "0", 10);
      return Number.isFinite(seq) ? Math.max(m, seq) : m;
    }, 0);
    return `FXS-${year}-${String(max + 1).padStart(4, "0")}`;
  }

  private async invalidate() {
    await invalidateFinance(this.cache);
    await this.cache.del("dashboard:overview");
  }

  private r2(n: number) {
    return Math.round(n * 100) / 100;
  }

  private r4(n: number) {
    return Math.round(n * 10000) / 10000;
  }
}
