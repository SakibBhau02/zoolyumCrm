import type { Prisma } from "@prisma/client";
import type { CacheService } from "../cache/cache.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { PrismaService } from "../prisma/prisma.service";

export const ACTIVE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];
export const POSTABLE_STATUSES = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"];

/**
 * Canonical invoice money math (mirrors Finance_System formulas):
 *   subtotal = Σ line amounts
 *   tax      = subtotal * taxRate / 100   (only when taxApplicable)
 *   discount = subtotal * discountRate / 100
 *   grand    = subtotal + tax - discount + shipping
 * Revenue recognition stays line-based (pre-tax, as before); `grand` is the
 * client-facing receivable used for status / aging / balances.
 */
export function invoiceTotals(inv: any) {
  const subtotal = (inv.lineItems ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0);
  const tax = inv.taxApplicable && inv.taxRate ? (subtotal * Number(inv.taxRate)) / 100 : 0;
  const discount = inv.discountRate ? (subtotal * Number(inv.discountRate)) / 100 : 0;
  const shipping = Number(inv.shippingFee ?? 0);
  const grand = Math.max(0, subtotal + tax - discount + shipping);
  const paid = (inv.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const paidIn = (inv.payments ?? []).filter((p: any) => !p.type || p.type === "IN").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    grand: Math.round(grand * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    paidIn: Math.round(paidIn * 100) / 100,
    balance: Math.round(Math.max(grand - paid, 0) * 100) / 100,
  };
}

/** Clear every finance-derived cache (reports read through these keys). */
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
