import type { Prisma } from "@prisma/client";
import type { CacheService } from "../cache/cache.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { PrismaService } from "../prisma/prisma.service";

export const ACTIVE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];
export const POSTABLE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];
/** Statuses that carry a receivable (drafts and voids are not client debt yet). */
export const RECEIVABLE_STATUSES = [...ACTIVE_STATUSES];
/** Statuses that can still be collected. */
export const OPEN_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"];

/**
 * A `Payment` row is shared by two very different flows:
 *   - money received from a client (invoiceId set, type IN/REFUND)
 *   - money paid to a vendor/expense (expenseId set, type OUT)
 *
 * Any figure that means "income", "collected", "cash in" or "by method" must
 * scope to these types. Before `OUT` existed the expense payout defaulted to
 * IN, so the finance reports overstated revenue by the whole payables volume.
 */
export const RECEIPT_PAYMENT_TYPES = ["IN", "REFUND"] as const;
export const RECEIPT_PAYMENT_FILTER = { type: { in: [...RECEIPT_PAYMENT_TYPES] } };

/** True when a payment row is cash received rather than cash paid out. */
export function isReceiptPayment(p: { type?: string | null; expenseId?: string | null }) {
  if (p.expenseId) return false;
  return !p.type || p.type === "IN" || p.type === "REFUND";
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Start of "today" as a UTC midnight for the *local* calendar date.
 *
 * Invoice `issueDate` / `dueDate` are Prisma `@db.Date` columns: they are read
 * and compared in UTC. Building `today` with `new Date()` + `setHours(0,0,0,0)`
 * produces local midnight, which in Bangladesh (UTC+6) serialises to the
 * PREVIOUS UTC day — so an invoice due "yesterday" was never swept to OVERDUE
 * until a day later, and the badge disagreed with the OVERDUE filters.
 */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** A DATE column value (UTC midnight) reduced to a stable UTC day number. */
export function utcDayNumber(d: Date | string): number {
  const x = new Date(d);
  return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / 86400000);
}

/**
 * Canonical invoice money math (mirrors Finance_System formulas):
 *   subtotal  = Σ line amounts
 *   tax       = subtotal * taxRate / 100   (only when taxApplicable)
 *   discount  = subtotal * discountRate / 100
 *   grand     = subtotal + tax - discount + shipping
 *   paid      = Σ payments IN − Σ payments REFUND   (net cash actually retained)
 *   credits   = Σ issued credit notes / write-offs applied to the invoice
 *   balance   = grand − paid − credits
 * Revenue recognition stays line-based (pre-tax, as before); `grand` is the
 * client-facing receivable used for status / aging / balances.
 *
 * `grand`/`paid`/`balance` are in the invoice currency. The `*Bdt` fields apply
 * `exchangeRate` so foreign invoices are booked and reported in BDT instead of
 * silently treating USD 100 as ৳100.
 */
export function invoiceTotals(inv: any) {
  const subtotal = (inv.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
  const tax = inv.taxApplicable && inv.taxRate ? (subtotal * Number(inv.taxRate)) / 100 : 0;
  const discount = inv.discountRate ? (subtotal * Number(inv.discountRate)) / 100 : 0;
  const shipping = Number(inv.shippingFee ?? 0);
  const grand = Math.max(0, subtotal + tax - discount + shipping);
  const payments = inv.payments ?? [];
  const paidIn = payments.filter((p: any) => !p.type || p.type === "IN").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  // A refund gives money back, so it must reduce collected — the old formula
  // added it, which made refunded invoices look MORE paid than before.
  const refunded = payments.filter((p: any) => p.type === "REFUND").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const paid = paidIn - refunded;
  // Credit notes and write-offs reduce what the client still owes. Queries that
  // want this reflected must `include: { creditNotes: … }`; callers without the
  // relation simply get 0 and keep their previous behaviour.
  const credits = (inv.creditNotes ?? [])
    .filter((c: any) => c && (!c.status || c.status === "ISSUED") && (c.type === "CREDIT_NOTE" || c.type === "WRITE_OFF"))
    .reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0);
  const settled = paid + credits;
  const rate = Number(inv.exchangeRate ?? 1) || 1;
  return {
    subtotal: r2(subtotal),
    tax: r2(tax),
    discount: r2(discount),
    shipping: r2(shipping),
    grand: r2(grand),
    paid: r2(paid),
    paidIn: r2(paidIn),
    refunded: r2(refunded),
    credits: r2(credits),
    balance: r2(Math.max(grand - settled, 0)),
    exchangeRate: rate,
    subtotalBdt: r2(subtotal * rate),
    taxBdt: r2(tax * rate),
    discountBdt: r2(discount * rate),
    shippingBdt: r2(shipping * rate),
    grandBdt: r2(grand * rate),
    paidBdt: r2(paid * rate),
    creditsBdt: r2(credits * rate),
    balanceBdt: r2(Math.max(grand - settled, 0) * rate),
  };
}

