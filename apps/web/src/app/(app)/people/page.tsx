"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Clock,
  Fingerprint,
  Gauge,
  LogIn,
  LogOut,
  Plus,
  UserRoundCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { Avatar, StatusBadge, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { DenseCard, PeopleHero } from "./_components/hero";
import { EmployeeModal } from "./_components/modals/employee-form";
import { usePeopleAccess } from "./_components/permissions";
import { Toast, useToast } from "./_components/hooks";
import { monthNow } from "./_components/constants";

type EmployeeRow = {
  id: string;
  name: string;
  roleTitle: string;
  department: string | null;
  email: string | null;
  deviceId?: string | null;
  employmentStatus: string;
  photoUrl?: string | null;
  todayStatus?: string | null;
};

type LiveRow = { employeeId: string; name: string; roleTitle: string; department: string | null; state: "inside" | "left" | "not_in"; checkIn: string | null; checkOut: string | null; minutesLate: number | null };

/**
 * People command centre.
 *
 * The old overview was a KPI strip + a paginated copy of the directory. An HR
 * admin does not open People to re-read the directory — they open it to find
 * out *what needs them today* (pending leave, missing punch-outs, payroll not
 * run, stale onboarding) and to see the shape of the month. This page answers
 * those in the first viewport; the directory has its own tab.
 */
export default function OverviewPage() {
  const { canEdit, canSeePay } = usePeopleAccess();
  const [addOpen, setAddOpen] = useState(false);
  const { flash, notify } = useToast();

  const { data: overview, mutate: reloadOverview } = useApi<any>("/people/overview");
  const { data: employees, mutate: reloadEmployees } = useApi<EmployeeRow[]>("/people/employees");
  const { data: live } = useApi<any>("/people/attendance/live");
  const { data: leaves } = useApi<any[]>("/people/leave-requests");
  const { data: payroll } = useApi<any>(canSeePay ? "/people/payroll/status" : null);
  const { data: analytics } = useApi<any>("/people/analytics/monthly?months=6");
  const { data: onboarding } = useApi<any>("/people/onboarding/summary");
  const { data: holidays } = useApi<any[]>("/people/holidays");

  const pendingLeave = (leaves ?? []).filter((l) => l.status === "PENDING").length;
  const rows = employees ?? [];
  const noEmail = rows.filter((e) => !e.email).length;
  const noDevice = rows.filter((e) => !e.deviceId).length;
  const payrollStale = !payroll?.period || payroll.period !== monthNow();

  const departments = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) map.set(e.department ?? "Unassigned", (map.get(e.department ?? "Unassigned") ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const nextHoliday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (holidays ?? []).filter((h) => String(h.date) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] ?? null;
  }, [holidays]);

  const movement = useMemo(() => {
    const list: LiveRow[] = live?.rows ?? [];
    return [...list]
      .filter((r) => r.checkIn)
      .sort((a, b) => String(b.checkIn).localeCompare(String(a.checkIn)))
      .slice(0, 5);
  }, [live]);

  const monthPoints = useMemo(() => {
    if (!analytics?.months) return [];
    return analytics.months.map((m: any) => {
      const t = analytics.totals[m.key] ?? {};
      const attended = (t.presentDays ?? 0) + (t.lateDays ?? 0) + (t.halfDays ?? 0);
      const total = attended + (t.absentDays ?? 0);
      return {
        key: m.key,
        label: m.label,
        rate: total ? Math.round((attended / total) * 100) : 0,
        total,
        tasks: t.tasksDone ?? 0,
        late: t.lateDays ?? 0,
      };
    });
  }, [analytics]);

  const attention = [
    {
      key: "leave",
      label: "Leave requests waiting",
      detail: "Approve or reject so balances stay accurate",
      count: pendingLeave,
      href: "/people/leave",
      icon: <CalendarDays className="size-3.5" />,
      tone: "rose" as const,
    },
    {
      key: "not-in",
      label: "Still not checked in",
      detail: "Today's attendance has gaps",
      count: live?.notIn ?? 0,
      href: "/people/attendance",
      icon: <Clock className="size-3.5" />,
      tone: "amber" as const,
    },
    {
      key: "payroll",
      label: payrollStale ? "Payroll not run this month" : "Payroll in progress",
      detail: payroll?.period ? `Latest run ${payroll.period} · ${payroll.status ?? "draft"}` : "No payroll records yet",
      count: payrollStale ? 1 : payroll?.count ?? 0,
      href: "/people/payroll",
      icon: <Wallet className="size-3.5" />,
      tone: payrollStale ? ("rose" as const) : ("sky" as const),
    },
    {
      key: "onboarding",
      label: "Onboarding / offboarding open",
      detail: (onboarding?.stale ?? 0) > 0 ? `${onboarding.stale} run(s) older than a week` : "Checklists in progress",
      count: onboarding?.inProgress ?? 0,
      href: "/people/onboarding",
      icon: <UserRoundCheck className="size-3.5" />,
      tone: "violet" as const,
    },
    {
      key: "missing-email",
      label: "Profiles missing an email",
      detail: "Meetings and payslips cannot reach them",
      count: noEmail,
      href: "/people/directory",
      icon: <CircleAlert className="size-3.5" />,
      tone: "amber" as const,
    },
    {
      key: "missing-device",
      label: "No fingerprint device linked",
      detail: "Attendance will stay manual for these people",
      count: noDevice,
      href: "/people/attendance",
      icon: <Fingerprint className="size-3.5" />,
      tone: "sky" as const,
    },
  ].filter((a) => a.count > 0 && (a.key !== "payroll" || canSeePay));

  const toneDot: Record<string, string> = {
    rose: "bg-rose-500",
    amber: "bg-amber-500",
    sky: "bg-sky-500",
    violet: "bg-violet-500",
  };

  return (
    <div className="flex flex-col gap-3">
      <Toast flash={flash} />
      <PeopleHero
        icon={<Users className="size-4" />}
        title="Overview"
        subtitle="What needs you today, and the shape of the month"
        as="h2"
        stats={[
          { label: "People", value: overview?.totalEmployees ?? rows.length, sub: `${overview?.activeEmployees ?? 0} active` },
          { label: "Present", value: overview?.presentToday ?? "—", sub: "today", tone: "emerald" },
          { label: "Late", value: live?.rows?.filter((r: LiveRow) => (r.minutesLate ?? 0) > 0).length ?? 0, sub: "today", tone: "amber" },
          { label: "Absent", value: overview?.absentToday ?? "—", sub: "today", tone: "rose" },
          { label: "On leave", value: overview?.onLeaveToday ?? "—", sub: "today", tone: "sky" },
          { label: "Pending leave", value: pendingLeave, sub: "to decide", tone: "violet" },
        ]}
        actions={
          canEdit ? (
            <Btn variant="primary" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" /> Add employee
            </Btn>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DenseCard
          className="lg:col-span-2"
          title="Needs your attention"
          hint={attention.length ? `${attention.length} open queue${attention.length > 1 ? "s" : ""}` : "Nothing waiting — nice"}
          icon={<CircleAlert className="size-4" />}
        >
          {attention.length === 0 ? (
            <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-3 text-meta font-medium text-emerald-700 dark:text-emerald-300">
              All clear. Leave, attendance, payroll and onboarding have nothing waiting.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/50">
              {attention.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="group flex items-center gap-2.5 py-2 transition-colors hover:bg-muted/40">
                    <span className={cn("size-1.5 shrink-0 rounded-full", toneDot[a.tone])} />
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{a.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-semibold">{a.label}</span>
                      <span className="block truncate text-micro text-muted-foreground">{a.detail}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-micro font-bold tabular-nums text-foreground">{a.count}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DenseCard>

        <DenseCard title="Right now" hint={live?.date ? `${live.date} · live board` : "today"} icon={<Clock className="size-4" />}>
          <div className="grid grid-cols-3 gap-1.5">
            <MiniStat label="Inside" value={live?.inside ?? "—"} tone="emerald" icon={<LogIn className="size-3" />} />
            <MiniStat label="Left" value={live?.left ?? "—"} tone="sky" icon={<LogOut className="size-3" />} />
            <MiniStat label="Not in" value={live?.notIn ?? "—"} tone="amber" icon={<Clock className="size-3" />} />
          </div>
          <div className="mt-2 flex flex-col gap-0.5">
            {movement.length === 0 && <p className="py-3 text-center text-meta text-muted-foreground">No punches yet today.</p>}
            {movement.map((r) => (
              <div key={r.employeeId} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/40">
                <Avatar name={r.name} size="size-5" />
                <span className="min-w-0 flex-1 truncate text-meta font-medium">{r.name}</span>
                <span className={cn("shrink-0 rounded-full px-1.5 py-px text-micro font-bold", r.state === "inside" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                  {r.state === "inside" ? "in" : "out"}
                </span>
                <span className="w-10 shrink-0 text-right text-micro tabular-nums text-muted-foreground">
                  {r.checkIn ? new Date(r.checkIn).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
              </div>
            ))}
          </div>
          <Link href="/people/attendance" className="mt-1 block text-micro font-bold text-primary hover:underline">Open live board →</Link>
        </DenseCard>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        <DenseCard className="lg:col-span-2" title="Attendance rate" hint="last 6 months · present + late + half ÷ expected" icon={<Gauge className="size-4" />}>
          <MonthBars points={monthPoints} />
          {analytics?.months?.length ? (
            <LatestMonthStrip totals={analytics.totals?.[analytics.months[analytics.months.length - 1].key]} label={analytics.months[analytics.months.length - 1].label} />
          ) : null}
        </DenseCard>

        <div className="flex flex-col gap-3">
          <DenseCard title="Departments" hint={`${departments.length} teams`} icon={<Users className="size-4" />}>
            <div className="flex flex-col gap-1">
              {departments.slice(0, 5).map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-meta">{name}</span>
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.round((count / Math.max(1, rows.length)) * 100)}%` }} />
                  </div>
                  <span className="w-5 shrink-0 text-right text-micro font-bold tabular-nums text-muted-foreground">{count}</span>
                </div>
              ))}
              {departments.length === 0 && <p className="text-meta text-muted-foreground">No departments yet.</p>}
            </div>
          </DenseCard>

          <DenseCard title="Upcoming" hint="calendar" icon={<CalendarDays className="size-4" />}>
            <div className="flex flex-col gap-1.5">
              {nextHoliday ? (
                <div className="rounded-lg border border-border/50 bg-muted/30 px-2 py-1.5">
                  <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">Next holiday</p>
                  <p className="text-body font-semibold">{nextHoliday.name}</p>
                  <p className="text-micro text-muted-foreground">{new Date(`${String(nextHoliday.date).slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
              ) : (
                <p className="text-meta text-muted-foreground">No upcoming holiday on the calendar.</p>
              )}
              <Link href="/people/holidays" className="text-micro font-bold text-primary hover:underline">Manage holidays →</Link>
            </div>
          </DenseCard>
        </div>
      </div>

      <DenseCard
        title="Team snapshot"
        hint="today's state · click through to the full 360"
        icon={<Users className="size-4" />}
        action={<Link href="/people/directory" className="text-micro font-bold text-primary hover:underline">Directory →</Link>}
      >
        <div className="overflow-hidden rounded-xl border border-border/50">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/60 text-left">
                <th className="px-2 py-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Employee</th>
                <th className="hidden px-2 py-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground sm:table-cell">Role</th>
                <th className="hidden px-2 py-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground md:table-cell">Department</th>
                <th className="px-2 py-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground">Today</th>
                <th className="hidden px-2 py-1.5 text-micro font-bold uppercase tracking-wider text-muted-foreground sm:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 6).map((e) => (
                <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                  <td className="px-2 py-1.5">
                    <Link href={`/people/directory/${e.id}`} className="flex items-center gap-2 text-body font-medium hover:text-primary hover:underline">
                      <Avatar name={e.name} size="size-6" src={e.photoUrl} /> {e.name}
                    </Link>
                  </td>
                  <td className="hidden px-2 py-1.5 text-meta text-muted-foreground sm:table-cell">{e.roleTitle}</td>
                  <td className="hidden px-2 py-1.5 text-meta text-muted-foreground md:table-cell">{e.department ?? "—"}</td>
                  <td className="px-2 py-1.5"><StatusBadge status={e.todayStatus ?? "NOT_LOGGED"} /></td>
                  <td className="hidden px-2 py-1.5 sm:table-cell"><StatusBadge status={e.employmentStatus} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-meta text-muted-foreground">No employees yet — add the first one.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DenseCard>

      <EmployeeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={(employee) => {
          notify(employee?.name ? `Employee added — ${employee.name}` : "Employee added");
          reloadOverview();
          reloadEmployees();
        }}
      />
    </div>
  );
}

function LatestMonthStrip({ totals, label: l }: { totals: any; label: string }) {
  if (!totals) return null;
  const items = [
    { key: "Late days", value: totals.lateDays, tone: "text-amber-600 dark:text-amber-400" },
    { key: "Absent", value: totals.absentDays, tone: "text-rose-600 dark:text-rose-400" },
    { key: "Leave", value: totals.leaveDays, tone: "text-sky-600 dark:text-sky-400" },
    { key: "Meetings", value: totals.meetingsAttended, tone: "text-violet-600 dark:text-violet-400" },
  ];
  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <p className="mb-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">{l} so far</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.key} className="rounded-lg border border-border/50 bg-muted/25 px-2 py-1">
            <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{i.key}</p>
            <p className={cn("font-heading text-title font-bold tabular-nums", i.tone)}>{i.value ?? 0}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label: l, value, tone, icon }: { label: string; value: React.ReactNode; tone: "emerald" | "sky" | "amber" | "rose"; icon: React.ReactNode }) {
  const cls = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    sky: "text-sky-600 dark:text-sky-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
  }[tone];
  return (
    <div className="rounded-lg border border-border/50 bg-muted/25 px-2 py-1.5">
      <p className="flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">{icon}{l}</p>
      <p className={cn("font-heading text-title font-bold tabular-nums", cls)}>{value}</p>
    </div>
  );
}

function MonthBars({ points }: { points: { key: string; label: string; rate: number; total: number; tasks: number; late: number }[] }) {
  if (!points.length) return <p className="py-6 text-center text-meta text-muted-foreground">No attendance history yet.</p>;
  const measured = points.filter((p) => p.total > 0);
  const avg = measured.length ? Math.round(measured.reduce((s, p) => s + p.rate, 0) / measured.length) : 0;
  const tasks = points.reduce((s, p) => s + p.tasks, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        {points.map((p) => {
          const noData = p.total === 0;
          const color = p.rate >= 90 ? "bg-emerald-500" : p.rate >= 75 ? "bg-amber-400" : "bg-rose-500";
          return (
            <div key={p.key} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${p.label}: ${noData ? "no attendance data" : `${p.rate}% attendance · ${p.late} late days · ${p.tasks} tasks done`}`}>
              <span className={cn("text-micro font-bold tabular-nums", noData ? "text-muted-foreground/50" : "text-muted-foreground")}>
                {noData ? "—" : `${p.rate}%`}
              </span>
              <div className="flex h-20 w-full items-end overflow-hidden rounded-md bg-muted/50">
                {noData ? (
                  <div className="h-full w-full border border-dashed border-border/70" />
                ) : (
                  <div className={cn("w-full rounded-md transition-all", color)} style={{ height: `${Math.max(4, p.rate)}%` }} />
                )}
              </div>
              <span className="truncate text-micro text-muted-foreground">{p.label}</span>
            </div>
          );
        })}
      </div>
      <p className="text-micro text-muted-foreground">
        Average <span className="font-bold text-foreground">{avg}%</span> across {measured.length} month{measured.length === 1 ? "" : "s"} with attendance ·{" "}
        <span className="font-bold text-foreground">{tasks}</span> tasks completed
      </p>
    </div>
  );
}
