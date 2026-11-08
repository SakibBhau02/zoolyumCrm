/**
 * One rule for every recurring billing date in the product.
 *
 * Two code paths used to disagree: the project wizard set the first date to the
 * 1st of next month, while the billing cron advanced it by 30 days. A retainer
 * starting on the 20th was therefore invoiced 11 days later, then monthly on
 * shifting days. This helper keeps the anchor day and clamps it to the end of
 * short months (31 Jan -> 28/29 Feb -> 31 Mar).
 */
export type BillingInterval = "7-days" | "15-days" | "30-days" | "monthly" | string | null | undefined;

export function advanceBillingDate(from: Date, interval: BillingInterval): Date {
  const d = new Date(from);
  const key = String(interval ?? "30-days").toLowerCase();

  if (key === "7-days" || key === "weekly") {
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (key === "15-days" || key === "fortnightly") {
    d.setDate(d.getDate() + 15);
    return d;
  }
  if (key === "30-days" || key === "daily-30") {
    d.setDate(d.getDate() + 30);
    return d;
  }

  // Calendar month: preserve the day-of-month instead of drifting by 30 days.
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfMonth));
  return d;
}