/** Convert an amount in the document's currency to BDT using its exchange rate. */
export function toBdt(amount: number, doc: any): number {
  const rate = Number(doc?.exchangeRate ?? 1) || 1;
  return r2(Number(amount) * rate);
}

/** A draft/void invoice is not yet a receivable. */
export function isReceivable(status: string) {
  return RECEIVABLE_STATUSES.includes(status);
}

/** Balance still owed, or 0 when the invoice is settled / not a receivable. */
export function outstandingOf(inv: any) {
  const t = invoiceTotals(inv);
  return isReceivable(inv.status) ? t.balance : 0;
}

/** Past its due date with money still owed. */
export function isOverdue(inv: any, now: Date = new Date()) {
  const t = invoiceTotals(inv);
  if (!isReceivable(inv.status) || t.balance <= 0) return false;
  if (!inv.dueDate) return false;
  return utcDayNumber(inv.dueDate) < utcDayNumber(startOfTodayUtc(now));
}

export function daysOverdue(inv: any, now: Date = new Date()) {
  if (!inv.dueDate) return 0;
  return Math.max(0, utcDayNumber(startOfTodayUtc(now)) - utcDayNumber(inv.dueDate));
}

/** Include-clause fragments so invoice math always sees credits and FX rate. */
export const INVOICE_CREDIT_INCLUDE = { creditNotes: { select: { type: true, amount: true, status: true } } } as const;

/** Clear every finance-derived cache (reports and client accounts read through these). */
export async function invalidateFinance(cache: CacheService) {
  await cache.del("capital:overview");
  await cache.del("capital:income-stats");
  await cache.del("capital:reports");
  await cache.del("capital:profitability");
  await cache.del("capital:activity");
  await cache.del("capital:aging");
  await cache.del("capital:aging-ap");
  await cache.del("capital:forecast");
  await cache.delPattern("capital:project-finance:*");
  await cache.del("capital:statements:pl");
  await cache.del("capital:statements:bs");
  await cache.del("capital:statements:tb");
  await cache.del("capital:statements:cf");
  // Accounts reads the same invoices: without these the client board shows
  // stale money for up to 30s after every invoice/payment/expense change.
  await cache.del("accounts:overview");
  await cache.delPattern("accounts:list:*");
  await cache.del("insight:overview");
  await cache.del("insight:tax");
  await cache.del("insight:performance");
  await cache.del("insight:client-health");
  await cache.del("dashboard:overview");
}

export async function logAudit(
  prisma: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
  action: string,
  changes: any,
  actorId?: string
) {
  await prisma.financeAuditLog.create({
    data: { entityType, entityId, action, performedById: actorId, afterValue: changes },
  });
}

export function notifyRole(
  notifications: NotificationsService,
  role: string,
  type: string,
  title: string,
  message: string,
  link?: string | null,
  actorId?: string
) {
  return notifications.notifyRole(role, type, title, message, link ?? undefined, actorId);
}

export function buildTrend(snapshots: { metricName: string; value: number; recordedAt: Date }[]) {
  const months = new Map<string, { month: string; invoiced: number; collected: number; expenses: number }>();
  for (const s of snapshots) {
    const key = `${s.recordedAt.getMonth()}/${s.recordedAt.getFullYear()}`;
    const entry = months.get(key) ?? { month: s.recordedAt.toLocaleString("en-US", { month: "short" }), invoiced: 0, collected: 0, expenses: 0 };
    if (s.metricName === "monthly_invoiced") entry.invoiced = s.value;
    if (s.metricName === "monthly_collected") entry.collected = s.value;
    if (s.metricName === "monthly_expenses") entry.expenses = s.value;
    months.set(key, entry);
  }
  return Array.from(months.values());
}
