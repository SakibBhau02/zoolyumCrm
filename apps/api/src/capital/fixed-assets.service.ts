import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "./ledger.service";
import { logAudit } from "./finance-kernel";

const COST_ACCOUNT = { code: "1500", name: "Fixed Assets — Cost", category: "ASSET" };
const ACCUM_ACCOUNT = { code: "1510", name: "Accumulated Depreciation", category: "ASSET" };
const EXPENSE_ACCOUNT = { code: "6700", name: "Depreciation Expense", category: "OPEX" };
const GAIN_ACCOUNT = { code: "4450", name: "Gain on Asset Disposal", category: "REVENUE" };
const LOSS_ACCOUNT = { code: "6650", name: "Loss on Asset Disposal", category: "OPEX" };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Fixed-asset register + monthly depreciation.
 *
 * Purchase posts Dr Fixed Assets / Cr Bank (investing cash flow). Each period's
 * depreciation posts Dr Depreciation Expense / Cr Accumulated Depreciation and
 * is idempotent per (asset, period) — running it twice never double-books.
 */
@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService
  ) {}

  private monthlyDepreciation(asset: any) {
    const cost = Number(asset.cost);
    const salvage = Number(asset.salvageValue ?? 0);
    const life = Math.max(1, Number(asset.usefulLifeMonths));
    const depreciable = Math.max(cost - salvage, 0);
    if (asset.method === "DECLINING_BALANCE") {
      // Double-declining: monthly rate = 2 / life(in months) applied to the
      // remaining book value, so early periods carry more depreciation.
      const book = Math.max(cost - Number(asset.accumulatedDepreciation ?? 0) - salvage, 0);
      return r2(Math.min((book * 2) / life, book));
    }
    return r2(depreciable / life);
  }

  private view(asset: any) {
    const cost = Number(asset.cost);
    const accum = Number(asset.accumulatedDepreciation ?? 0);
    const monthly = this.monthlyDepreciation(asset);
    return {
      ...asset,
      cost,
      accumulatedDepreciation: r2(accum),
      bookValue: r2(Math.max(cost - accum, 0)),
      monthlyDepreciation: monthly,
      periodsRemaining: monthly > 0 ? Math.max(0, Math.ceil((cost - Number(asset.salvageValue ?? 0) - accum) / monthly)) : 0,
    };
  }

  async list() {
    const assets = await this.prisma.fixedAsset.findMany({
      include: { runs: { orderBy: { period: "desc" }, take: 3 } },
      orderBy: { purchaseDate: "desc" },
    });
    const rows = assets.map((a) => this.view(a));
    return {
      assets: rows,
      totals: {
        cost: r2(rows.reduce((s, a) => s + a.cost, 0)),
        accumulated: r2(rows.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + a.accumulatedDepreciation, 0)),
        bookValue: r2(rows.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + a.bookValue, 0)),
        monthlyDepreciation: r2(rows.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + a.monthlyDepreciation, 0)),
      },
    };
  }

  async create(body: any, actorId?: string) {
    const cost = r2(Number(body.cost));
    const salvage = r2(Number(body.salvageValue ?? 0));
    const life = Number(body.usefulLifeMonths);
    if (!body.name?.trim()) throw new BadRequestException("Asset name is required");
    if (!Number.isFinite(cost) || cost <= 0) throw new BadRequestException("Cost must be greater than zero");
    if (!Number.isFinite(salvage) || salvage < 0 || salvage >= cost) throw new BadRequestException("Salvage value must be between 0 and the cost");
    if (!Number.isInteger(life) || life < 1 || life > 600) throw new BadRequestException("usefulLifeMonths must be between 1 and 600");
    const purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date();
    if (Number.isNaN(purchaseDate.getTime())) throw new BadRequestException("Invalid purchase date");
    const method = String(body.method ?? "STRAIGHT_LINE").toUpperCase();
    if (!["STRAIGHT_LINE", "DECLINING_BALANCE"].includes(method)) {
      throw new BadRequestException("method must be STRAIGHT_LINE or DECLINING_BALANCE");
    }

    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.fixedAsset.create({
        data: {
          name: body.name.trim(),
          category: body.category ?? "EQUIPMENT",
          purchaseDate,
          cost,
          salvageValue: salvage,
          usefulLifeMonths: life,
          method,
          serialNumber: body.serialNumber ?? null,
          notes: body.notes ?? null,
          createdById: actorId ?? null,
        },
      });
      // Capitalise the purchase unless the caller says it is already in the books.
      if (body.postPurchase !== false) {
        const [acctCost, acctBank] = await Promise.all([
          this.ledger.ensureAccount(COST_ACCOUNT.code, COST_ACCOUNT.name, COST_ACCOUNT.category, tx),
          this.ledger.accountByCode("1200", tx),
        ]);
        const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount(tx));
        await this.ledger.postGL(
          "ASSET_PURCHASE",
          `Asset ${created.name}`,
          purchaseDate,
          created.id,
          "Fixed asset purchase",
          [
            { accountId: acctCost.id, debit: cost, credit: 0, memo: created.name },
            { accountId: acctBank.id, debit: 0, credit: cost, memo: created.name },
          ],
          actorId,
          tx
        );
        if (bankId) await this.ledger.debitBankAccount(bankId, cost, tx);
      }
      await logAudit(tx, "FixedAsset", created.id, "created", { name: created.name, cost }, actorId);
      return created;
    }, { timeout: 15000 });
    return this.view(asset);
  }

  async update(id: string, body: any, actorId?: string) {
    const existing = await this.getRaw(id);
    if (existing.status === "DISPOSED") throw new BadRequestException("A disposed asset cannot be edited.");
    const data: any = {};
    for (const key of ["name", "category", "serialNumber", "notes"]) {
      if (body[key] !== undefined) data[key] = body[key] || null;
    }
    if (body.salvageValue !== undefined) {
      const salvage = r2(Number(body.salvageValue));
      if (salvage < 0 || salvage >= Number(existing.cost)) throw new BadRequestException("Salvage value must be below the cost");
      data.salvageValue = salvage;
    }
    if (body.usefulLifeMonths !== undefined) {
      const life = Number(body.usefulLifeMonths);
      if (!Number.isInteger(life) || life < 1) throw new BadRequestException("usefulLifeMonths must be a positive integer");
      data.usefulLifeMonths = life;
    }
    const updated = await this.prisma.fixedAsset.update({ where: { id }, data });
    return this.view(updated);
  }

  private async getRaw(id: string) {
    const asset = await this.prisma.fixedAsset.findUnique({ where: { id }, include: { runs: true } });
    if (!asset) throw new NotFoundException("Asset not found");
    return asset;
  }

  async get(id: string) {
    const asset = await this.getRaw(id);
    return { ...this.view(asset), runs: asset.runs };
  }

  /**
   * Post one period of depreciation for every active asset.
   * `period` is YYYY-MM. Safe to re-run: an asset already depreciated for the
   * period is skipped.
   */
  async runDepreciation(period: string, actorId?: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) {
      throw new BadRequestException("period must be YYYY-MM");
    }
    const [year, month] = period.split("-").map(Number);
    const periodEnd = new Date(Date.UTC(year, month, 0)); // last day of the month
    const assets = await this.prisma.fixedAsset.findMany({ where: { status: "ACTIVE" }, include: { runs: true } });
    const [acctExpense, acctAccum] = await Promise.all([
      this.ledger.ensureAccount(EXPENSE_ACCOUNT.code, EXPENSE_ACCOUNT.name, EXPENSE_ACCOUNT.category),
      this.ledger.ensureAccount(ACCUM_ACCOUNT.code, ACCUM_ACCOUNT.name, ACCUM_ACCOUNT.category),
    ]);

    const posted: { assetId: string; name: string; amount: number }[] = [];
    const skipped: { assetId: string; reason: string }[] = [];

    for (const asset of assets) {
      if (asset.purchaseDate > periodEnd) {
        skipped.push({ assetId: asset.id, reason: "not yet purchased" });
        continue;
      }
      if (asset.runs.some((r) => r.period === period)) {
        skipped.push({ assetId: asset.id, reason: "already depreciated this period" });
        continue;
      }
      const depreciable = r2(Number(asset.cost) - Number(asset.salvageValue ?? 0));
      const remaining = r2(depreciable - Number(asset.accumulatedDepreciation ?? 0));
      if (remaining <= 0.01) {
        skipped.push({ assetId: asset.id, reason: "fully depreciated" });
        continue;
      }
      const amount = Math.min(this.monthlyDepreciation(asset), remaining);
      await this.prisma.$transaction(async (tx) => {
        // Create the run first so the journal can point at its id — every
        // document-owned journal must have a real source row, or the orphan
        // sweep would reverse it.
        const run = await tx.depreciationRun.create({
          data: { assetId: asset.id, period, amount, createdById: actorId ?? null },
        });
        const entry = await this.ledger.postGL(
          "DEPRECIATION",
          `Depreciation ${asset.name} ${period}`,
          periodEnd,
          run.id,
          `Monthly depreciation — ${period}`,
          [
            { accountId: acctExpense.id, debit: amount, credit: 0, memo: asset.name },
            { accountId: acctAccum.id, debit: 0, credit: amount, memo: asset.name },
          ],
          actorId,
          tx
        );
        if (entry) {
          await tx.depreciationRun.update({ where: { id: run.id }, data: { journalId: entry.id } });
        }
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { accumulatedDepreciation: { increment: amount } },
        });
        await logAudit(tx, "DepreciationRun", run.id, "posted", { asset: asset.name, period, amount }, actorId);
      }, { timeout: 15000 });
      posted.push({ assetId: asset.id, name: asset.name, amount });
    }
    return {
      period,
      posted,
      skipped,
      total: r2(posted.reduce((s, p) => s + p.amount, 0)),
    };
  }

  /** Sell/scrap an asset: clear cost + accumulated and book the gain or loss. */
  async dispose(id: string, body: any, actorId?: string) {
    const asset = await this.getRaw(id);
    if (asset.status === "DISPOSED") throw new ConflictException("This asset is already disposed");
    const proceeds = r2(Number(body.proceeds ?? 0));
    if (!Number.isFinite(proceeds) || proceeds < 0) throw new BadRequestException("Proceeds cannot be negative");
    const disposedAt = body.disposedAt ? new Date(body.disposedAt) : new Date();
    if (Number.isNaN(disposedAt.getTime())) throw new BadRequestException("Invalid disposal date");

    const cost = r2(Number(asset.cost));
    const accum = r2(Number(asset.accumulatedDepreciation ?? 0));
    const nbv = r2(cost - accum);
    const gain = r2(proceeds - nbv);

    await this.prisma.$transaction(async (tx) => {
      const [acctCost, acctAccum, acctBank, acctGain, acctLoss] = await Promise.all([
        this.ledger.ensureAccount(COST_ACCOUNT.code, COST_ACCOUNT.name, COST_ACCOUNT.category, tx),
        this.ledger.ensureAccount(ACCUM_ACCOUNT.code, ACCUM_ACCOUNT.name, ACCUM_ACCOUNT.category, tx),
        this.ledger.accountByCode("1200", tx),
        this.ledger.ensureAccount(GAIN_ACCOUNT.code, GAIN_ACCOUNT.name, GAIN_ACCOUNT.category, tx),
        this.ledger.ensureAccount(LOSS_ACCOUNT.code, LOSS_ACCOUNT.name, LOSS_ACCOUNT.category, tx),
      ]);
      const lines: { accountId: string; debit: number; credit: number; memo?: string }[] = [
        { accountId: acctAccum.id, debit: accum, credit: 0, memo: "Clear accumulated depreciation" },
        { accountId: acctCost.id, debit: 0, credit: cost, memo: "Derecognise cost" },
      ];
      if (proceeds > 0) lines.push({ accountId: acctBank.id, debit: proceeds, credit: 0, memo: "Disposal proceeds" });
      if (gain > 0) lines.push({ accountId: acctGain.id, debit: 0, credit: gain, memo: "Gain on disposal" });
      if (gain < 0) lines.push({ accountId: acctLoss.id, debit: Math.abs(gain), credit: 0, memo: "Loss on disposal" });

      await this.ledger.postGL(
        "ASSET_DISPOSAL",
        `Disposal ${asset.name}`,
        disposedAt,
        asset.id,
        `Asset disposed — NBV ৳${nbv}`,
        lines,
        actorId,
        tx
      );
      if (proceeds > 0) {
        const bankId = body.bankAccountId ?? (await this.ledger.defaultBankAccount(tx));
        if (bankId) await this.ledger.creditBankAccount(bankId, proceeds, tx);
      }
      await tx.fixedAsset.update({
        where: { id },
        data: { status: "DISPOSED", disposedAt, disposalProceeds: proceeds },
      });
      await logAudit(tx, "FixedAsset", id, "disposed", { proceeds, nbv, gain }, actorId);
    }, { timeout: 15000 });

    return { ok: true, nbv, proceeds, gain, loss: gain < 0 ? Math.abs(gain) : 0 };
  }
}
