"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Cake, Wallet } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { cn } from "@/components/shared";

type Item = {
  key: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  tone: "amber" | "rose" | "sky" | "violet";
  icon: typeof Wallet;
};

/**
 * "What needs me right now" strip above the overview.
 *
 * The People landing page used to open on four vanity metrics — an HR manager
 * still had to know where to look to find the two leave requests and the four
 * people with no check-in. This surfaces the exceptions first and disappears
 * when there is nothing to do.
 */
export function ActionCenter() {
  const { data: leaves } = useApi<any[]>("/people/leave-requests");
  const { data: live } = useApi<any>("/people/attendance/live");
  const { data: payroll } = useApi<any>("/people/payroll/status");
  const { data: employees } = useApi<any[]>("/people/employees");

  const items: Item[] = [];

  const pending = (leaves ?? []).filter((l) => l.status === "PENDING");
  if (pending.length) {
    items.push({
      key: "leave",
      title: `${pending.length} leave request${pending.length === 1 ? "" : "s"} waiting`,
      detail: pending.slice(0, 3).map((l) => l.employee?.name).filter(Boolean).join(", ") + (pending.length > 3 ? ` +${pending.length - 3} more` : ""),
      href: "/people/leave",
      cta: "Review",
      tone: "amber",
      icon: CalendarClock,
    });
  }

  const notIn = Number(live?.notIn ?? 0);
  const total = Number(live?.total ?? 0);
  // Before ~11:00 everyone is legitimately "not in yet" — only nag after that.
  const hour = new Date().getHours();
  if (total > 0 && notIn > 0 && hour >= 11) {
    items.push({
      key: "checkin",
      title: `${notIn} of ${total} have not checked in`,
      detail: `Live board for ${live?.date ?? "today"} — late arrivals and missing punches show up here.`,
      href: "/people/attendance",
      cta: "Open board",
      tone: "rose",
      icon: AlertTriangle,
    });
  }

  if (payroll && !payroll.period) {
    items.push({
      key: "payroll",
      title: "Payroll has never been run",
      detail: "Generate records from salary and attendance before month-end.",
      href: "/people/payroll",
      cta: "Run payroll",
      tone: "violet",
      icon: Wallet,
    });
  } else if (payroll?.period && ["DRAFT", "IN_PROGRESS", "MIXED"].includes(payroll.status)) {
    items.push({
      key: "payroll-draft",
      title: `Payroll ${payroll.period} still in draft`,
      detail: `${payroll.count} record(s) waiting to be finalized.`,
      href: "/people/payroll",
      cta: "Review",
      tone: "violet",
      icon: Wallet,
    });
  }

  const month = new Date().getMonth();
  const anniversaries = (employees ?? []).filter((e: any) => {
    const jd = e.joinDate ?? e.joinedDate;
    if (!jd) return false;
    const d = new Date(jd);
    return d.getMonth() === month && d.getFullYear() < new Date().getFullYear();
  });
  if (anniversaries.length) {
    items.push({
      key: "anniversary",
      title: `${anniversaries.length} work anniversar${anniversaries.length === 1 ? "y" : "ies"} this month`,
      detail: anniversaries.slice(0, 3).map((e: any) => e.name).join(", "),
      href: "/people/directory",
      cta: "Say congrats",
      tone: "sky",
      icon: Cake,
    });
  }

  if (!items.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-1.5">
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
        <p className="text-meta font-medium text-emerald-700 dark:text-emerald-300">
          Nothing needs you right now — no pending leave, everyone accounted for, payroll up to date.
        </p>
      </div>
    );
  }

  const toneCls: Record<Item["tone"], string> = {
    amber: "border-amber-500/30 bg-amber-500/5",
    rose: "border-rose-500/30 bg-rose-500/5",
    sky: "border-sky-500/30 bg-sky-500/5",
    violet: "border-violet-500/30 bg-violet-500/5",
  };
  const iconCls: Record<Item["tone"], string> = {
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    rose: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    sky: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">Needs you</span>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            title={item.detail}
            className={cn("group flex min-w-0 items-center gap-1.5 rounded-xl border px-2 py-1 transition-colors hover:border-primary/40", toneCls[item.tone])}
          >
            <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md", iconCls[item.tone])}>
              <Icon className="size-3" />
            </span>
            <span className="min-w-0 truncate text-meta font-semibold">{item.title}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-micro font-bold text-primary">
              {item.cta} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
