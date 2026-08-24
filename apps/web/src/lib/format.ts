export function formatBDT(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "৳0";
  if (n >= 100000) {
    const lakh = n / 100000;
    return `৳${lakh.toFixed(lakh >= 10 ? 1 : 2)}L`;
  }
  if (n >= 1000) return `৳${Math.round(n).toLocaleString("en-US")}`;
  return `৳${Math.round(n)}`;
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
