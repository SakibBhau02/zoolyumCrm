const CURRENCY_SYMBOL: Record<string, string> = {
  BDT: "৳",
  USD: "$",
  SAR: "SAR ",
  AED: "AED ",
};

/**
 * Money with the project's own currency. `formatBDT` is kept as a thin
 * BDT-specific wrapper so existing callers keep working, but a USD project must
 * never be labelled with a taka sign.
 */
export function formatMoney(
  n: number | string | null | undefined,
  currency = "BDT"
): string {
  const value = Number(n);
  if (n == null || Number.isNaN(value)) return `${CURRENCY_SYMBOL[currency] ?? ""}0`;
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  if (currency === "BDT" && value >= 100000) {
    const lakh = value / 100000;
    return `${symbol}${lakh.toFixed(lakh >= 10 ? 1 : 2)}L`;
  }
  return `${symbol}${Math.round(value).toLocaleString("en-US")}`;
}

export function formatBDT(n: number | null | undefined): string {
  return formatMoney(n, "BDT");
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDay(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export function percent(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n)}%`;
}
