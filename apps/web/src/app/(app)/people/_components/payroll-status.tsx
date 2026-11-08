"use client";

import Link from "next/link";
import { useApi } from "@/lib/use-api";
import { cn } from "@/components/shared";

type Status = {
  period: string | null;
  status: string | null;
  count: number;
  totalNet: number;
  breakdown: { status: string; count: number }[];
};

const monthLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

const TONE: Record<string, string> = {
  PAID: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  FINALIZED: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  DRAFT: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  IN_PROGRESS: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  MIXED: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
};

/**
 * Real payroll state for the page header. The old badge was the string
 * "Payroll: July finalized" — hard-coded, and false on a fresh install where
 * payroll had never run at all.
 */
export function PayrollStatusBadge() {
  const { data, error } = useApi<Status>("/people/payroll/status");
  if (error || !data) return null;

  if (!data.period) {
    return (
      <Link
        href="/people/payroll"
        className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11.5px] font-semibold text-amber-600 transition-colors hover:border-amber-500/50 dark:text-amber-300"
      >
        Payroll · not run yet
      </Link>
    );
  }

  const tone = TONE[data.status ?? ""] ?? "border-border bg-card text-muted-foreground";
  return (
    <Link
      href="/people/payroll"
      title={`${data.count} record(s) · ${data.status ?? ""}`}
      className={cn("rounded-full border px-3 py-1.5 text-[11.5px] font-semibold tabular-nums transition-colors", tone)}
    >
      Payroll · {monthLabel(data.period)}
      {data.status === "PAID" ? " · paid" : data.status === "FINALIZED" ? " · finalized" : data.status === "DRAFT" ? " · draft" : " · in progress"}
    </Link>
  );
}
