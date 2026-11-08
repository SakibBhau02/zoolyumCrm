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
 * Canonical invoice money math (mirrors Finance_System formulas):
 *   subtotal = Σ line amounts
 *   tax      = subtotal * taxRate / 100   (only when taxApplicable)
 *   discount = subtotal * discountRate / 100
 *   grand    = subtotal + tax - discount + shipping
 *   paid     = Σ payments IN − Σ payments REFUND   (net cash actually retained)
 *   balance  = grand − paid
 * Revenue recognition stays line-based (pre-tax, as before); `grand` is the
 * client-facing receivable used for status / aging / balances.
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
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    subtotal: r2(subtotal),
    tax: r2(tax),
    discount: r2(discount),
    shipping: r2(shipping),
    grand: r2(grand),
    paid: r2(paid),
    paidIn: r2(paidIn),
    refunded: r2(refunded),
    balance: r2(Math.max(grand - paid, 0)),
  };
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
  return !!inv.dueDate && new Date(inv.dueDate).getTime() < now.getTime();
}

export function daysOverdue(inv: any, now: Date = new Date()) {
  if (!inv.dueDate) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000));
}

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
