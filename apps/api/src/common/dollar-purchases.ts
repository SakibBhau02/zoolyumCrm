/**
 * Dollar Desk → client views.
 *
 * A `DollarSale` is a client buying USD from the agency. The same rows are shown
 * in three places and they must agree:
 *   • Capital → Dollar Desk (internal, full margin detail)
 *   • Accounts → client file  (internal, margin detail is useful)
 *   • Client portal           (client-facing: NO cost rate, profit or margin)
 *
 * These projections keep the numbers identical while letting each caller decide
 * how much of the economics it is allowed to reveal.
 */

export type DollarPurchaseRow = {
  id: string;
  reference: string;
  date: Date;
  usdAmount: number;
  bdtAmount: number;
  rate: number;
  costRate: number;
  costBdt: number;
  profit: number;
  marginPct: number;
  paymentMethod: string;
  notes: string | null;
};

export type DollarSummary = {
  count: number;
  totalUsd: number;
  totalBdt: number;
  totalProfit: number;
  averageRate: number | null;
  lastPurchaseDate: Date | null;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000;

/** Rows must already be ordered newest-first by the caller. */
export function summariseDollarSales(rows: any[]): { summary: DollarSummary; purchases: DollarPurchaseRow[] } {
  const purchases: DollarPurchaseRow[] = rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    date: r.date,
    usdAmount: r2(r.usdAmount),
    bdtAmount: r2(r.bdtAmount),
    rate: r4(r.effectiveRate),
    costRate: r4(r.costRate),
    costBdt: r2(r.costBdt),
    profit: r2(r.profit),
    marginPct: r2(r.marginPct),
    paymentMethod: String(r.paymentMethod ?? ""),
    notes: r.notes ?? null,
  }));
  const totalUsd = r2(purchases.reduce((s, p) => s + p.usdAmount, 0));
  const totalBdt = r2(purchases.reduce((s, p) => s + p.bdtAmount, 0));
  return {
    purchases,
    summary: {
      count: purchases.length,
      totalUsd,
      totalBdt,
      totalProfit: r2(purchases.reduce((s, p) => s + p.profit, 0)),
      averageRate: totalUsd > 0 ? r4(totalBdt / totalUsd) : null,
      lastPurchaseDate: purchases[0]?.date ?? null,
    },
  };
}

/**
 * Client portal projection. Deliberately omits costRate / costBdt / profit /
 * marginPct / notes: the client bought dollars at `rate`, and the agency's
 * spread is not their data.
 */
export function toClientDollarView(input: { summary: DollarSummary; purchases: DollarPurchaseRow[] }) {
  return {
    summary: {
      count: input.summary.count,
      totalUsd: input.summary.totalUsd,
      totalBdt: input.summary.totalBdt,
      averageRate: input.summary.averageRate,
      lastPurchaseDate: input.summary.lastPurchaseDate,
    },
    purchases: input.purchases.map((p) => ({
      id: p.id,
      reference: p.reference,
      date: p.date,
      usdAmount: p.usdAmount,
      bdtAmount: p.bdtAmount,
      rate: p.rate,
      paymentMethod: p.paymentMethod,
    })),
  };
}
